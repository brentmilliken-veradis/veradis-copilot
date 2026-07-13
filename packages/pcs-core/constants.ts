// PCS constants (Method v21). LOCKED — a change here needs a versioned
// methodology brief signed by the Head of Intelligence (CLAUDE.md §8 review).

/** Cross-quadrant composite weights (Method v21 §1). LOCKED. */
export const WEIGHTS = { identity: 0.3, custody: 0.3, material: 0.25, risk: 0.15 } as const;

/** Seed salt — deliberately decoupled from the doc version (§7.3). Changing it
 *  invalidates every cached score. */
export const SEED_SALT = "pcs-v01";

/** Monte-Carlo draws per composite CI (§7.3). */
export const DRAWS = 10_000;

/** Jeffreys prior for v01 launch (§7.2); empirical priors land post-Seaforth. */
export const JEFFREYS = { alpha: 0.5, beta: 0.5 } as const;

/** Identity credit by resolution (§2). */
export const IDENTITY_CREDIT = { resolved: 1.0, declared: 0.5, corpus: 0.5, missing: 0.0 } as const;

/** Material consistency credit (§4). */
export const MATERIAL_CREDIT = {
  consistent: 1.0,
  ambiguous: 0.5,
  expected_period_replacement: 0.7,
  inconsistent: 0.0,
} as const;

/** Custody gap penalties (§3). */
export const GAP_PENALTY = { high: 0.15, medium: 0.05, low: 0.0 } as const;

/** Risk severity penalties (§5). */
export const RISK_PENALTY = { high: 100, review: 25, medium: 15, low: 5 } as const;

/** Risk-quadrant cap while ALR is disabled (§10.3). */
export const ALR_RISK_CAP = 90;

/** Tier bands on the lower CI bound (§8.3). */
export const TIER_BANDS = { gold: 80, silver: 60, bronze: 40 } as const;

export const FLAGGED_FLAG = "COMPOSITE_OVERRIDE_FLAGGED";
export const ALR_PARTIAL_FLAG = "STOLEN_REGISTRY_PARTIAL_COVERAGE";
