// Thin-source tier cap (fix brief v03 F-1, founder decision D-1) — a pure
// function at the pipeline seam, NOT inside the scorer core. An uncalibrated
// ("provisional") category can never present a confident Gold/Silver/Bronze:
// a scored result is clamped to Flagged; the refund states (Unscored/Withheld)
// pass through untouched. Composite + CI are never altered — the cap changes
// only the presented tier, deterministically, so reproducibility holds.

import type { CategoryProfile, Tier } from "@/packages/pcs-types";

export type Calibration = NonNullable<CategoryProfile["calibration"]>;

export function capTier(tier: Tier, calibration: Calibration): Tier {
  if (calibration === "calibrated") return tier;
  switch (tier) {
    case "unscored":
    case "withheld":
      return tier; // refund states — nothing to cap
    default:
      return "flagged"; // gold/silver/bronze/flagged → flagged
  }
}
