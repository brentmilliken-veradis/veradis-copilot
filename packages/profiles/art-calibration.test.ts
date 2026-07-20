// Fine-art calibration golden set. Two obligations, both enforced here:
//
//   1. ANCHORS — the deterministic engine must reproduce the art-shaped tiers to
//      the digit at the art scaleFactor (5). This proves the SCORER spans Gold →
//      Flagged for art; golden.test.ts guards the underlying algorithm drift.
//   2. THE HONESTY GATE — art.v1.json may carry calibration:"calibrated" only
//      when its FIELD_GOLDEN set is non-empty and every entry is validated. This
//      couples the one-bit flag to real evidence in CI, so the highest-fraud
//      category can never be silently promoted to a confident tier without a
//      golden set that backs it (D-1 honesty invariant).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreFromRaws } from "@/packages/pcs-core";
import { loadProfile } from "./loader";

interface Anchor {
  id: string;
  name: string;
  raws: { identity: number; custody: number; material: number; risk: number };
  materialMissingWeight?: number;
  checkCounts: { identity: number; custody: number; material: number; risk: number };
  expected: { composite: number; ci: { lo: number; hi: number }; tier: string };
}
interface FieldGolden {
  id: string;
  name: string;
  expectedTier: string;
  groundTruthSource: string;
  validated: boolean;
}

const GOLDEN = JSON.parse(
  readFileSync(new URL("../../tests/golden/art-calibration-v1.json", import.meta.url), "utf8"),
) as { category: string; scale_factor: number; anchors: Anchor[]; field_golden: FieldGolden[] };

describe("art calibration — anchors", () => {
  it("golden set is for art at the production scaleFactor (5, the default)", () => {
    expect(GOLDEN.category).toBe("art");
    expect(GOLDEN.scale_factor).toBe(5);
    expect(GOLDEN.anchors.length).toBeGreaterThanOrEqual(4);
  });

  for (const a of GOLDEN.anchors) {
    it(`${a.id} ${a.name}: composite, CI and tier reproduce to the digit`, () => {
      const s = scoreFromRaws(a.raws, {
        objectId: `art-${a.id} ${a.name}`,
        snapshotTs: "2026-07-20T00:00:00Z",
        scaleFactor: GOLDEN.scale_factor,
        withheldDisclosure: false,
        materialMissingWeight: a.materialMissingWeight,
        checkCounts: a.checkCounts,
      });
      expect(s.composite).toBe(a.expected.composite);
      expect(s.ci.lo).toBe(a.expected.ci.lo);
      expect(s.ci.hi).toBe(a.expected.ci.hi);
      expect(s.tier).toBe(a.expected.tier);
    });
  }

  it("spans the tier range (a golden set that only proves Gold proves nothing)", () => {
    const tiers = new Set(GOLDEN.anchors.map((a) => a.expected.tier));
    expect(tiers.has("gold")).toBe(true);
    expect(tiers.has("flagged")).toBe(true); // the reproduction must fail
  });
});

describe("art calibration — the honesty gate", () => {
  it("art profile keeps identity weights summing to 1 and carries the artist gate", () => {
    const p = loadProfile("art");
    const sum = p.identityKeys.reduce((acc, k) => acc + k.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    expect(p.goldGateIdentityKey).toBe("artist");
  });

  it("art may be 'calibrated' ONLY with a non-empty, fully-validated field-golden set", () => {
    const p = loadProfile("art");
    if (p.calibration === "calibrated") {
      expect(GOLDEN.field_golden.length).toBeGreaterThan(0);
      for (const fg of GOLDEN.field_golden) {
        expect(fg.validated, `${fg.id} ${fg.name} is unvalidated`).toBe(true);
        expect(fg.expectedTier).toBeTruthy();
        expect(fg.groundTruthSource).toBeTruthy();
      }
      // The negative must be present — a set that only proves Gold proves nothing.
      expect(GOLDEN.field_golden.some((fg) => fg.expectedTier === "flagged")).toBe(true);
    }
  });
});
