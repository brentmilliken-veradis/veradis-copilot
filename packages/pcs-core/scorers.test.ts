import { describe, it, expect } from "vitest";
import { scoreIdentity, scoreCustody, scoreMaterial, scoreRisk } from "./scorers";
import type { IdentityCheckInput, MaterialCheckInput } from "@/packages/pcs-types";

describe("quadrant scorers (Method v21 §2–§5)", () => {
  it("identity: raw = Σ(weight × credit) × 100", () => {
    const checks: IdentityCheckInput[] = [
      { key: "a", weight: 0.5, credit: 1.0, present: true, authorityState: "resolved" },
      { key: "b", weight: 0.5, credit: 0.5, present: true, authorityState: "declared" },
    ];
    expect(scoreIdentity(checks).raw).toBeCloseTo(75, 6);
  });

  it("custody: clamp(coverage − gapPenalty) × docQuality × 100", () => {
    const r = scoreCustody({ coverage: 0.9, documentQuality: 1.0, gaps: [{ bucket: "high", years: 8 }] });
    expect(r.raw).toBeCloseTo(75, 6); // (0.9 − 0.15) × 1.0 × 100
  });

  it("material: missing check widens CI (missingWeight) but does not lower the score", () => {
    const checks: MaterialCheckInput[] = [
      { key: "a", weight: 1, consistency: "consistent", present: true },
      { key: "b", weight: 1, consistency: "inconsistent", present: true },
      { key: "c", weight: 1, consistency: "consistent", present: false }, // missing
    ];
    const r = scoreMaterial(checks);
    expect(r.raw).toBeCloseTo(50, 6); // weightedSum 1 / weightUsed 2
    expect(r.missingWeight).toBe(1);
    expect(r.flags).toContain("MATERIAL_INCONSISTENCY");
  });

  it("material: EXPECTED_PERIOD_REPLACEMENT earns 0.7", () => {
    const r = scoreMaterial([{ key: "bracelet", weight: 1, consistency: "expected_period_replacement", present: true }]);
    expect(r.raw).toBeCloseTo(70, 6);
  });

  it("material: no forensic data → raw 0, curator review", () => {
    const r = scoreMaterial([{ key: "a", weight: 1, consistency: "consistent", present: false }]);
    expect(r.raw).toBe(0);
    expect(r.flags).toContain("NO_FORENSIC_DATA");
  });

  it("risk: clean, ALR off → capped at 90 with partial-coverage flag", () => {
    const r = scoreRisk([], false);
    expect(r.raw).toBe(90);
    expect(r.flags).toContain("STOLEN_REGISTRY_PARTIAL_COVERAGE");
  });

  it("risk: clean, ALR on → 100 uncapped", () => {
    expect(scoreRisk([], true).raw).toBe(100);
  });

  it("risk: high-severity hit forces the override flag and floors the score", () => {
    const r = scoreRisk([{ kind: "stolen", severity: "high" }], false);
    expect(r.raw).toBe(0);
    expect(r.flags).toContain("COMPOSITE_OVERRIDE_FLAGGED");
  });

  it("risk: a medium lien subtracts 15 (no cap needed)", () => {
    expect(scoreRisk([{ kind: "lien", severity: "medium" }], false).raw).toBe(85);
  });

  it("risk: the theft add-on adds a second trial (tighter CI) without lifting the raw", () => {
    const base = scoreRisk([], false);
    const withAddon = scoreRisk([], false, true);
    // Same raw (the 90 cap stands)…
    expect(withAddon.raw).toBe(base.raw);
    // …but a second resolved trial → higher n_eff → tighter CI downstream.
    expect(base.totalWeight).toBe(1);
    expect(withAddon.totalWeight).toBe(2);
  });
});
