# CC Build Brief v02 — Reconcile CoPilot to the pull/queue contract + Enrich living-layer
**For a CC session rooted in `~/veradis-copilot`.** Supersedes the *trigger* design in v01 after coordinating with the account-template session. v01's E-A (vision), E-B (storage), E-D (delivery), E-E (profiles), E-F (data layer) STAND. Only the trigger (was E-C push) changes, and a living-layer writer is added. Sources of truth: ADR-002 (revised), Pricing SSOT, and the shared-contract table below.

## Shared contract — account-template owns these veradis-accounts tables; the engine WRITES via the accounts service role (RLS bypass). That is the entire interface.
- `enrichment_events` (user_id, object_id?, type, title, body, action_url) — type ∈ welcome · link_found · evidence_corroborated · date_corrected · reverify_due · reverify_started · value_changed · narrative_added · thread_opened · thread_resolved.
- `object_links` (user_id, from_object, to_object?, external_ref, relation, source, confidence).
- `threads` (user_id, object_id, question, evidence_needed, status open|resolved, resolved_at).
- `collection_valuation` (user_id PK, low, high, currency, basis full|partial — label partial until all appraised).
- `objects` enrich cols: `narrative_html`, `narrative_sources text[]`, `timeline_date`, `enriched_state` (linked|corroborated|flagged|reverify_due).
- `enrichment_jobs` (user_id, object_id?, kind first_pass|reverify|relink|revalue|narrative, status queued|running|done|failed, detail, started_at, finished_at).
- `reports` (type verify|appraise|pcs, status …→in_production→delivered, `pcs_score`, `valuation`, `file_path` in the `report-files` bucket).
**Mirror these exactly for the write shape:** account-template `api/admin-enrich.js` (living layer) and `api/admin-deliver-report.js` (report write-back).

## Guardrails
- Reuse CC's accounts client (`VERADIS_ACCOUNTS_URL` + service_role) for READ (queues, photos) and WRITE (reports + living-layer). One direction only: engine → accounts tables.
- **Never edit** `verify-store/index.html` or any account-template `api/*` file. Don't push. Keep the suite green, tsc/eslint clean, commit per epic. Everything TEST mode.
- Honesty: new-category / thin-source findings are provisional/flagged. The LLM never emits the number.

## Epics
### R-1 · Retire the push trigger
Park `app/api/intake/veradis/route.ts` and the "webhook POSTs to us" path; drop the `VERADIS_INTAKE_SIGNING_SECRET` requirement. Keep the reusable bits (`toOrderIntake`, photo download, HEIC→JPEG) — the poller feeds them now.

### R-2 · Report poller (PCS reports)
Cron route (pattern: the existing corpus cron; guard with `CRON_SECRET`) reading veradis-accounts `reports` where `status='in_production'` and not already produced by us (dedupe on report id). Per row: load the object (category, title/maker/year → declared attributes, `photo_paths`), download photos, `runProvisional`, then the existing delivery bridge writes back (`pcs_score`, `valuation`, `file_path`, `status='delivered'`). Idempotent; on error leave the row + log.

### R-3 · Enrich living-layer writer
Cron route reading `enrichment_jobs` where `status='queued'`; set `running`, then by `kind`:
- **first_pass** (on Enrich upgrade): build the initial living layer across the user's objects — links, corroboration, timeline dates, sourced narrative (Claude), collection valuation (basis `partial` until all appraised) → write `object_links`, `objects` enrich cols, `collection_valuation`, and emit matching `enrichment_events`.
- **reverify**: re-run PCS on the object → new `reports` version + `reverify_started`/`value_changed` events.
- **relink / revalue / narrative**: targeted single-op equivalents.
Complete via the `complete_jobs` pattern (`done`, or `failed` + `detail`). Match `admin-enrich.js` write shape exactly.

### R-4 · Deploy shape
Both pollers as `app/api/v1/cron/*` routes, `CRON_SECRET`-guarded, idempotent (running→done, failed+detail). Register in `vercel.json` crons.

## Done-when
Paid verify order for a painting → its `in_production` reports row is picked up → provisional PCS produced (Claude vision + prose, deterministic score) → written back → the account page renders it. Enrich upgrade → `first_pass` job picked up → living-layer tables fill → What's-new feed + Stories + Collection value populate. Suite green, per-epic commits, nothing pushed.
