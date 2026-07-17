# CoPilot Live-Wiring — Re-Red-Team of the v03 Fix Diff

**Date:** 2026-07-17
**Workstream:** OPS
**Diff reviewed:** `adcc4c4..dce42b7` on `feat/live-wiring` (10 fix commits, F-1…F-12). `main` untouched at `3604baf`; nothing deployed.
**Method:** Founder + 3 independent adversarial passes (security / honesty / correctness) over a fresh on-disk snapshot, each mandated to *refute* the fix, plus direct founder verification of the two most serious findings.
**Verdict:** **The four headline gates hold in the engine — CC's work is genuinely strong. But the re-red-team found ONE new deploy-blocker (an unauthenticated privileged route we didn't scope) and five real holes that each partially undo a fix. Still not deploy-ready. Manual admin path stays the fallback.**

---

## Bottom line

The fixes are real, not cosmetic. I verified myself that the thin-source cap is wired end-to-end (the *capped* tier is what's stored, sealed, rendered, and gated at confirm — no raw-tier leak inside the engine), the vision identity-channel is closed in code, cron routes fail closed, tenancy checks precede every write, and the atomic claim + no-fabricated-valuation both work. This is a solid build.

The re-red-team's job was to find what a prompt tweak or a narrow seam could still get through. It found six things worth fixing before a customer touches the live path — one of them serious enough to block on its own.

---

## P0 — deploy-blocker (fix before anything ships)

### R-1 · The curator route has no authentication (CONFIRMED, founder-verified)
`app/api/v1/curator/route.ts` — the endpoint that seals a report to **definitive**, sets the expert valuation band, writes back to the customer's account under the **service-role** key, and emails the customer — has **zero auth**. No secret, no session, no middleware (verified: no `middleware.ts` exists). Anyone who can POST to `/api/v1/curator` with a known `reportId` can confirm/downgrade/withhold any report, inject an arbitrary valuation number, and trigger the "your report is ready" email — and even choose the `curator` name and `credentialClass` written into the *immutable, signed audit record* (`route.ts:36-37`).

This is the trust pivot of the entire product — the "expert-reviewed" step — left open to the public internet. It was **not in the v03 brief**: I scoped F-3 to the three cron routes and missed this one. My omission.

**Fix.** Authenticate the curator route before it can mutate — admin/curator only, fail-closed like the cron routes. The band-entry UI lives in the account-template admin flow (F-8 COORDINATE), so align the auth mechanism with how that admin surface authenticates (admin secret or Supabase admin session). Minimum: no valid admin credential → 401, zero work. Add a route test asserting the deny path does nothing.

---

## P1 — real holes that partially undo a fix (fix before the live path carries a customer)

### R-2 · Vision can still move the score through CUSTODY (honesty — the brand gate)
`packages/enrichment/enrich.ts:206-212`. F-2 closed the *identity* channel (uncorroborated vision value → 0 identity credit). But `resolvedAttributes` — which still carries every vision-changed and vision-added value (`ingest.ts:89-110`) — is passed **unsanitised** into `graph.crossRef({attributes})`, and custody `coverage`/`eventCount` are derived from the links it returns. A vision-hallucinated attribute can raise custody → lift the composite → raise the lower-bound tier, with no corroboration and no offsetting downgrade. Same failure class as the original C-2, one quadrant over.
**Live impact today is low** — the graph adapter is still a stub that ignores attributes — but this is the exact honesty property the company is built on, and it becomes exploitable the moment the real graph adapter is wired. Fix now while the seam is fresh.
**Fix.** Pass only declared + Tier-1/corpus-corroborated attributes into `graph.crossRef` — never uncorroborated vision values. Add a vision-guard test with a graph stub that *does* key off attributes, so the "vision can't lift via any quadrant" property is actually asserted (today's stub is attribute-blind, so R-2 is untestable as written).

### R-3 · The F-5 reclaim path is not atomic — double paid run on crash recovery (CONFIRMED)
`packages/pollers/reports.ts:164-180`. The initial claim is atomic (orders.id PK → `DuplicateOrderError`). But the stale-claim **reclaim** is a non-atomic read-modify-write: two overlapping ticks that both see a `producing` row older than the 15-min window both `updateOrder(attempts+1)` and both proceed into `runProvisional` → double Anthropic spend, double delivery, double curator email — the exact outcome F-5 exists to prevent. The enrich queue's `claimJob` (F-5b) *is* atomic (conditional PATCH); the poller reclaim should mirror it and doesn't. Untested (the concurrency test only covers the fresh-insert claim).
**Fix.** Make the reclaim a compare-and-swap: `updateOrder … WHERE claimedAt = <expected> AND attempts = <expected>`, and only proceed if the update took the row. Add a reclaim-race test.

### R-4 · The cap leaks across the bridge as a raw score (honesty)
`packages/delivery/bridge.ts:61-67`. The cap is deliberately tier-only — composite/CI stay raw (correct inside the engine). But a capped uncalibrated report is still `provisional` → deliverable, and the bridge writes `pcs_score = round(composite)` — the full raw number — onto the customer's accounts `reports` row, with **neither the tier nor `capReason`**. The copilot HTML is honest (Flagged + "not yet calibrated"), but if the account app renders `pcs_score` as a confidence badge on the collections card, an uncalibrated art object shows a confident number on a customer-facing surface.
**Fix (COORDINATE).** For a capped report, don't send a bare `pcs_score` — either omit it or send a cap flag alongside so the account UI can suppress the badge. Confirm with the account-template session how `pcs_score` is rendered.

### R-5 · F-12 self-heal is unreachable on the common failure (CONFIRMED)
`packages/pollers/reports.ts:255-261`. `deliverReport` sets the accounts row to `delivered` *before* `sendCuratorReviewSafely` runs. If delivery succeeds but the email throws (the isolated, likely case — Resend hiccup), the row is now `delivered`, so `listInProductionReports` (which filters `in_production`) never returns it again — the produced-branch retry never fires and the curator review email is lost **permanently**, so the provisional report sits unreviewed. The test masks this by manually resetting the row status between ticks.
**Fix.** Attempt/record the curator email independent of the queue status — send it before the delivery write-back, or drive the retry off `email_log` rather than the in_production queue. Fix the test to cover the email-only failure.

### R-6 · Invalid valuation band mints an orphan curator action (CONFIRMED)
`packages/curator/confirm.ts:52` vs `:77-79`. The cap gate is correctly placed before `addCuratorAction` (good). But the F-8 `valuationBand` validation runs *after* it, so an invalid band (`0–0`, or a band on a Verify report) writes an **immutable, signed** curator action and *then* throws; a retry mints a second one. The audit trail — the record of "the human decision" — ends up with duplicate and never-effective confirmations.
**Fix.** Move the `valuationBand` validation (and the "no valuation section" check) above `addCuratorAction`. Assert `listCuratorActions` length in the guard test.

---

## P2 — test-strength + minor (fix opportunistically, not blocking)
- **Cap test can't tell a demoted Gold from a natural Flagged** (`multicategory.test.ts`): the would-be-Gold art test never asserts the *raw* `score.tier` was actually Gold, so it can't prove the cap is load-bearing. Assert the counterfactual.
- **Cron-auth test skips `corpus` and `curator`** (`cron-auth.test.ts`): corpus fails closed in source but is untested; curator has no guard to test (see R-1). The "zero work" assertion leans only on a fetch-spy.
- **Corpus branch credits a weakly-matched vision-added value** (`enrich.ts:110-122`): a value the owner never declared that clears the 0.35 cosine bar earns 0.5 identity credit. Arguably "corroborated," but 0.35 is a low bar for an invented attribute. Consider a higher bar for vision-added (vs. declared) values.
- **Golden-hash regen check**: removing `fmvLo/fmvHi:0` and adding `capReason` changes `snapshotSha256` for Appraise and uncalibrated-category shapes. Calibrated Verify hashes are preserved. Confirm any pinned golden fixtures for those shapes were regenerated (suite is green, so likely fine — just verify no fixture was skipped).

## Discounted (checked, not real)
- **"F-7 traversal test is missing"** — a staging artifact: `accounts.test.ts` exists in the diff (`+33`); I simply didn't stage it for the reviewers. The traversal validator itself is robust against every vector tried (`..`, leading `/`, `\`, empty segments, `%2e%2e`, absolute URLs, null bytes).

---

## What HOLDS (verified — do not regress)
- **F-1** cap wired end-to-end: stored `version.tier`, sealed `snapshot.score.tier`, status transition, and render all use the *capped* tier; `capReason` lives in the immutable snapshot; confirm-to-definitive is blocked; calibration defaults to `provisional` on two independent layers (loader + run).
- **F-2** identity channel: uncorroborated vision change → 0 credit; vision-added → held-open; corroborated correction still earns full credit. (Custody channel is the R-2 gap.)
- **F-3** cron routes fail closed (unset/empty secret → 500, zero work; wrong bearer → 401; length-guarded compare) on all three cron routes.
- **F-4** ownership checks precede every write/production on both queues (poller, reverify, narrative).
- **F-5** initial claim atomic in both repos; attempts → terminal `failed` after 3, no loop; migration 0003 matches the code; enrich `claimJob` atomic. (Reclaim path is the R-3 gap.)
- **F-6** bounded `getReportByOrderId`. **F-7** traversal validator. **F-8** no fabricated band; only the validated expert band renders. **F-9/F-10/F-11** feed text contract, relink pairing, currency-safe roll-up all hold.

---

## Recommendation
One more small pass — call it the R-punch-list (R-1…R-6) — then a focused re-verify of just those six plus the two test-strength items on the honesty gates. All are copilot-lane except R-1's auth mechanism and R-4's bridge signal, which need a quick word with the account-template session (they own the admin surface and the collections card).

**Guardrail unchanged:** do not merge to `main` or deploy, and above all do not expose the curator route, until R-1 is closed. `main` and the live Vercel deploy stay on the old, safe, manual-delivery state. Nothing found here touches a customer today.
