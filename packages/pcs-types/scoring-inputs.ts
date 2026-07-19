// Scorer INPUT contract (the E4 → E5 boundary). E4 (enrichment) assembles this
// from resolved attributes, source results, corpus corroboration, and risk
// checks; E5 (pcs-core) consumes it deterministically. Field semantics follow
// Method v21 Algorithm §2–§7.

import type { AuthorityState, Category } from "./domain";

/** Identity credit: 1.0 authority-resolved / 0.5 declared-or-corpus / 0.0 missing. */
export interface IdentityCheckInput {
  key: string;
  /** Intra-quadrant weight from the profile (identity weights sum to 1.0). */
  weight: number;
  /** 1.0 | 0.5 | 0.0 per Method v21 §2. */
  credit: number;
  /** false when the attribute is absent (widens CI). */
  present: boolean;
  authorityState: AuthorityState;
}

export interface CustodyGap {
  bucket: "high" | "medium" | "low";
  years: number;
}

export interface CustodyInput {
  /** 0–1 fraction of the ownership timeline documented. */
  coverage: number;
  gaps: CustodyGap[];
  /** 1.0 primary / 0.7 secondary / 0.4 tertiary (Method v21 §3). */
  documentQuality: number;
  /** Number of documented custody events — n_eff trial count under the
   *  count-based §7.2 reading (Scenario B, HoI-ratified 13 Jul 2026).
   *  Defaults to 1 when absent. */
  eventCount?: number;
}

/** Material consistency classes (Method v21 §4). A missing check does NOT lower
 *  the score — it accrues weight that widens the CI. */
export type MaterialConsistency =
  | "consistent"
  | "ambiguous"
  | "inconsistent"
  | "expected_period_replacement";

export interface MaterialCheckInput {
  key: string;
  weight: number;
  consistency: MaterialConsistency;
  /** false when the forensic check wasn't run — widens CI, never lowers score. */
  present: boolean;
}

export type RiskSeverity = "high" | "medium" | "low" | "review";

export interface RiskEventInput {
  kind: string; // e.g. "sanctions", "stolen", "patrimony", "lien"
  severity: RiskSeverity;
}

export interface ScoreInputs {
  objectId: string;
  snapshotTs: string;
  category: Category;
  identity: IdentityCheckInput[];
  custody: CustodyInput;
  material: MaterialCheckInput[];
  risk: RiskEventInput[];
  /** ALR feature flag — false at D5 (Risk quadrant capped at 90). */
  alrEnabled: boolean;
  /** Legal-disclosure restriction → Withheld. */
  withheldDisclosure: boolean;
  /** CI scale factor (10 horology / 5 military / 3 automotive; default 5). */
  scaleFactor: number;
  /** True when the paid stolen-property register add-on actually ran, closing a
   *  second risk trial → tighter risk CI. False/absent = base Verify: the
   *  register was not queried, the risk raw is unchanged (already 90-capped for
   *  partial coverage) but it earns no extra confidence. */
  theftRegistryChecked?: boolean;
  /** True when provenance establishes UNBROKEN ownership from new (single owner
   *  from new / bought new). The stolen-property register is then moot — theft
   *  risk is answered by the provenance itself, not by a screen we skipped — so
   *  Risk resolves clean (the ALR partial-coverage cap does not apply) and earns
   *  a second resolved trial. You do not run a stolen-property check on a coin
   *  someone has owned since it was minted. */
  firstOwnerFromNew?: boolean;
}
