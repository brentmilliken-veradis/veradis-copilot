import { describe, it, expect } from "vitest";
import { renderReport } from "./render";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";

describe("renderReport — reproduce the 2007 RCM proof-set fixture (E6)", () => {
  const v1 = buildCoin2007(1);
  const v2 = buildCoin2007(2);

  it("v01 scores Silver at 85 (lower bound just misses Gold)", () => {
    expect(Math.round(v1.score.composite)).toBe(85);
    expect(v1.score.tier).toBe("silver");
    expect(v1.score.ci.lo).toBeLessThan(80);
    expect(v1.score.ci.lo).toBeGreaterThanOrEqual(60);
  });

  it("v02 reaches Gold at 93 (Custody lifted by provenance + receipt)", () => {
    expect(Math.round(v2.score.composite)).toBe(93);
    expect(v2.score.tier).toBe("gold");
    expect(v2.score.ci.lo).toBeGreaterThanOrEqual(80);
  });

  it("renders the canonical sections for v01", () => {
    const html = renderReport(v1);
    expect(html).toContain("2007 Royal Canadian Mint Proof Set");
    expect(html).toContain("Provenance Confidence Score");
    expect(html).toContain("Silver");
    expect(html).toContain("Indicative fair market value");
    expect(html).toContain("What this signature attests");
    // fixed lines + verbatim sentences
    expect(html).toContain("fee is fixed and does not depend on the value concluded");
    expect(html).toContain("reproduces this score to the digit");
    expect(html).toContain("not a certificate of authenticity");
    // honesty ceiling — never the word "authenticated"
    expect(html.toLowerCase()).not.toContain("authenticated");
    // v01 has no delta panel
    expect(html).not.toContain("What changed since");
  });

  it("renders the v01→v02 evidence ladder (delta panel)", () => {
    const html = renderReport(v2);
    expect(html).toContain("What changed since v1");
    expect(html).toContain("85"); // was
    expect(html).toContain("93"); // now
    expect(html).toContain("provenance narrative + receipt supplied");
    expect(html).toContain("documented / sealed");
    expect(html).toContain("Gold");
  });

  it("the ladder rises: Silver→Gold, Custody 64→91, actions three→two", () => {
    expect(v1.score.tier).toBe("silver");
    expect(v2.score.tier).toBe("gold");
    expect(v2.score.composite).toBeGreaterThan(v1.score.composite);
    expect(v1.valuation?.actions).toHaveLength(3);
    expect(v2.valuation?.actions).toHaveLength(2);
  });

  it("carries the hash chain + verify permalink (gate ⑥)", () => {
    const html = renderReport(v2);
    expect(html).toContain("Snapshot hash");
    expect(v2.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(html).toContain(v2.snapshotSha256!);
    // v02 chains onto v01's content hash
    expect(v2.supersedesSha256).toBe(buildCoin2007(1).snapshotSha256);
    expect(html).toContain("Supersedes v1");
    expect(html).toContain("https://verify.veradis.ai/r/");
  });

  it("watermarks a provisional report until a curator confirms", () => {
    expect(renderReport(buildCoin2007(1, { provisional: true }))).toContain("Provisional — under expert review");
    expect(renderReport(buildCoin2007(1, { provisional: false }))).not.toContain("Provisional — under expert review");
  });

  it("hashes nine photographs at intake", () => {
    expect(v1.evidence).toHaveLength(9);
    for (const e of v1.evidence) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
