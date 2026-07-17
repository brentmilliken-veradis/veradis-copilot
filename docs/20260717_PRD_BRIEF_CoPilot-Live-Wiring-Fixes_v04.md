# CoPilot Live-Wiring — Fix Directive v04 (post re-red-team)

**Date:** 2026-07-17
**Workstream:** PRD (build lane 13)
**For:** CC (Claude Code) — veradis-copilot repo, branch `feat/live-wiring`
**Follows:** v03 fixes (`adcc4c4..dce42b7`, landed) and `20260717_OPS_RPT_CoPilot-Re-RedTeam-Pre-Deploy_v02.md` (findings).
**Status:** Blocks deploy. R-1 is a P0 — the live path cannot be exposed until it lands. `main` stays on the old, safe, manual-delivery state.

---

## 0. Read first

The v03 fixes are solid — the four headline gates hold in the engine. The re-red-team found one unauthenticated privileged route (P0) and five holes that each partially undo a fix (P1). This directive closes them. Grounded against the current `feat/live-wiring` code with file:line refs.

**Golden rules unchanged:** deterministic scorer owns the number; the LLM (and vision) may only withhold/downgrade, never lift it — through *any* quadrant; uncalibrated categories present provisional/flagged only; honesty ceiling stays "expert-reviewed, not a certified appraisal"; confident-wrong is the brand-killer.

**Lane:** copilot only. All fixes are copilot-lane except two **COORDINATE** items that touch the account-template's surfaces: R-1's auth mechanism (they own the admin UI that calls the curator route) and R-4's `pcs_score` handling (they own the collections card). Raise both with the account-template session before merge; note their answers in the completion report.

**Process (unchanged from v03):** conventional commits, one per R-item, Vitest tests required (security/tenancy/honesty tests non-negotiable), tsc strict + eslint clean. **Push each commit to `feat/live-wiring` as you go — GitHub is the source of truth.** Do **not** merge to `main`, do **not** deploy, do **not** expose the curator route until R-1 lands and the diff is re-verified.

*(Housekeeping: a scratch file was moved to `docs/_to_delete/` during the re-red-team — safe to delete.)*

---

## P0 — deploy-blocker

### R-1 · Authenticate the curator route (fail-closed)
**Problem.** `app/api/v1/curator/route.ts` has no auth of any kind — no secret, no session, no middleware. It seals reports to definitive, sets the valuation band, writes back to the customer's account under the service-role key, and emails the customer. It also trusts `body.curator` and `body.credentialClass` (`route.ts:36-37`) for the *immutable, signed* audit record. Anyone who can POST with a known `reportId` controls the entire "expert-reviewed" pivot.

**Fix.**
1. Gate the route fail-closed before any work, mirroring the cron pattern. Add a `checkAdminAuth(request)` helper (reuse the `app/lib/cron-auth.ts` fail-closed + `timingSafeEqual` shape) keyed on a new env secret `CURATOR_AUTH_SECRET`: unset/empty → 500 and zero work; wrong/missing bearer → 401 and zero work; valid → proceed. No `getStore()`, `confirmReport`, `deliverReport`, or email on the deny path.
2. Do **not** trust `body.curator` / `body.credentialClass` for the audit record. With the shared-secret (server-to-server) model, the caller is the authenticated account-template admin backend — treat the identity it passes as trusted-transitively, but default `credentialClass` server-side and record the auth context. Add a code comment: once there is more than one human curator, the identity must come from an authenticated per-user session, not a spoofable body field.
3. **COORDINATE** with the account-template session: confirm how their admin flow will authenticate to this route (shared secret now; Supabase admin JWT is the hardening target). The route must authenticate whatever they call it with.

**Acceptance.** No `CURATOR_AUTH_SECRET` → 500, zero side effects. Wrong/missing bearer → 401, zero side effects (no confirm, no deliver, no email, no curator_action row). Valid bearer → confirms as today.

**Tests.** Route tests for unset-secret (500), wrong-bearer (401), valid (200) — each asserting the deny paths produce no repo writes / no `addCuratorAction` / no email (spy-verified).

---

## P1 — holes that partially undo a v03 fix

