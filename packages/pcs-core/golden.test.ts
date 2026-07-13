// Golden regression — Method v21 Algorithm §12.1–§12.7, SHA-256-locked to the
// canonical NumPy reference (tools/reference/pcs_reference.py) per §7.3/§13.
// Binding: Scenario B (count-based n_eff), HoI-ratified 13 Jul 2026 — see
// docs/20260713_INT_BRIEF_PCS-CI-Neff-ScenarioB-Ratification_v01.md.
// Reproducibility contract: CI bounds at 2 dp round-half-even (HoI ruling,
// same date) — the golden carries only contract values, so it regenerates
// identically on any platform; sub-2dp libm drift is explicitly out of scope.
// Comparisons remain exact (===) AT the contract precision.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreFromRaws } from "./index";

const GOLDEN_URL = new URL("../../tests/golden/pcs-golden-v21.json", import.meta.url);
const GOLDEN_RAW = readFileSync(GOLDEN_URL, "utf8");
const GOLDEN = JSON.parse(GOLDEN_RAW);
const PINNED_SHA = readFileSync(new URL("../../tests/golden/pcs-golden-v21.sha256", import.meta.url), "utf8").trim();

// §12 inputs (raws + Scenario-B check counts), mirrored from the reference.
const CASES: Record<string, {
  name: string;
  raws: { identity: number; custody: number; material: number; risk: number };
  scaleFactor: number;
  materialMissingWeight?: number;
  checkCounts: { identity: number; custody: number; material: number; risk: number };
}> = {
  "12.1": { name: "AP Royal Oak 5516", raws: { identity: 96, custody: 91, material: 95, risk: 90 }, scaleFactor: 10, materialMissingWeight: 0.1, checkCounts: { identity: 7, custody: 4, material: 4, risk: 1 } },
  "12.2": { name: "Omega Speedmaster 145.022", raws: { identity: 98, custody: 64, material: 92, risk: 90 }, scaleFactor: 10, checkCounts: { identity: 7, custody: 5, material: 5, risk: 1 } },
  "12.3": { name: "Lee-Enfield No.4 Mk 1", raws: { identity: 97, custody: 96, material: 94, risk: 100 }, scaleFactor: 5, checkCounts: { identity: 6, custody: 4, material: 5, risk: 1 } },
  "12.4": { name: "Porsche 911 Carrera RS", raws: { identity: 95, custody: 78, material: 73, risk: 100 }, scaleFactor: 3, checkCounts: { identity: 6, custody: 6, material: 4, risk: 1 } },
  "12.5": { name: "Rolex Submariner 5513", raws: { identity: 94, custody: 58, material: 85, risk: 90 }, scaleFactor: 10, checkCounts: { identity: 7, custody: 6, material: 5, risk: 1 } },
  "12.6": { name: "Tudor Submariner 7928", raws: { identity: 58, custody: 51, material: 65, risk: 90 }, scaleFactor: 10, checkCounts: { identity: 7, custody: 3, material: 5, risk: 1 } },
  "12.7": { name: "fake Daytona 6263", raws: { identity: 28, custody: 22, material: 0, risk: 90 }, scaleFactor: 10, checkCounts: { identity: 4, custody: 2, material: 5, risk: 1 } },
};

describe("PCS Algorithm v21 §12 — golden regression (Scenario B, NumPy-locked)", () => {
  it("golden file integrity — SHA-256 matches the pinned hash", () => {
    expect(createHash("sha256").update(GOLDEN_RAW, "utf8").digest("hex")).toBe(PINNED_SHA);
  });

  it("golden binding is Scenario B", () => {
    expect(GOLDEN.binding_scenario).toMatch(/^B /);
  });

  for (const [key, c] of Object.entries(CASES)) {
    const g = GOLDEN.cases[key];
    it(`§${key} ${c.name}: composite, CI (exact), tier match the NumPy reference`, () => {
      const s = scoreFromRaws(c.raws, {
        objectId: `§${key} ${c.name}`,
        snapshotTs: GOLDEN.snapshot_ts,
        scaleFactor: c.scaleFactor,
        withheldDisclosure: false,
        materialMissingWeight: c.materialMissingWeight,
        checkCounts: c.checkCounts,
      });
      const ref = g.scenario_B_count_based;
      expect(s.composite).toBe(g.composite_algebraic);
      // Exact at the contract precision (2 dp round-half-even) — no tolerance.
      expect(s.ci.point).toBe(ref.ci_2dp.point);
      expect(s.ci.lo).toBe(ref.ci_2dp.lo);
      expect(s.ci.hi).toBe(ref.ci_2dp.hi);
      expect(s.tier).toBe(ref.tier_on_mc_lo);
      // Doc tier (post-errata §12) must agree.
      expect(s.tier).toBe(g.doc.tier);
    });
  }

  it("is deterministic — two runs match to the digit", () => {
    const meta = { objectId: "det-check", snapshotTs: "2026-07-13T00:00:00Z", scaleFactor: 10, withheldDisclosure: false };
    const a = scoreFromRaws({ identity: 96, custody: 91, material: 95, risk: 90 }, meta);
    const b = scoreFromRaws({ identity: 96, custody: 91, material: 95, risk: 90 }, meta);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different objects yield different seeds/CI", () => {
    const base = { snapshotTs: "2026-07-13T00:00:00Z", scaleFactor: 10, withheldDisclosure: false };
    const a = scoreFromRaws({ identity: 80, custody: 70, material: 75, risk: 90 }, { ...base, objectId: "obj-A" });
    const b = scoreFromRaws({ identity: 80, custody: 70, material: 75, risk: 90 }, { ...base, objectId: "obj-B" });
    expect(a.seedHex).not.toBe(b.seedHex);
  });
});
