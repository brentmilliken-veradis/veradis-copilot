import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NumistaSourceAdapter,
  getNumistaAdapter,
  titleTopics,
  scoreNumistaCandidate,
} from "./source";

// The 2004 Canada "Poppy" silver dollar (#27776) vs the 25-cent Remembrance
// (#31216) — Numista ranks the 25-cent higher, so the adapter's scorer must pick
// the dollar by attribute agreement, not by search rank.
const DOLLAR = {
  id: 27776,
  title: "1 Dollar - Elizabeth II (Poppy)",
  issuer: { code: "canada", name: "Canada" },
  min_year: 2004,
  max_year: 2004,
  object_type: { name: "Non-circulating coins" },
};
const QUARTER = {
  id: 31216,
  title: "25 Cents - Elizabeth II (Silver Remembrance Day)",
  issuer: { code: "canada", name: "Canada" },
  min_year: 2004,
  max_year: 2004,
  object_type: { name: "Non-circulating coins" },
};
const DOLLAR_DETAIL = {
  ...DOLLAR,
  url: "https://en.numista.com/27776",
  value: { text: "1 Dollar" },
  mints: [{ name: "Royal Canadian Mint" }],
};

const POPPY_ATTRS = {
  country: "Canada",
  year: "2004",
  denomination: "Dollar",
  mint_mark: "Royal Canadian Mint",
  variety: "Proof",
  title: 'Special Edition Proof Silver Dollar "The Poppy"',
};
const KEYS = ["country", "denomination", "year", "mint_mark", "variety"];

function mockFetch(handler: (url: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const body = handler(String(url));
      if (body === null) return { ok: false, status: 500, async text() { return "err"; }, async json() { return {}; } };
      return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("titleTopics", () => {
  it("keeps distinctive topics, drops finish / material / denomination noise", () => {
    expect(titleTopics('Special Edition Proof Silver Dollar "The Poppy"')).toBe("poppy");
    expect(titleTopics("Gold Proof Sovereign")).toBe("sovereign");
    expect(titleTopics(undefined)).toBe("");
  });
});

describe("scoreNumistaCandidate", () => {
  it("prefers the matching denomination when issuer + year tie", () => {
    expect(scoreNumistaCandidate(DOLLAR, POPPY_ATTRS)).toBeGreaterThan(scoreNumistaCandidate(QUARTER, POPPY_ATTRS));
  });
});

describe("NumistaSourceAdapter.resolveObject", () => {
  it("resolves the Poppy dollar and confirms country / year / denomination / mint", async () => {
    const calls = mockFetch((url) =>
      url.includes("/types/") ? DOLLAR_DETAIL : { count: 2, types: [QUARTER, DOLLAR] },
    );
    const res = await new NumistaSourceAdapter("k").resolveObject({
      attributes: POPPY_ATTRS,
      category: "coins",
      identityKeys: KEYS,
    });
    expect(res?.matched).toBe(true);
    expect(res?.url).toContain("27776");
    const c = res!.confirmedKeys;
    expect(Object.keys(c).sort()).toEqual(["country", "denomination", "mint_mark", "year"]);
    expect(c.variety).toBeUndefined(); // "Proof" is not in the catalogue title — honestly left "observed"
    // the search query carried the distinctive topic word
    expect(calls.some((u) => u.toLowerCase().includes("poppy"))).toBe(true);
  });

  it("does NOT match against a wrong-denomination candidate (owner said Dollar, only the 25-cent exists)", async () => {
    mockFetch((url) => (url.includes("/types/") ? { ...QUARTER, url: "https://en.numista.com/31216", value: { text: "25 Cents" } } : { count: 1, types: [QUARTER] }));
    const res = await new NumistaSourceAdapter("k").resolveObject({
      attributes: POPPY_ATTRS,
      category: "coins",
      identityKeys: KEYS,
    });
    expect(res?.matched).toBe(false); // denomination provided but disagrees → no false confirmation
  });

  it("degrades to no-match on a network / API failure (never throws)", async () => {
    mockFetch(() => null); // every call fails
    const res = await new NumistaSourceAdapter("k").resolveObject({ attributes: POPPY_ATTRS, category: "coins", identityKeys: KEYS });
    expect(res?.matched).toBe(false);
  });

  it("RETRIES a transient search failure (500) and still resolves — no silent identity drop", async () => {
    let searchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/types/")) return { ok: true, status: 200, async text() { return JSON.stringify(DOLLAR_DETAIL); }, async json() { return DOLLAR_DETAIL; } };
        searchCalls++;
        if (searchCalls === 1) return { ok: false, status: 500, async text() { return "err"; }, async json() { return {}; } };
        const body = { count: 2, types: [QUARTER, DOLLAR] };
        return { ok: true, status: 200, async text() { return JSON.stringify(body); }, async json() { return body; } };
      }),
    );
    const res = await new NumistaSourceAdapter("k").resolveObject({ attributes: POPPY_ATTRS, category: "coins", identityKeys: KEYS });
    expect(res?.matched).toBe(true);
    expect(searchCalls).toBeGreaterThanOrEqual(2); // it retried rather than dropping identity
  });

  it("fails fast on a PERMANENT 4xx (bad key / 401) — no wasted retries", async () => {
    let searchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/types/")) return { ok: true, status: 200, async text() { return "{}"; }, async json() { return {}; } };
        searchCalls++;
        return { ok: false, status: 401, async text() { return "unauthorized"; }, async json() { return {}; } };
      }),
    );
    const res = await new NumistaSourceAdapter("k").resolveObject({ attributes: POPPY_ATTRS, category: "coins", identityKeys: KEYS });
    expect(res?.matched).toBe(false);
    expect(searchCalls).toBe(1); // 401 is not retried
  });

  it("returns null for a category Numista does not serve", async () => {
    mockFetch(() => ({ count: 0, types: [] }));
    const res = await new NumistaSourceAdapter("k").resolveObject({ attributes: { title: "x" }, category: "watches", identityKeys: [] });
    expect(res).toBeNull();
  });

  it("the per-key lookup stays a no-match (resolution is object-level)", async () => {
    const r = await new NumistaSourceAdapter("k").lookup();
    expect(r.matched).toBe(false);
    expect(r.tier).toBe(1);
  });
});

describe("getNumistaAdapter", () => {
  it("selects the real adapter with a key, the stub without", () => {
    const prev = process.env.NUMISTA_API_KEY;
    delete process.env.NUMISTA_API_KEY;
    expect(getNumistaAdapter().name).toBe("Numista");
    expect(getNumistaAdapter()).not.toBeInstanceOf(NumistaSourceAdapter);
    process.env.NUMISTA_API_KEY = "k";
    expect(getNumistaAdapter()).toBeInstanceOf(NumistaSourceAdapter);
    if (prev === undefined) delete process.env.NUMISTA_API_KEY;
    else process.env.NUMISTA_API_KEY = prev;
  });
});
