// Scoring output types (Method v21). The deterministic scorer produces these;
// the LLM never touches the numbers. Scorer INPUT types live with the scorer
// itself (packages/pcs-core, E5) so the input contract can evolve there.

import type { Quadrant, Tier } from "./domain";

export interface ConfidenceInterval {
  /** Point estimate (mean of the composite Monte-Carlo draws). */
  point: number;
  /** 2.5% quantile — the lower bound the tier is taken on. */
  lo: number;
  /** 97.5% quantile. */
  hi: number;
}

export interface QuadrantScore {
  quadrant: Quadrant;
  /** Raw 0–100 quadrant score. */
  raw: number;
  /** Weight actually used (Material: sum of weights of present checks). */
  weightUsed?: number;
  /** Accrued weight of missing checks — widens the CI, never lowers the score. */
  missingWeight?: number;
  ci: ConfidenceInterval;
}

/** Flagged finding taxonomy (Method v21 §5.1). */
export type FlaggedFinding =
  | "counterfeit"
  | "stolen"
  | "sanctions_hit"
  | "patrimony_dispute"
  | "material_inconsistency"
  | "identity_mismatch"
  | "mixed";

/** Delivered with every Flagged report; Flagged is paid (kept), 14-day appeal. */
export interface FlaggedEvidenceBundle {
  finding: FlaggedFinding;
  primarySources: string[];
  supportingChecks: string[];
  contradictions: string[];
  appealWindowDays: 14;
  curatorContact: string;
}

export interface PcsScore {
  /** Composite = 0.30·I + 0.30·C + 0.25·M + 0.15·R (default weights). */
  composite: number;
  ci: ConfidenceInterval;
  tier: Tier;
  quadrants: QuadrantScore[];
  /** Present iff tier === "flagged". */
  flagged?: FlaggedEvidenceBundle;
  /** Hex of the SHA-256 seed material — proves the deterministic run. */
  seedHex: string;
  /** data-sufficiency gate: ≥2 of 4 quadrants populated AND Identity non-empty. */
  isScoreable: boolean;
}
