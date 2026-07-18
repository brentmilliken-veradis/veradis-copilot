// Watches calibration golden set (P2). Two obligations, both enforced here:
//
//   1. ANCHORS — the deterministic engine must reproduce the ratified Method
//      v21 §12 watch tiers to the digit, at the watches scaleFactor (10). This
//      proves the SCORER on known watches. Values mirror the SHA-locked master
//      golden (tests/golden/pcs-golden-v21.json); golden.test.ts guards drift.
//
//   2. THE HONESTY GATE — `watches.v1.json` may only carry
//      `calibration:"calibrated"` once its FIELD_GOLDEN set is non-empty and
//      every entry has validated end-to-end against an expert-assigned tier.
//      This couples the one-bit flag to real evidence, in CI, so a category can
//      never be silently promoted to a confident tier without a golden set that
//      backs it (D-1 honesty invariant; the confident-wrong score is the brand
//      killer). Field_golden entries + their end-to-end runner land with the
//      first real object (they need a real watch fixture to exercise).

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
  /** The tier an expert assigns this object — the ground truth the engine must reproduce. */
  expectedTier: string;
  /** Provenance of the ground truth (who verified it, against what source). */
  groundTruthSource: string;
  /** true only once the entry has validated end-to-end through the calibrated profile. */
  validated: boolean;
}

const GOLDEN = JSON.parse(
  readFileSync(new URL("../../tests/golden/watches-calibration-v1.json", import.meta.url), "utf8"),
) as { category: string; scale_factor: number; anchors: Anchor[]; field_golden: FieldGolden[] };

describe("watches calibration — anchors (Scenario B, §12-ratified)", () => {
  it("golden set is for watches at the production scaleFactor (10)", () => {
    expect(GOLDEN.category).toBe("watches");
    // Must match SCALE_BY_CATEGORY.watches in packages/enrichment/enrich.ts.
    expect(GOLDEN.scale_factor).toBe(10);
    expect(GOLDEN.anchors.length).toBeGreaterThanOrEqual(5);
  });

  for (const a of GOLDEN.anchors) {
    it(`${a.id} ${a.name}: composite, CI and tier reproduce to the digit`, () => {
      const s = scoreFromRaws(a.raws, {
        objectId: `§${a.id} ${a.name}`,
        snapshotTs: "2026-07-13T00:00:00Z",
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
    expect(tiers.has("flagged")).toBe(true); // the fake must fail
  });
});

describe("watches calibration — the honesty gate", () => {
  it("watches profile keeps its 30/30/25/15 structure (identity weights sum to 1)", () => {
    const p = loadProfile("watches");
    const sum = p.identityKeys.reduce((acc, k) => acc + k.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
  });

  it("watches may be 'calibrated' ONLY with a non-empty, fully-validated field-golden set", () => {
    const p = loadProfile("watches");
    if (p.calibration === "calibrated") {
      // The flag is only honest when real objects back it.
      expect(GOLDEN.field_golden.length).toBeGreaterThan(0);
      for (const fg of GOLDEN.field_golden) {
        expect(fg.validated, `${fg.id} ${fg.name} is unvalidated`).toBe(true);
        expect(fg.expectedTier).toBeTruthy();
        expect(fg.groundTruthSource).toBeTruthy();
      }
    }
    // While provisional, an empty field_golden set is expected — the anchors
    // prove the engine; the field set is what the flip waits on.
  });
});
