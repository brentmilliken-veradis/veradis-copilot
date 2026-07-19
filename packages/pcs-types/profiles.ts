// Category-profile shape. Profiles ship as versioned data (the `category_profile`
// table / packages/profiles/data/*.json), NOT code — Canonical Report Spec v03 §6,
// Method v21 (domain inventories). Each profile carries identity keys + weights,
// capture slots, red flags, corpus sources by tier, comparable keys, and optional
// component-weight overrides on the default 30/30/25/15 composite.

import type { Category, Quadrant, SourceTier } from "./domain";

export interface IdentityKey {
  /** Attribute key, e.g. "mint_mark". Coins never use "serial". */
  key: string;
  label: string;
  /** Contribution to the Identity quadrant; the profile's identity weights sum to 1.0. */
  weight: number;
}

export interface CaptureSlot {
  slotId: string;
  label: string;
  guidance: string;
  /** Which quadrant this view feeds (a missing required slot widens that quadrant's CI). */
  requiredFor: Quadrant;
  /** Slot ids this one unlocks once captured. */
  unlocks?: string[];
  /** Whether the slot is part of the core required set. */
  core?: boolean;
}

export interface RedFlag {
  key: string;
  label: string;
  description: string;
}

export interface CorpusSource {
  name: string;
  tier: SourceTier;
  /** Tier-1 can close a check; Tier 2–3 corroborate; Tier-4 is cite-only. */
  role: "ground_truth" | "corroboration" | "cite_only";
  url?: string;
}

/** Optional per-profile override of the default 30/30/25/15 composite weights.
 *  Values are fractions and must sum to 1.0 when present. */
export interface ComponentWeights {
  identity: number;
  custody: number;
  material: number;
  risk: number;
}

export interface CategoryProfile {
  category: Category;
  version: number;
  label: string;
  /** D-1 (fix brief v03): whether this category's sources + weights have been
   *  calibrated. An uncalibrated ("provisional") category can never present a
   *  confident Gold/Silver/Bronze tier — the pipeline caps it to Flagged and
   *  the report stays provisional. Absent = "provisional" (safe by default). */
  calibration?: "calibrated" | "provisional";
  /** Identity attributes + their intra-quadrant weights (sum to 1.0). */
  identityKeys: IdentityKey[];
  /** Keys that must never appear for this category (e.g. coins have no "serial"). */
  identityNeverKeys?: string[];
  captureSlots: CaptureSlot[];
  redFlags: RedFlag[];
  corpusSources: CorpusSource[];
  /** Comparable-sale keys for the Appraise valuation. */
  compKeys: string[];
  /** Material-characterisation slot class (e.g. "surface_and_strike" for coins). */
  materialSlotClass?: string;
  /** Overrides the default 30/30/25/15 composite if present. */
  componentWeights?: ComponentWeights;
  /** An identity key that GATES the complete-provenance Gold lift: the lift only
   *  applies when this key is confirmed by a Tier-1 source. Fine art sets
   *  "artist" — a documented provenance chain reaches Gold only when the artist
   *  is positively confirmed as a documented artist (an unknown/unverifiable
   *  attribution can't ride provenance alone to Gold). Absent = no gate (coins,
   *  watches: the catalogue/reference IS the identity). */
  goldGateIdentityKey?: string;
}
