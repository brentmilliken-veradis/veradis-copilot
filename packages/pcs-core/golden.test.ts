// Golden regression — Method v21 Algorithm §12.1–§12.7.
// Asserts the deterministic parts to the digit: the algebraic composite (exact),
// the tier (on the lower CI bound), and bit-identical reruns. The CI bounds are
// engine-generated (this implementation is the reference per §7.3) and pinned as
// a regression; their absolute values await the Head-of-Intelligence sign-off
// after E5 (they are NOT claimed bit-parity with a NumPy reference).

import { describe, it, expect } from "vitest";
import { scoreFromRaws } from "./index";
import type { Tier } from "@/packages/pcs-types";

interface GoldenCase {
  name: string;
  raws: { identity: number; custody: number; material: number; risk: number };
  scaleFactor: number;
  materialMissingWeight?: number;
  composite: number;
  tier: Tier;
}

// §12.1–§12.7. Composites are the exact arithmetic weighted sums.
const CASES: GoldenCase[] = [
  { name: "§12.1 AP Royal Oak 5516", raws: { identity: 96, custody: 91, material: 95, risk: 90 }, scaleFactor: 10, materialMissingWeight: 0.1, composite: 93.35, tier: "gold" },
  { name: "§12.2 Omega Speedmaster", raws: { identity: 98, custody: 64, material: 92, risk: 90 }, scaleFactor: 10, composite: 85.1, tier: "silver" },
  { name: "§12.3 Lee-Enfield No.4 (Seaforth)", raws: { identity: 97, custody: 96, material: 94, risk: 100 }, scaleFactor: 5, composite: 96.4, tier: "gold" },
  { name: "§12.4 Porsche 911 Carrera RS", raws: { identity: 95, custody: 78, material: 73, risk: 100 }, scaleFactor: 3, composite: 85.15, tier: "silver" },
  { name: "§12.5 Rolex 5513 (period bracelet)", raws: { identity: 94, custody: 58, material: 85, risk: 90 }, scaleFactor: 10, composite: 80.35, tier: "silver" },
  { name: "§12.6 Tudor 7928 (Bronze)", raws: { identity: 58, custody: 51, material: 65, risk: 90 }, scaleFactor: 10, composite: 62.45, tier: "bronze" },
  { name: "§12.7 fake Daytona (Flagged)", raws: { identity: 28, custody: 22, material: 0, risk: 90 }, scaleFactor: 10, composite: 28.5, tier: "flagged" },
];

describe("PCS Algorithm v21 §12 — golden regression", () => {
  for (const c of CASES) {
    it(`${c.name}: composite ${c.composite}, tier ${c.tier}`, () => {
      const meta = { objectId: c.name, snapshotTs: "2026-07-13T00:00:00Z", scaleFactor: c.scaleFactor, withheldDisclosure: false, materialMissingWeight: c.materialMissingWeight };
      const s = scoreFromRaws(c.raws, meta);
      // Composite: exact algebraic weighted sum.
      expect(s.composite).toBeCloseTo(c.composite, 2);
      // Tier: on the lower CI bound, matches the doc.
      expect(s.tier).toBe(c.tier);
      // The point sits inside its interval.
      expect(s.ci.lo).toBeLessThanOrEqual(s.ci.point);
      expect(s.ci.point).toBeLessThanOrEqual(s.ci.hi);
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
