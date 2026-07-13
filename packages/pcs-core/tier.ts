// Tier mapper (Method v21 §8) + the critic gate. Tier is taken on the LOWER CI
// bound: "we tier on what we can defend, not what we hope."

import type { Tier } from "@/packages/pcs-types";
import { TIER_BANDS } from "./constants";

export interface TierContext {
  isScoreable: boolean;
  withheldDisclosure: boolean;
  riskOverrideFlagged: boolean; // COMPOSITE_OVERRIDE_FLAGGED present
  ciLo: number;
}

/** §8.1 — gate order: Unscored → Withheld → Flagged-override → band on lower bound. */
export function mapToTier(ctx: TierContext): Tier {
  if (!ctx.isScoreable) return "unscored";
  if (ctx.withheldDisclosure) return "withheld";
  if (ctx.riskOverrideFlagged) return "flagged";
  const lower = ctx.ciLo;
  if (lower >= TIER_BANDS.gold) return "gold";
  if (lower >= TIER_BANDS.silver) return "silver";
  if (lower >= TIER_BANDS.bronze) return "bronze";
  return "flagged";
}

/** §8.2 — data-sufficiency gate. ≥2 of 4 quadrants populated AND Identity non-empty. */
export function isScoreable(populated: { identity: boolean; custody: boolean; material: boolean; risk: boolean }): boolean {
  const count = [populated.identity, populated.custody, populated.material, populated.risk].filter(Boolean).length;
  return populated.identity && count >= 2;
}

/** The critic (ADR-001 / §9). It may only WITHHOLD or DOWNGRADE — never inflate.
 *  Returns the possibly-lowered tier. */
const TIER_ORDER: Tier[] = ["unscored", "withheld", "flagged", "bronze", "silver", "gold"];

export function applyCritic(tier: Tier, downgradeTo?: Tier): Tier {
  if (!downgradeTo) return tier;
  const from = TIER_ORDER.indexOf(tier);
  const to = TIER_ORDER.indexOf(downgradeTo);
  // Only allow a move that is not an upgrade among the positive bands.
  if (to === -1 || from === -1) return tier;
  const positive = new Set<Tier>(["bronze", "silver", "gold"]);
  if (positive.has(tier) && positive.has(downgradeTo)) {
    return to < from ? downgradeTo : tier; // lower band only
  }
  // withhold / flag are always permitted (they never inflate)
  if (downgradeTo === "withheld" || downgradeTo === "flagged" || downgradeTo === "unscored") return downgradeTo;
  return tier;
}
