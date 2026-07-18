// Coins calibration golden set (P2). Same two obligations as watches:
//
//   1. ANCHORS — the deterministic engine reproduces the canonical 2007 RCM
//      proof-set ladder (Silver → Gold) to the digit at the coins scaleFactor
//      (10). Values mirror the fixture PCS-CA-2026-0007; the acceptance suite
//      and golden.test.ts guard the underlying math.
//
//   2. THE HONESTY GATE — coins.v1.json may carry calibration:"calibrated" only
//      once its FIELD_GOLDEN set is non-empty and every entry is validated
//      against an expert-assigned tier (and, per the runbook, includes a
//      known-fake). Coins already ships source adapters (PCGS/Numista) and its
//      material flags, so it is structurally closer to calibratable than
//      watches — but the flag still waits on real objects.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreFromRaws } from "@/packages/pcs-core";
import { loadProfile } from "./loader";

interface Anchor {
  id: string;
  name: string;
  snapshot_ts: string;
  raws: { identity: number; custody: number; material: number; risk: number };
  material_missing_weight?: number;
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
  readFileSync(new URL("../../tests/golden/coins-calibration-v1.json", import.meta.url), "utf8"),
) as {
  category: string;
  scale_factor: number;
  object_id: string;
  check_counts: { identity: number; custody: number; material: number; risk: number };
  anchors: Anchor[];
  field_golden: FieldGolden[];
};

describe("coins calibration — anchors (Scenario B, RCM-ratified)", () => {
  it("golden set is for coins at the production scaleFactor (10)", () => {
    expect(GOLDEN.category).toBe("coins");
    expect(GOLDEN.scale_factor).toBe(10);
    expect(GOLDEN.anchors.length).toBeGreaterThanOrEqual(2);
  });

  for (const a of GOLDEN.anchors) {
    it(`${a.id} ${a.name}: composite, CI and tier reproduce to the digit`, () => {
      const s = scoreFromRaws(a.raws, {
        objectId: GOLDEN.object_id,
        snapshotTs: a.snapshot_ts,
        scaleFactor: GOLDEN.scale_factor,
        withheldDisclosure: false,
        materialMissingWeight: a.material_missing_weight,
        checkCounts: GOLDEN.check_counts,
      });
      expect(s.composite).toBe(a.expected.composite);
      expect(s.ci.lo).toBe(a.expected.ci.lo);
      expect(s.ci.hi).toBe(a.expected.ci.hi);
      expect(s.tier).toBe(a.expected.tier);
    });
  }

  it("the anchors discriminate a tier ladder (Silver → Gold on custody alone)", () => {
    const tiers = new Set(GOLDEN.anchors.map((a) => a.expected.tier));
    expect(tiers.has("silver")).toBe(true);
    expect(tiers.has("gold")).toBe(true);
  });
});

describe("coins calibration — the honesty gate", () => {
  it("coins profile keeps its 30/30/25/15 structure (identity weights sum to 1)", () => {
    const p = loadProfile("coins");
    const sum = p.identityKeys.reduce((acc, k) => acc + k.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
  });

  it("coins may be 'calibrated' ONLY with a non-empty, fully-validated field-golden set", () => {
    const p = loadProfile("coins");
    if (p.calibration === "calibrated") {
      expect(GOLDEN.field_golden.length).toBeGreaterThan(0);
      for (const fg of GOLDEN.field_golden) {
        expect(fg.validated, `${fg.id} ${fg.name} is unvalidated`).toBe(true);
        expect(fg.expectedTier).toBeTruthy();
        expect(fg.groundTruthSource).toBeTruthy();
      }
    }
  });
});
