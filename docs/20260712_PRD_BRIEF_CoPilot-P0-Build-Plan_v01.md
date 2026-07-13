# Co-Pilot P0 — build plan & ticket set (production, Vercel + Supabase)

**Workstream:** PRD · **12 Jul 2026** · directed by Brent, drafted by Claude · for the CTO (or Claude) to execute.
**Confirmed decisions:** all v02 recommendations · **production on Vercel + Supabase** · this is veradis's **first revenue engine** — the fulfilment engine behind the live `verify.veradis.ai` transaction flow · P0 category = **Coins**, then P1 = **Medals** (reproduce Smith VC).
**Builds on:** CoPilot spec v01/v02 · Canonical Report Spec v03 · Method v21 · the `pcs-types` contract · the live `verify_orders` schema.

> The purchase page captures demand (Stripe + Tally, live today). The co-pilot converts a paid order into a **provisional report in minutes → curator-confirmed definitive the same day**. Build the engine category-agnostic; ship the **Coins** profile first.

---

## 1. Production topology (Vercel + Supabase, precise)

| Layer | Runs on | Notes |
|---|---|---|
| Co-pilot app + API + curator UI | **Vercel** (Next app — new `apps/copilot`, or extend `apps/verify`) | API routes; server actions. |
| Per-order **provisional job** | **Vercel background/queued function** | Must stay within the function budget: vision + Tier-1 APIs + top-K corpus lookup + score. Defer deep enrichment. |
| **Corpus ingestion** (scrape + embed) | **Vercel Cron → batch jobs** (or a small worker) | Long-running; never in a request. Refreshes the Reference corpus + embeddings. |
| Data: orders, reports, snapshots, graph | **Supabase Postgres** | Extends the live `verify_orders` tables. |
| Photos + hashes | **Supabase Storage** (`verify-uploads`, exists) | + C2PA/EXIF metadata. |
| **Vector store** | **Supabase `pgvector`** | corpus chunk embeddings. |
| Model serving | external APIs | vision + OCR + embeddings + narrative; record the model per observation (tri-sovereign posture: Apertus/Cohere in path, Anthropic dev). |

Migrations applied via **Supabase Studio paste** against operating prod (per standing rule — no `db push`, no MCP apply).

---

## 2. Data model (new tables, extending the live schema)

```
report                (id, order_id→verify_orders, object_id, category, status, current_version)
report_version        (id, report_id, v, snapshot_jsonb, snapshot_sha256, supersedes_sha256, tier, composite, ci_lo, ci_hi, pdf_path, created_at)
evidence_item         (id, report_id, slot, storage_path, sha256, exif_ts, c2pa_state, kind[photo|doc|linked])
check_result          (id, report_id, quadrant, key, result, authority_state[resolved|declared|missing|corpus], source_id, note)
source_citation       (id, report_id, name, url, retrieval_state[retrieved|pending|not_digitised|access_restricted], tier[1|2|3|4])
correction            (id, report_id, claimed, evidence, corrected_value, kindness_note)     -- the mislabel record
curator_action        (id, report_id, curator, action, credential_class, signed_at, immutable)
category_profile      (id, category, version, jsonb)                                         -- identity keys, slots, red flags, connectors
corpus_document       (id, category, source, url, licence, fetched_at, sha256)
corpus_chunk          (id, corpus_document_id, text, embedding vector, metadata_jsonb)       -- pgvector
```

---

## 3. Epics → tickets (P0 = Coins; every ticket writes to the `pcs-types` contract)

**Epic 1 — Foundations**
- T1.1 Create the schema above (Studio-paste migration) + `pgvector` extension.
- T1.2 Category-profile loader; author the **Coins** profile (identity keys: country/denomination/year/mint/variety; slots: obverse, reverse, edge, mintmark macro, slab label; red flags: cast/tooled, altered date, cleaned, fake slab).
- T1.3 Job model + orchestrator (order → job → stages), idempotent, retryable.

**Epic 2 — Intake & orchestration**
- T2.1 Ingest a paid order: pull Stripe fields + photos (Tally webhook → Storage), create `report` (status `queued`).
- T2.2 Enqueue the provisional job on paid; wire to the live `verify_orders` flow.

