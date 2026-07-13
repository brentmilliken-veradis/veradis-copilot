// Quadrant raw scorers (Method v21 §2–§5). Pure functions of ScoreInputs — the
// LLM never touches these numbers. Each returns its raw 0–100 score plus the
// metadata the confidence engine (§7) and tier mapper (§8) need.

import type {
  CustodyInput,
  IdentityCheckInput,
  MaterialCheckInput,
  RiskEventInput,
} from "@/packages/pcs-types";
import { ALR_RISK_CAP, GAP_PENALTY, MATERIAL_CREDIT, RISK_PENALTY } from "./constants";

export interface QuadrantRaw {
  raw: number;
  /** Total weight of checks that ran (for CI n_eff). */
  totalWeight: number;
  /** Material only: weight of checks not run (widens CI, never lowers score). */
  missingWeight: number;
  populated: boolean;
  flags: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** §2 — Identity. raw = Σ(weight × credit) × 100. */
export function scoreIdentity(checks: IdentityCheckInput[]): QuadrantRaw {
  let score = 0;
  let totalWeight = 0;
  for (const c of checks) {
    score += c.weight * c.credit;
    totalWeight += c.weight;
  }
  const raw = score * 100;
  return {
    raw,
    totalWeight: totalWeight || 1,
    missingWeight: 0,
    populated: checks.some((c) => c.present),
    flags: raw < 50 ? ["CURATOR_REVIEW"] : [],
  };
}

/** §3 — Custody. raw = clamp(coverage − gapPenalty) × documentQuality × 100. */
export function scoreCustody(input: CustodyInput): QuadrantRaw {
  let gapPenalty = 0;
  for (const g of input.gaps) gapPenalty += GAP_PENALTY[g.bucket];
  const raw = clamp01(input.coverage - gapPenalty) * input.documentQuality * 100;
  return {
    raw,
    totalWeight: 1,
    missingWeight: 0,
    populated: input.coverage > 0 || input.gaps.length > 0,
    flags: raw < 50 ? ["DISCLOSURE_REQUIRED"] : [],
  };
}

/** §4 — Material. Missing checks widen the CI; they never lower the score. */
export function scoreMaterial(checks: MaterialCheckInput[]): QuadrantRaw {
  let weightedSum = 0;
  let weightUsed = 0;
  let missingWeight = 0;
  let inconsistencies = 0;
  for (const c of checks) {
    if (!c.present) {
      missingWeight += c.weight;
      continue;
    }
    weightedSum += c.weight * MATERIAL_CREDIT[c.consistency];
    weightUsed += c.weight;
    if (c.consistency === "inconsistent") inconsistencies++;
  }
  if (weightUsed === 0) {
    return { raw: 0, totalWeight: 0, missingWeight: missingWeight || 1, populated: false, flags: ["NO_FORENSIC_DATA", "CURATOR_REVIEW"] };
  }
  const raw = (weightedSum / weightUsed) * 100;
  const flags: string[] = [];
  if (inconsistencies) flags.push("MATERIAL_INCONSISTENCY");
  if (missingWeight > 0.5) flags.push("CURATOR_REVIEW");
  return { raw, totalWeight: weightUsed, missingWeight, populated: true, flags };
}

/** §5 + §10.3 — Risk. Starts at 100, minus severity penalties; ALR cap ≤90. */
export function scoreRisk(events: RiskEventInput[], alrEnabled: boolean): QuadrantRaw {
  let score = 100;
  let hasHigh = false;
  for (const e of events) {
    score -= RISK_PENALTY[e.severity];
    if (e.severity === "high") hasHigh = true;
  }
  score = Math.max(0, Math.min(100, score));
  const flags: string[] = [];
  if (hasHigh) flags.push("COMPOSITE_OVERRIDE_FLAGGED");
  // §10.3 cap-with-disclosure while ALR is off.
  if (!alrEnabled && score > ALR_RISK_CAP) {
    score = ALR_RISK_CAP;
    flags.push("STOLEN_REGISTRY_PARTIAL_COVERAGE");
  }
  return { raw: score, totalWeight: 1, missingWeight: 0, populated: true, flags };
}
