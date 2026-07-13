import { describe, it, expect } from "vitest";
import { Pcg64, seedFromObject } from "./rng";
import { scorePcs } from "./index";
import type { ScoreInputs } from "@/packages/pcs-types";

describe("PCG64 RNG (§7.3 deterministic contract)", () => {
  it("same seed → identical stream", () => {
    const a = new Pcg64(123n);
    const b = new Pcg64(123n);
    const sa = Array.from({ length: 5 }, () => a.next64().toString());
    const sb = Array.from({ length: 5 }, () => b.next64().toString());
    expect(sa).toEqual(sb);
  });

  it("different seeds → different streams", () => {
    const a = new Pcg64(1n);
    const b = new Pcg64(2n);
    expect(a.next64()).not.toBe(b.next64());
  });

  it("nextDouble stays in [0, 1)", () => {
    const r = new Pcg64(42n);
    for (let i = 0; i < 1000; i++) {
      const d = r.nextDouble();
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1);
    }
  });

  it("seedFromObject is deterministic and input-sensitive", () => {
    const a = seedFromObject("obj-1", "2026-07-13T00:00:00Z");
    const b = seedFromObject("obj-1", "2026-07-13T00:00:00Z");
    const c = seedFromObject("obj-2", "2026-07-13T00:00:00Z");
    expect(a.seed).toBe(b.seed);
    expect(a.hex).toBe(b.hex);
    expect(a.seed).not.toBe(c.seed);
  });
});

describe("scorePcs (full input path)", () => {
  const base: ScoreInputs = {
    objectId: "obj:coin",
    snapshotTs: "2026-07-13T00:00:00Z",
    category: "coins",
    identity: [
      { key: "country", weight: 0.1, credit: 1, present: true, authorityState: "resolved" },
      { key: "denomination", weight: 0.2, credit: 1, present: true, authorityState: "resolved" },
      { key: "year", weight: 0.25, credit: 1, present: true, authorityState: "resolved" },
      { key: "mint_mark", weight: 0.2, credit: 1, present: true, authorityState: "resolved" },
      { key: "variety", weight: 0.25, credit: 0.5, present: true, authorityState: "declared" },
    ],
    custody: { coverage: 0.8, documentQuality: 0.7, gaps: [] },
    material: [{ key: "surface", weight: 1, consistency: "consistent", present: true }],
    risk: [],
    alrEnabled: false,
    withheldDisclosure: false,
    scaleFactor: 5,
  };

  it("produces a coherent scored report", () => {
    const s = scorePcs(base);
    expect(s.isScoreable).toBe(true);
    expect(s.ci.lo).toBeLessThanOrEqual(s.composite);
    expect(s.composite).toBeLessThanOrEqual(s.ci.hi);
    expect(["gold", "silver", "bronze", "flagged"]).toContain(s.tier);
    expect(s.quadrants).toHaveLength(4);
  });

  it("is deterministic across two full runs", () => {
    expect(JSON.stringify(scorePcs(base))).toBe(JSON.stringify(scorePcs(base)));
  });

  it("routes to unscored when Identity is empty (data-sufficiency gate)", () => {
    const empty: ScoreInputs = {
      ...base,
      identity: [{ key: "year", weight: 1, credit: 0, present: false, authorityState: "missing" }],
      custody: { coverage: 0, documentQuality: 0.4, gaps: [] },
      material: [{ key: "surface", weight: 1, consistency: "consistent", present: false }],
      risk: [],
    };
    expect(scorePcs(empty).tier).toBe("unscored");
  });

  it("routes to withheld under a legal-disclosure restriction", () => {
    expect(scorePcs({ ...base, withheldDisclosure: true }).tier).toBe("withheld");
  });

  it("forces flagged on a high-severity risk hit", () => {
    expect(scorePcs({ ...base, risk: [{ kind: "sanctions", severity: "high" }] }).tier).toBe("flagged");
  });
});