**Epic 3 — Ingestion Engine (attribute-from-image + mislabel)**
- T3.1 Vision/OCR pass: read mint mark, date, denomination, legend; grade if slabbed; **C2PA/EXIF anti-fraud gate** (block AI-generated/edited).
- T3.2 **Mislabel detection:** derive maker/type from image; if it contradicts the owner's label → write a `correction`, re-route the profile, re-score. **Acceptance demo: submit a coin labelled wrong; the report corrects it with the kindness note.**
- T3.3 Visual cross-index: **acsearch die-match** + **Numista image-ID** to resolve/confirm identity.

**Epic 4 — Enrichment Engine (router + corpus + graph)**
- T4.1 Source adapters (Tier 1): **PCGS public API** (CoinFacts + APR), **Numista API**. Return `{value, citation, retrieval_state}`.
- T4.2 Corpus retrieval: top-K over `pgvector` from the ingested Tier-2 coin corpus (NNP, acsearch, VarietyVista). **Cite, never close** on Tier 2–4.
- T4.3 Graph cross-ref: query the knowledge graph (tenant + family accounts) for matches; classify Cited/Attested/Linked.
- T4.4 Sanctions/party screen (trade.gov CSL) for the Risk quadrant custody parties.

**Epic 5 — Inference + Verification**
- T5.1 Encode the four quadrant scorers from **Method v21** into `pcs-core` (fill the empty scorer files) — Identity/Custody/Material/Risk; per-check authority states; corrections lower custody, never zero.
- T5.2 Composite (30/30/25/15, arithmetic on face) + **95% CI + tier on lower bound** + Risk cap (ALR-off) + Unscored/Flagged/Withheld routing.
- T5.3 **Critic gate:** may only withhold/downgrade — data sufficiency, every claim cited, tier holds on lower bound, disclosures + liability present, C2PA clean, "authenticated" absent.

**Epic 6 — Report render**
- T6.1 Render the canonical PCS report (Spec v03 skeleton) from the snapshot → HTML + PDF, **watermarked *Provisional — under expert review***; hash chain + attestation block; permalink/QR.

**Epic 7 — Curator confirm → definitive**
- T7.1 Thin curator review page: the drafted report + evidence bundle + one **Confirm/Correct** action → `curator_action` (immutable) → issue **definitive vN**, deliver PDF + online link (reuse the delivery email).

**Epic 8 — Corpus pipeline (batch)**
- T8.1 Ingest the Coins Tier-1/2 corpus (NNP catalogues, acsearch, VarietyVista/CONECA) → `corpus_document`/`corpus_chunk` + embeddings.
- T8.2 Vercel Cron: refresh corpus + re-embed; nudge for missing photos.
- T8.3 **Learning loop:** on definitive issue, write the confirmed report back into the corpus/graph.

**Acceptance (P0 exit):** a real coin order flows end-to-end to a provisional report a curator confirms in ~15 min; a deliberately mislabelled coin is auto-corrected on the face; the pipeline is category-agnostic so **P1 Medals reproduces the Smith VC report from its inputs** on the same engine.

---

## 4. The order → report flow (how it drives sales)

`Stripe paid → report queued → vision (attributes + mislabel) → router (PCGS/Numista) + corpus (acsearch/NNP) + graph → scorers (v21) → CI/tier → critic → PROVISIONAL report (email + online, minutes) → curator confirms (15 min) → DEFINITIVE vN → delivered.` Every empty slot is a named CHF 5 re-run / Appraise-upgrade ask (the revenue mechanic). This is the engine behind the two-tier promise already on the live page.

---

## 5. What's needed to start
- **Ruling:** where it lives — populate the empty `veradis-platform` monorepo, or ship `apps/copilot` standalone on Vercel (**recommend standalone `apps/copilot` on Vercel** for speed, consolidate later).
- **Keys:** PCGS public API token, Numista API key; model-provider keys (vision + embeddings).
- **Pricing ruling:** flat CHF 20 vs Gold/Silver multipliers (needed for the render, not the build).
- **Builder:** CTO-led, or I scaffold `apps/copilot` (schema + orchestrator + Coins profile + the PCGS/Numista adapters + the render + curator page) and hand the scorer-encoding (Method v21 → `pcs-core`) to the CTO.

## 6. Indicative timeline
- **P0 Coins engine:** ~2–3 weeks (foundations + intake + vision/mislabel + router + corpus + scorer + critic + render + curator confirm).
- **P1 Medals (Smith VC):** ~1–2 weeks on the same engine (add the Medals profile + Gazette/VAC/TNA/CWGC adapters + Noonans corpus + regimental-graph cross-ref).

---

*First engine. It fulfils the orders the page already takes, on Vercel + Supabase, honest by construction. AI generates. veradis verifies.*
