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

import { parseWatchResolution, ClaudeWatchSourceAdapter, getWatchArchiveAdapter } from "./source";

// The watch reference resolver — Tier-1 identity for watches. Honesty guards:
// a close needs a cited URL AND a confirmed reference; a disagreement is demoted
// to an advisory correction, never credited.
describe("parseWatchResolution", () => {
  const IK = ["brand", "reference", "serial_number", "movement_calibre", "dial_configuration"];
  const attrs = { brand: "Omega", reference: "311.30.42.30.01.005", serial_number: "87xxxxxx", dial_configuration: "black" };

  it("confirms a clearly-resolved, agreeing reference with a citation + reads new fields", () => {
    const res = parseWatchResolution(JSON.stringify({
      matched: true,
      url: "https://www.omegawatches.com/watch-311-30-42-30-01-005",
      confirmed: { brand: "Omega", reference: "311.30.42.30.01.005", movement_calibre: "1861", dial_configuration: "black" },
      note: "Speedmaster Professional Moonwatch, calibre 1861",
    }), attrs, IK);
    expect(res?.matched).toBe(true);
    expect(res?.confirmedKeys).toMatchObject({ brand: "Omega", reference: "311.30.42.30.01.005", movement_calibre: "1861" });
    expect(res?.url).toContain("omegawatches.com");
  });

  it("refuses to close without a citation URL", () => {
    const res = parseWatchResolution(JSON.stringify({ matched: true, confirmed: { reference: "311.30.42.30.01.005" } }), attrs, IK);
    expect(res?.matched).toBe(false);
  });

  it("refuses to close when the reference itself is not confirmed (brand alone is not identity)", () => {
    const res = parseWatchResolution(JSON.stringify({
      matched: true, url: "https://example.com/x", confirmed: { brand: "Omega" },
    }), attrs, IK);
    expect(res?.matched).toBe(false);
  });

  it("demotes a disagreeing field to an advisory correction, never credits it", () => {
    const res = parseWatchResolution(JSON.stringify({
      matched: true, url: "https://www.chrono24.com/omega/x.htm",
      confirmed: { reference: "311.30.42.30.01.005" },
      corrected: { movement_calibre: "3861" }, // owner read 1861; source says 3861
    }), { ...attrs, movement_calibre: "1861" }, IK);
    expect(res?.matched).toBe(true);
    expect(res?.confirmedKeys.movement_calibre).toBeUndefined();
    expect(res?.correctedKeys?.movement_calibre).toBe("3861");
  });

  it("no clear match → not matched; malformed → null", () => {
    expect(parseWatchResolution(JSON.stringify({ matched: false }), attrs, IK)?.matched).toBe(false);
    expect(parseWatchResolution("the watch could not be resolved", attrs, IK)).toBeNull();
  });
});

describe("getWatchArchiveAdapter", () => {
  afterEach(() => { delete process.env.VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  it("returns the live resolver when a web-search key is set, else the stub", () => {
    delete process.env.VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    expect(getWatchArchiveAdapter().name).toBe("Brand archive extract"); // stub
    process.env.VISION_API_KEY = "k";
    expect(getWatchArchiveAdapter()).toBeInstanceOf(ClaudeWatchSourceAdapter);
  });
});

import { parseArtResolution, ClaudeArtSourceAdapter, getArtArchiveAdapter } from "./source";

// The fine-art resolver — Tier-1 identity for art. Honesty guards: a close needs
// a cited URL AND a confirmed ARTIST (the documented-artist gate); a disagreement
// is demoted to an advisory correction; it never encodes an authorship claim.
describe("parseArtResolution", () => {
  const IK = ["artist", "signature_inscription", "title", "medium", "dimensions"];
  const attrs = { artist: "Nicolas Bott", title: "Alpine II", medium: "Oil on canvas", dimensions: "24 x 36 in" };

  it("confirms a documented artist + matched work with a citation", () => {
    const res = parseArtResolution(JSON.stringify({
      matched: true,
      url: "https://www.askart.com/artist/Nicolas_Bott/x/Nicolas_Bott.aspx",
      confirmed: { artist: "Nicolas Bott", title: "Alpine II", medium: "Oil on canvas" },
      note: "Documented BC artist; work matches a gallery record",
    }), attrs, IK);
    expect(res?.matched).toBe(true);
    expect(res?.confirmedKeys).toMatchObject({ artist: "Nicolas Bott", title: "Alpine II" });
    expect(res?.url).toContain("askart.com");
  });

  it("refuses to close without a citation URL", () => {
    expect(parseArtResolution(JSON.stringify({ matched: true, confirmed: { artist: "Nicolas Bott" } }), attrs, IK)?.matched).toBe(false);
  });

  it("refuses to close when the ARTIST is not confirmed (the gate)", () => {
    const res = parseArtResolution(JSON.stringify({
      matched: true, url: "https://example.com/x", confirmed: { title: "Alpine II" },
    }), attrs, IK);
    expect(res?.matched).toBe(false);
  });

  it("demotes a disagreeing field to an advisory correction", () => {
    const res = parseArtResolution(JSON.stringify({
      matched: true, url: "https://www.artnet.com/artists/nicolas-bott/",
      confirmed: { artist: "Nicolas Bott" }, corrected: { year: "1997" },
    }), { ...attrs, year: "1998" }, [...IK, "year"]);
    expect(res?.matched).toBe(true);
    expect(res?.correctedKeys?.year).toBe("1997");
  });

  it("no documented artist → not matched; malformed → null", () => {
    expect(parseArtResolution(JSON.stringify({ matched: false }), attrs, IK)?.matched).toBe(false);
    expect(parseArtResolution("could not resolve the artist", attrs, IK)).toBeNull();
  });
});

describe("getArtArchiveAdapter", () => {
  afterEach(() => { delete process.env.VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY; });
  it("returns the live resolver when a web-search key is set, else the stub", () => {
    delete process.env.VISION_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    expect(getArtArchiveAdapter().name).toBe("Catalogue raisonné"); // stub
    process.env.VISION_API_KEY = "k";
    expect(getArtArchiveAdapter()).toBeInstanceOf(ClaudeArtSourceAdapter);
  });
});
