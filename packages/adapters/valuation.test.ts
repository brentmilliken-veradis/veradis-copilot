import { describe, it, expect } from "vitest";
import { parseValuationJson, StubValuationAdapter, getValuationAdapter, ClaudeValuationAdapter } from "./valuation";

describe("parseValuationJson", () => {
  it("parses a valid estimate and carries the currency through", () => {
    const est = parseValuationJson(
      JSON.stringify({
        fmvLo: 50,
        fmvHi: 130,
        marketInterest: "modest",
        basis: "2004 RCM proof dollar, mintage 25,000, full packaging.",
        factors: [{ name: "Limited mintage", kind: "lift", effect: "scarcity supports the upper range" }],
        confidence: "moderate",
      }),
      "CAD",
    );
    expect(est).not.toBeNull();
    expect(est).toMatchObject({ currency: "CAD", fmvLo: 50, fmvHi: 130, marketInterest: "modest", confidence: "moderate" });
    expect(est!.basis).toContain("mintage");
  });

  it("always carries an info factor even when the model omits one (honesty caveat)", () => {
    const est = parseValuationJson(
      JSON.stringify({ fmvLo: 10, fmvHi: 20, marketInterest: "low", basis: "b", factors: [{ name: "Common issue", kind: "hold" }], confidence: "low" }),
      "CAD",
    )!;
    expect(est.factors.some((f) => f.kind === "info")).toBe(true);
  });

  it("returns null on an explicit noEstimate (better nothing than a fabricated number)", () => {
    expect(parseValuationJson(JSON.stringify({ noEstimate: true }), "CAD")).toBeNull();
  });

  it("rejects a non-defensible band — inverted, zero, or negative", () => {
    expect(parseValuationJson(JSON.stringify({ fmvLo: 500, fmvHi: 100, marketInterest: "warm", basis: "b", factors: [], confidence: "low" }), "CAD")).toBeNull();
    expect(parseValuationJson(JSON.stringify({ fmvLo: 0, fmvHi: 0, marketInterest: "low", basis: "b", factors: [], confidence: "low" }), "CAD")).toBeNull();
    expect(parseValuationJson(JSON.stringify({ fmvLo: -5, fmvHi: 5, marketInterest: "low", basis: "b", factors: [], confidence: "low" }), "CAD")).toBeNull();
  });

  it("coerces comma / space formatted numbers and rejects non-numeric", () => {
    const ok = parseValuationJson(JSON.stringify({ fmvLo: "1,200", fmvHi: "1 800", marketInterest: "warm", basis: "b", factors: [], confidence: "low" }), "CAD")!;
    expect(ok.fmvLo).toBe(1200);
    expect(ok.fmvHi).toBe(1800);
    expect(parseValuationJson(JSON.stringify({ fmvLo: "abc", fmvHi: 10, marketInterest: "low", basis: "b", factors: [], confidence: "low" }), "CAD")).toBeNull();
  });

  it("defaults an unknown marketInterest to modest and caps confidence at moderate", () => {
    const est = parseValuationJson(JSON.stringify({ fmvLo: 10, fmvHi: 20, marketInterest: "bananas", basis: "b", factors: [], confidence: "certain" }), "CAD")!;
    expect(est.marketInterest).toBe("modest");
    expect(est.confidence).toBe("low"); // anything other than "moderate" floors to low
  });

  it("reads a fenced ```json block and caps factors at 5", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, kind: "lift", effect: "e" }));
    const est = parseValuationJson("```json\n" + JSON.stringify({ fmvLo: 10, fmvHi: 20, marketInterest: "high", basis: "b", factors: many, confidence: "moderate" }) + "\n```", "CAD")!;
    expect(est.factors.length).toBeLessThanOrEqual(5);
    expect(est.factors.some((f) => f.kind === "info")).toBe(true); // honesty caveat survives the cap
  });

  it("returns null on unparseable output (caller keeps the F-8 default)", () => {
    expect(parseValuationJson("I think it's worth about a hundred bucks", "CAD")).toBeNull();
  });

  it("accepts CITED comps and drops uncited ones (no fabricated sales)", () => {
    const est = parseValuationJson(
      JSON.stringify({
        fmvLo: 60, fmvHi: 140, marketInterest: "modest", basis: "from comps", confidence: "moderate",
        comps: [
          { source: "eBay", venue: "eBay (sold)", date: "2025-03", result: "CAD 95 sold", url: "https://www.ebay.com/itm/123" },
          { source: "Fabricated House", venue: "?", date: "?", result: "CAD 999 hammer" }, // no url → dropped
        ],
        factors: [],
      }),
      "CAD",
    )!;
    expect(est.comps).toHaveLength(1);
    expect(est.comps[0].url).toContain("ebay.com");
    expect(est.factors.some((f) => f.kind === "info" && /cited comparable/i.test(f.effect ?? ""))).toBe(true);
  });

  it("a valid estimate with no comps still parses (comps default to [], honest caveat)", () => {
    const est = parseValuationJson(JSON.stringify({ fmvLo: 10, fmvHi: 20, marketInterest: "low", basis: "b", factors: [], confidence: "low" }), "CAD")!;
    expect(est.comps).toEqual([]);
    expect(est.factors.some((f) => f.kind === "info" && /no live comparable/i.test(f.effect ?? ""))).toBe(true);
  });

  it("extracts the JSON object even when the web-search reply wraps it in prose", () => {
    const est = parseValuationJson('Here is my estimate based on what I found:\n{"fmvLo":60,"fmvHi":140,"marketInterest":"modest","basis":"b","factors":[],"confidence":"moderate","comps":[]}\nHope that helps.', "CAD");
    expect(est).not.toBeNull();
    expect(est!.fmvHi).toBe(140);
  });
});

describe("StubValuationAdapter", () => {
  it("returns null — no engine band by default (F-8)", async () => {
    expect(await new StubValuationAdapter().estimate()).toBeNull();
  });
});

describe("getValuationAdapter", () => {
  it("selects the stub without a key and the Claude adapter with one", () => {
    const prevV = process.env.VALUATION_API_KEY;
    const prevA = process.env.ANTHROPIC_API_KEY;
    delete process.env.VALUATION_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(getValuationAdapter()).toBeInstanceOf(StubValuationAdapter);
    process.env.VALUATION_API_KEY = "test-key";
    expect(getValuationAdapter()).toBeInstanceOf(ClaudeValuationAdapter);
    // restore
    if (prevV === undefined) delete process.env.VALUATION_API_KEY;
    else process.env.VALUATION_API_KEY = prevV;
    if (prevA === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevA;
  });
});
