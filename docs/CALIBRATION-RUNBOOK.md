# Calibration Runbook — promoting a category from provisional to calibrated

Every category ships `provisional`: its presented tier is clamped to **Flagged**
(`packages/pipeline/cap.ts`), and a report cannot be confirmed to definitive
(`packages/curator/confirm.ts`). "Calibrated" is a one-bit honesty gate — but the
bit is only honest when the work below is real. A confident-wrong tier is the
brand killer; this runbook is what stands between "the flag is set" and "the
engine has earned the flag."

Watches is the worked example (PRs on `feat/watches-calibration-harness` and
`feat/watches-e2e-path`). Coins, art, porcelain, medals and militaria follow the
same path.

## The gate, in one line

A category may carry `calibration: "calibrated"` only when its **field-golden
set** — real objects with expert-assigned tiers — validates end-to-end, AND its
scoring prerequisites (below) are in place. `packages/profiles/watches-calibration.test.ts`
enforces the coupling in CI: the flag can't be set while `field_golden` is empty
or any entry is unvalidated.

## Prerequisites — the category must be able to score correctly

Before a single tier means anything, confirm each of these exists for the
category (watches needed the first two built; both are done):

1. **Tier-1 source adapters** (`packages/adapters/source.ts`). A category with no
   Tier-1 identity source can never resolve identity to ground truth, so it can
   never earn a confident tier. Watches got `brandArchiveAdapter` (Tier-1
   identity) + `watchChartsAdapter` (Tier-2 corroboration). Each stubs until its
   key lands; a match closes the check, a miss returns an honest `pending`.
2. **Material red-flag mapping** (`MATERIAL_FLAGS` in `packages/enrichment/enrich.ts`).
   The category's integrity flags must be in the set or the material quadrant
   can't register a fake. Watches added `redial, franken, fake_movement,
   overpolished_case`. (Identity/risk tells like `altered_serial` belong to
   those quadrants, not material.)
3. **CI scale factor** (`SCALE_BY_CATEGORY` in `enrich.ts`). Already set per
   category (watches = 10). Higher = data dominates the prior = tighter CI.
4. **Theft / risk source** where the category warrants it. For watches this is
   The Watch Register, wired as the **paid theft add-on** (see the add-on
   decision) — a resolved risk check when purchased, a disclosed *gap* that
   widens the CI when not. Never claim a clean register the engine didn't query.

## The golden set — two obligations

`tests/golden/<category>-calibration-v1.json`:

- **Anchors.** Cases whose expected composite/CI/tier are already ratified
  (Method v21 §12 for watches), reproduced to the digit at the category
  scaleFactor. These prove the *scorer* on known objects. They span the tier
  range — a set that only proves Gold proves nothing; include a known fake that
  must land Flagged.
- **Field-golden.** Real objects run end-to-end through the profile, each with an
  expert-assigned tier and a named ground-truth source (owner-with-papers, dealer
  authentication, brand archive extract). This is what the flip actually waits on.
  **Soft-launch stance:** the honesty ceiling disclaims authentication and the
  tier maps on the lower bound, so a category calibrates on genuine real objects;
  a known-negative (super-clone / franken / redial / tooled or cast counterfeit)
  is **recommended and added when one is sourced — not a launch blocker**. The
  scorer's ability to flag a fake is proven category-independently by the §12
  golden (fake Daytona → Flagged) and the material red-flag mapping. Build a
  fixture per object with `buildWatchFixture`-style helpers, or validate through
  the acceptance path, so it runs through `runProvisional`.

## The flip — one atomic change, only after the golden set is green

1. `packages/profiles/data/<category>.vN.json`: set `"calibration": "calibrated"`
   and drop the "SCAFFOLD / thin sources" language from `label`.
2. `packages/profiles/loader.test.ts`: update the guard's expected array to
   include the newly-calibrated `<category>@N` (the guard comment instructs this).
   Also remove it from the scaffold-label assertion.
3. Confirm `<category>-calibration.test.ts` field-golden entries are non-empty and
   every `validated: true`.
4. `packages/profiles/loader.ts` registry comment + `packages/pcs-types/domain.ts`
   category comment: reflect the new state.
5. Re-run the full suite + `tsc` + `lint`. Then re-score a live object of that
   category and confirm it presents a real tier (not capped, `capReason`
   undefined).

## What "calibrated" does NOT change

The composite and CI are never altered by the flag (`cap.ts`). Calibration only
lifts the tier clamp and opens the confirm-to-definitive path. Missing checks
still widen the CI; the tier still maps on the lower bound; the honesty ceiling
("verified against the documentary record, expert-reviewed" — never
"authenticated") still holds.
