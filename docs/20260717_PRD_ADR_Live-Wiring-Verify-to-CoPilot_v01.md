# ADR-002 · Wire the live verify.veradis.ai flow to the CoPilot PCS engine (+ multi-category)
**Status:** Proposed (for CTO ratification) · **Date:** 2026-07-17 · **Revised 2026-07-17 → PULL/queue contract** after coordinating with the account-template session. Builds on ADR-001 + PHASE-A-STATUS.

## Context
Phase A (coins) is green in `veradis-copilot` (deterministic scorer, report renderer, curator flow, `runProvisional`). Two sessions share one seam:
- **Account-template session** owns verify-store's account app + `api/create-checkout-session|stripe-webhook|reverify|admin-enrich`, pricing/checkout/currency, and the **veradis-accounts** schema. It built a **job-queue contract**: paid orders, Enrich upgrades and free re-verify seed `reports` rows and `enrichment_jobs`; the account page reads the living-layer tables live (RLS, user reads own rows).
- **This (copilot) session** owns the PCS engine + the copilot Supabase (`lpfmaaeuojextcqhsivs`).
The engine integrates by **writing to the shared veradis-accounts tables via the service role (RLS bypass) — that is the whole contract.** No cross-service push; no edits to the account-template's files.

## Decision (revised — PULL, not push)
1. **Trigger = poll the shared queues on veradis-accounts** (via the accounts service-role client):
   - `reports` where `status='in_production'` → run the PCS pipeline → write back to that row (`pcs_score`, `valuation`, `file_path` in `report-files`, `status='delivered'`).
   - `enrichment_jobs` where `status='queued'` → produce findings → write the living-layer tables → mark the job `done`.
   The earlier push design (`/api/intake/veradis` + a verify-store webhook POST) is **RETIRED** — the account-template webhook does not push, and it is not ours to edit.
2. **Delivery (unchanged).** Write back to the `reports` row. Already matches; `file_path`/`pcs_score`/`status`/`valuation` confirmed on the live veradis-accounts schema (2026-07-17).
3. **Living-layer writer (NEW).** Mirror `api/admin-enrich.js` (service role, per-op inserts, `complete_jobs`): write `enrichment_events`, `object_links`, `threads`, `collection_valuation`, and the `objects` enrich columns (`narrative_html`, `narrative_sources`, `timeline_date`, `enriched_state`), driven off `enrichment_jobs.kind` (first_pass|reverify|relink|revalue|narrative).
4. **Categories + gates unchanged.** Honesty rule holds (new categories provisional/flagged). Living-layer + re-verify are entitlement-gated server-side by the account-template.

## Lanes (do not cross)
- copilot engine + copilot Supabase = this session.
- verify-store account app + `api/*` + pricing/checkout + veradis-accounts schema = account-template session.
- **Shared:** the veradis-accounts DB tables (engine WRITES / page READS) + `reports`. Pricing SSOT `20260717_PRD_LEDGER_Pricing-SSOT_v01.md` — read before touching money.
- **Never edit** `verify-store/index.html` (clobber risk) or any account-template `api/*` file.

## Prerequisites — LIVE (human/CTO)
- Deploy copilot to Vercel (pollers run as cron routes) + env: copilot Supabase creds (done), `ANTHROPIC_API_KEY`, `VERADIS_ACCOUNTS_URL` + its service_role (read photos/queues + write the shared tables), `CRON_SECRET`. No intake signing secret (push retired).
- Flip `DATA_BACKEND` to the copilot Supabase repository. Stripe stays TEST until the SARL/live flip.

## Sequencing
- Done: engine built (E-A..E-F), copilot Supabase provisioned + 0001/0002 applied, Narrative live.
- **Reconciliation pass (v02 brief):** retire push; add report poller + living-layer writer; deploy as crons.
- P2 per category: real Tier-1 sources + calibration + review.
