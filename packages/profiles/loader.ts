// Category-profile loader. Profiles are versioned DATA (packages/profiles/data/
// *.json / the category_profile table), not code. The loader validates a profile
// and can seed it into any Repository so the engine reads profiles the same way
// in tests and in production.

import type { Category, CategoryProfile, Quadrant } from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import coinsV1 from "./data/coins.v1.json";
import medalsV1 from "./data/medals.v1.json";
import medalsV2 from "./data/medals.v2.json";
import watchesV1 from "./data/watches.v1.json";
import artV1 from "./data/art.v1.json";
import fineChinaV1 from "./data/fine-china.v1.json";

/** Registry of built-in profiles. A category ships `provisional` (tier capped
 *  to Flagged) until its calibration is validated — a golden set + a validated
 *  real-object field-golden entry (see tests/golden/<cat>-calibration-v1.json).
 *  COINS is calibrated: PCGS/Numista Tier-1 + the 2007 RCM golden ladder. Medals
 *  is structurally full but not yet field-validated; watches, art and fine-china
 *  are ADR-002 SCAFFOLDS, thin-sourced. All non-calibrated categories run
 *  provisional/flagged and cannot seal definitive until their calibration lands. */
const REGISTRY: CategoryProfile[] = [
  coinsV1 as CategoryProfile,
  medalsV1 as CategoryProfile,
  medalsV2 as CategoryProfile,
  watchesV1 as CategoryProfile,
  artV1 as CategoryProfile,
  fineChinaV1 as CategoryProfile,
];

const VALID_QUADRANTS: ReadonlySet<Quadrant> = new Set<Quadrant>([
  "identity",
  "custody",
  "material",
  "risk",
]);

export class ProfileValidationError extends Error {}

/** Structural + invariant validation. Throws `ProfileValidationError` on any
 *  violation so a malformed profile can never reach the scorer. */
export function validateProfile(p: CategoryProfile): CategoryProfile {
  if (!p.category) throw new ProfileValidationError("profile missing category");
  if (typeof p.version !== "number" || p.version < 1) {
    throw new ProfileValidationError(`profile ${p.category} has invalid version`);
  }
  if (!p.identityKeys?.length) {
    throw new ProfileValidationError(`profile ${p.category}@${p.version} has no identity keys`);
  }

  // Identity weights must sum to 1.0 (± float tolerance).
  const sum = p.identityKeys.reduce((acc, k) => acc + k.weight, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new ProfileValidationError(
      `profile ${p.category}@${p.version} identity weights sum to ${sum}, expected 1.0`,
    );
  }

  // Forbidden identity keys (e.g. coins never have a "serial").
  const never = new Set(p.identityNeverKeys ?? []);
  for (const k of p.identityKeys) {
    if (never.has(k.key)) {
      throw new ProfileValidationError(
        `profile ${p.category}@${p.version} uses forbidden identity key "${k.key}"`,
      );
    }
  }

  // Capture slots must feed a real quadrant.
  for (const s of p.captureSlots ?? []) {
    if (!VALID_QUADRANTS.has(s.requiredFor)) {
      throw new ProfileValidationError(
        `profile ${p.category}@${p.version} slot "${s.slotId}" requiredFor invalid quadrant "${s.requiredFor}"`,
      );
    }
  }

  // Optional component-weight override must sum to 1.0 when present.
  if (p.componentWeights) {
    const cw = p.componentWeights;
    const cwSum = cw.identity + cw.custody + cw.material + cw.risk;
    if (Math.abs(cwSum - 1) > 1e-6) {
      throw new ProfileValidationError(
        `profile ${p.category}@${p.version} componentWeights sum to ${cwSum}, expected 1.0`,
      );
    }
  }

  if (p.calibration !== undefined && p.calibration !== "calibrated" && p.calibration !== "provisional") {
    throw new ProfileValidationError(
      `profile ${p.category}@${p.version} has invalid calibration "${p.calibration as string}"`,
    );
  }

  // Safe by default (D-1): a profile that doesn't declare calibration is
  // treated as provisional — a new category can never present a confident tier
  // by omission.
  return { ...p, calibration: p.calibration ?? "provisional" };
}

/** Load a built-in profile by category (latest version, or a pinned version). */
export function loadProfile(category: Category, version?: number): CategoryProfile {
  const forCat = REGISTRY.filter((p) => p.category === category);
  if (!forCat.length) throw new ProfileValidationError(`no profile for category "${category}"`);
  const chosen =
    version !== undefined
      ? forCat.find((p) => p.version === version)
      : forCat.reduce((a, b) => (b.version > a.version ? b : a));
  if (!chosen) {
    throw new ProfileValidationError(`no profile ${category}@${version}`);
  }
  return validateProfile(chosen);
}

/** True when a built-in profile serves this category. A `Category` value can map
 *  (e.g. "cards" / "silver") without a profile existing yet — those cannot be
 *  produced and must be refunded, not run. */
export function categoryHasProfile(category: Category): boolean {
  return REGISTRY.some((p) => p.category === category);
}

/** All built-in profiles (validated). */
export function allProfiles(): CategoryProfile[] {
  return REGISTRY.map(validateProfile);
}

/** Seed every built-in profile into a repository as versioned rows. */
export async function seedProfiles(repo: Repository): Promise<void> {
  for (const p of allProfiles()) {
    await repo.upsertProfile({ category: p.category, version: p.version, json: p });
  }
}