### R-2 · Close the vision→custody proxy (the honesty gate)
**Problem.** `packages/enrichment/enrich.ts:206-212` passes `resolvedAttributes` — which still carries uncorroborated vision-changed and vision-added values (`ingest.ts:89-110`) — into `graph.crossRef({attributes})`. Custody `coverage`/`eventCount` derive from the returned links, so a vision-hallucinated attribute can lift the composite and tighten the CI through custody, with no corroboration. F-2 only closed the identity channel. (Live impact is low today — the graph adapter is a stub — but this is the brand-critical property; fix it while the seam is fresh.)

**Fix.**
1. In the identity loop, accumulate a `corroboratedAttributes: Record<string,string>` containing only values that are the owner's *unchanged declaration* or that earned **Tier-1 or corpus** credit (authorityState `resolved`/`corpus`). Exclude any value that exists only because vision changed or added it with no corroboration (the `credit = 0` branches at `enrich.ts:133-146`).
2. Pass `corroboratedAttributes` — not `resolvedAttributes` — into `adapters.graph.crossRef` (`enrich.ts:206-212`). Vision can no longer reach custody uncorroborated.
3. Leave `resolvedAttributes` as-is for *display* (it's honest to show the vision reading with its "not credited" note); the change is strictly what feeds the scorer's custody inputs.

**Acceptance.** A vision-added or vision-changed attribute with no Tier-1/corpus corroboration cannot raise custody coverage/eventCount or the composite. A corroborated correction still flows to custody as before.

**Tests.** Add a vision-guard case with a graph stub that **keys off attributes** (returns a link only when a given attribute is present): assert that a vision-added attribute does **not** raise the composite vs. the missing-attribute baseline. (Today's attribute-blind stub cannot catch this — the new stub is the point.)

### R-3 · Make the F-5 reclaim atomic (no double paid run)
**Problem.** `packages/pollers/reports.ts:164-180`. The initial claim is atomic (orders.id PK). The stale-claim **reclaim** is a non-atomic read-modify-write: two overlapping ticks both see a `producing` row past the staleness window, both `updateOrder(attempts+1)`, both run `runProvisional` → double spend, double delivery, double email. The enrich `claimJob` already does this atomically; the poller doesn't.

**Fix.** Replace the reclaim `updateOrder` with a compare-and-swap. Add `reclaimStaleOrder(id, expectedClaimedAt, expectedAttempts): Promise<Order | null>` (or extend `updateOrder` with a conditional WHERE): Supabase PATCH filters `claimed_at=eq.<expected>&attempts=eq.<expected>` with `return=representation`; if it returns no row, another tick won the reclaim → return `skipped("claimed by another tick")`. In-memory mirrors the guard. Only proceed to production when the CAS took the row.

**Acceptance.** Two concurrent ticks over the same stale `producing` row → exactly one re-runs production; the other skips. No path runs `runProvisional` twice for one report.

**Tests.** Reclaim-race test (two `processAccountsReport` calls over a stale `producing` order → one produces, one skips, one `runProvisional`). Keep the existing fresh-insert concurrency test.

### R-4 · Don't leak the uncapped score across the bridge (COORDINATE)
**Problem.** `packages/delivery/bridge.ts:61-67` writes `pcs_score = round(version.composite)` — the raw number — onto the customer's accounts `reports` row for a capped uncalibrated report, with no tier and no `capReason`. The copilot HTML is honest (Flagged + note), but the structured `pcs_score` field isn't; if the account card renders it as a confidence badge, an uncalibrated category shows a confident number.

**Fix.** For a capped report (`snapshot.capReason` set), do not write a bare confident `pcs_score`. Default: **omit `pcs_score`** from the delivery patch when `capReason` is present (the patch field is optional — no schema change; the card has no number to badge). **COORDINATE** with account-template: confirm how they render `pcs_score`, and whether they'd prefer a cap flag alongside instead of omission. The report file (HTML) still delivers with the Flagged verdict and the "not yet calibrated" line — only the structured number is withheld.

**Acceptance.** A capped report's delivery patch carries no confident `pcs_score` (omitted or flagged per the coordinated decision); an uncapped report is unchanged.

**Tests.** Bridge test: capped snapshot → patch has no bare `pcs_score`; uncapped snapshot → `pcs_score` present as today.

### R-5 · Make the curator-review email actually self-heal
**Problem.** `packages/pollers/reports.ts:255-261`. `deliverReport` sets the accounts row to `delivered` before `sendCuratorReviewSafely` runs. If delivery succeeds but the email throws, the row is now `delivered` and never returns from `listInProductionReports`, so the produced-branch retry never fires — the curator review email is lost permanently and the report sits unreviewed. The "self-heal" is unreachable, and its test masks this by manually resetting the row status.

**Fix.** Decouple the curator-review retry from the accounts in_production queue. Record the curator-review email intent in copilot's own `email_log`, and add a small **copilot-side sweep** each reports tick that finds copilot reports still `provisional` with no `curator_review` entry in `email_log` and resends (dedupe on `email_log`). This is copilot-only, independent of the accounts queue. (Attempting the email before the delivery write-back is fine as a first try, but the durable fix is the queue-independent sweep — a flaky internal email must never block or lose against customer delivery.)

**Acceptance.** Delivery succeeds + curator email throws → the next tick re-sends the curator email (driven off `email_log`, not the in_production queue); once sent, it is not re-sent.

**Tests.** Rewrite the F-12 test to cover the **email-only** failure (delivery ok, email throws) without hand-resetting the queue status; assert the sweep resends exactly once.

### R-6 · Validate the valuation band before minting the audit action
**Problem.** `packages/curator/confirm.ts:52` `addCuratorAction` runs before the F-8 `valuationBand` validation at `:77-79`. An invalid band (`0–0`, or a band on a Verify report) writes an immutable signed curator action and *then* throws; a retry mints a second one. The audit trail ends up with duplicate/never-effective confirmations.

**Fix.** Move the `valuationBand` checks — the "no valuation section" throw (`:77`) and the `0 ≤ lo ≤ hi`, not-`0–0` validation (`:78-79`) — **above** `addCuratorAction` (`:52`), alongside the cap gate (which is already correctly placed at `:44-49`). Validate all inputs, *then* mint the immutable action.

**Acceptance.** An invalid `valuationBand` throws with **no** `curator_action` row written; a valid confirm mints exactly one.

**Tests.** Guard test asserts `listCuratorActions(reportId)` is empty after an invalid-band throw, and length 1 after a valid confirm.

---

## P2 — test-strength + minor (fix opportunistically, not blocking)
- **Cap counterfactual** (`packages/pipeline/multicategory.test.ts`): the would-be-Gold art test should assert the *raw* `score.tier` was actually gold/silver/bronze before the cap, so it proves the cap is load-bearing (not just that art scored Flagged anyway).
- **Cron-auth coverage** (`app/api/v1/cron/cron-auth.test.ts`): add the `corpus` route to the fail-closed cases; add the curator route once R-1 lands.
- **Corpus bar for vision-added** (`enrich.ts:110-122`): a vision-*added* value (owner never declared) that clears the 0.35 cosine bar earns 0.5 identity credit. Consider a higher corroboration bar for vision-added vs. declared values, or a test pinning the intended behaviour.
- **Golden hashes**: confirm any pinned golden `snapshotSha256` fixtures for Appraise and uncalibrated-category shapes were regenerated (removing `fmvLo/fmvHi:0` and adding `capReason` changes those hashes; calibrated Verify hashes are unchanged). Suite is green, so likely done — just verify none was skipped.

## Out of scope / do not touch
- account-template files and the veradis-accounts schema (R-3 uses copilot's own `orders` columns; R-4 uses the existing optional `pcs_score` patch field — no accounts schema change).
- seaforth-operating-prod: never.
- The scorer core (`packages/pcs-core`): R-2 attaches at the enrich seam, not inside `scorePcs`.

## Definition of done
- R-1…R-6 landed with tests; P2 items addressed or explicitly deferred with a note.
- `tsc` strict + eslint clean; full Vitest suite green (report the new count).
- Each R-item a conventional commit, pushed to `feat/live-wiring` as you go. **Not merged to `main`, not deployed, curator route not exposed** until re-verify passes.
- COORDINATE answers (R-1 auth mechanism, R-4 `pcs_score`) captured in the completion report.
- Completion report lists each R-item, the tests added, and anything flagged. Then we re-verify the diff — R-1 (deny path does nothing), R-2 (vision can't lift via custody, with the attribute-keyed stub), and R-3 (reclaim race) especially.
