# CC Build Brief — Live-wire CoPilot + multi-category
**For a CC session rooted in `~/veradis-copilot`.** Source of truth: ADR-002 (this repo, live-wiring), ADR-001 (agentic pipeline), PHASE-A-STATUS, Method v21, and this repo's CLAUDE.md/AGENTS.md golden rules. Execute the epics in order, commit per epic, keep the suite green.

## Already done (do NOT redo)
- **Copilot Supabase is provisioned.** Project `veradis-copilot`, ref `lpfmaaeuojextcqhsivs`, eu-central-1. URL `https://lpfmaaeuojextcqhsivs.supabase.co`. Schema `0001_pcs_copilot_schema.sql` is **applied** (report, report_version, evidence_item, source_citation, check_result, correction, curator_action, category_profile, corpus_document, corpus_chunk + indexes + pgvector). Anon key is in Brent's env notes; `service_role` he pastes.
- **Narrative adapter is LIVE + wired.** `packages/adapters/narrative.ts` has `ClaudeNarrativeAdapter` + `getNarrativeAdapter()` (fetch → api.anthropic.com/v1/messages, honesty ceiling, JSON-section parse, stub fallback). `app/lib/store.ts` `buildAdapters()` now calls `getNarrativeAdapter()`. Do not rewrite it — use it as the pattern for Vision.

## Golden rules (non-negotiable)
- The LLM drafts NARRATIVE only. The deterministic scorer (Method v21) is untouched — no LLM number, ever.
- Honesty ceiling: "verified against the documentary record, expert-reviewed" — NEVER "authenticated".
- New categories ship **provisional · thin-sources · flagged** until real Tier-1 sources + calibration (P2, not this brief). A confident-wrong score is the brand-killer.
- Everything stays Stripe TEST mode; no real customer is exposed. Never touch operating-prod (`tchfcyvclcjchoodgdnx`) or the veradis-accounts schema (the bridge only WRITES to its `reports` rows via service role).
- Keep the 94 tests green; add tests per epic (mock `fetch`/Claude — no real API calls in tests). `tsc --noEmit` clean, `eslint` clean. Commit per epic; note assumptions + stubs. Do NOT push / create a remote without explicit go-ahead.

## Epics (in order)

### E-A · Vision adapter → Claude (multimodal) + image flow
- Live `ClaudeVisionAdapter` mirroring the narrative pattern; behind `VISION_API_KEY || ANTHROPIC_API_KEY`; model via `VISION_MODEL` env (confirm the current Claude model id — do not trust a hardcoded default).
- **Image flow (the real work):** vision currently gets only `{slot, sha256}` (see `ingestion/ingest.ts` L50-54, `VisionRequest`). Thread the image so Claude can see it: add a `storagePath` (or loader) to the evidence passed into `vision.analyze`, and have the live adapter load each image's bytes via the Storage adapter (E-B) and send them as Claude image blocks (`{type:"image", source:{type:"base64", media_type, data}}`).
- Output → `VisionResult` (derivedAttributes, derivedCategory?, redFlags[], c2pa per slot). NEVER invent attributes; if unsure, echo declared. Prompt Claude for strict JSON; parse defensively; fall back to the stub on parse failure. Keep C2PA as today (real C2PA is out of scope; leave `absent` default + a TODO).

### E-B · Real Supabase Storage adapter
- Live `Storage` (behind Supabase creds) replacing `StubStorage` for evidence images — store/load by path in the copilot Supabase Storage bucket. Keep the stub as the no-creds fallback (tests/dev).

### E-C · Intake adapter — verify.veradis.ai order → `runProvisional`
- New `app/api/intake/veradis/route.ts` parallel to the Tally route. Contract: verify-store's stripe-webhook (kind=`report`) POSTs a signed payload (object_id, user, category, declared attributes, photo refs) → map to the copilot intake shape → `runProvisional`.
- Photos live in **veradis-accounts** storage: fetch them (service-role download or signed URL) and pass as evidence into the pipeline. Add a shared signing secret (env) so only verify-store can call this route.

### E-D · Delivery bridge — report → object in veradis-accounts
- On provisional (auto) and on curator-confirmed definitive: render the canonical report (HTML), store it, and write back to the **veradis-accounts** `reports` row on the object (file_path + pcs_score + status: in_production→delivered), replacing manual `admin-deliver`. Cross-project write via `VERADIS_ACCOUNTS_URL` + its service_role (new env). One direction only.

### E-E · Category profiles — art, watches, fine-china (+ medals full)
- Author `profiles/data/<cat>.v1.json` on the `coins.v1.json` structure (identity keys, slots, red flags, sources). SCAFFOLDS — sources thin/uncalibrated → provisional/flagged results for these categories. Extend the `Category` union in `pcs-types` for the new values; ensure loader + scorer accept them.

### E-F · Data-layer flip + env
- Flip `store.ts` from `InMemoryRepository` → the Supabase repository when copilot Supabase creds are present (write to `lpfmaaeuojextcqhsivs`); keep InMemory as the no-creds fallback.
- Env needed: copilot `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`; `ANTHROPIC_API_KEY` (covers vision + narrative); `VERADIS_ACCOUNTS_URL` + its service_role (bridge); intake signing secret.

## Done-when (acceptance)
A paid verify.veradis.ai order for a painting → intake → Claude vision reads the photos → provisional report (Claude prose + deterministic score) → lands on that object in the collector's account → curator confirm → definitive; the art result is correctly provisional/flagged (thin sources). 94+ tests green, tsc + eslint clean, one commit per epic.
