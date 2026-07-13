# veradis PCS / Appraise Co-Pilot — BUILD KICKOFF (consolidated, greenlit)

**13 Jul 2026 · PRD · the single file to hand Claude Code + the CTO.** Greenlit by the founder. Everything below is decided; build it.
**Production:** Vercel + Supabase. **First move:** the CTO runs the one-time keys/accounts session (§8), then Claude Code starts Phase A · Epic 1.

---

## 0. Mission
Build the co-pilot: the **fulfilment engine behind the live `verify.veradis.ai`**. A paid order + photos → a **provisional** Verify (PCS) + Appraise report in minutes → a curator confirms → **definitive** the same day. It must **reproduce the canonical reports** (the 2007 coin-set demo already proved the output, incl. the mislabel correction and the v01→v02 evidence ladder). This is veradis's first revenue engine. The founder is not in the build loop — **Claude Code builds, the CTO owns, the founder reviews once.**

## 1. Canon — read, don't re-decide (all in `/06-prototype/verify-purchase-rebuild-20260711/`)
- `…CoPilot_v01.md` — pipeline, reuse map, first source access model.
- `…CoPilot_v02.md` — engine design, the 5 categories, corpus tiers, architecture-diagram map, the panel.
- `…CoPilot-P0-Build-Plan_v01.md` — epics, tickets, data model.
- `…CoPilot-ClaudeCode-Handoff_v01.md` — hands-off execution rules.
- `…Dealer-Grade-Expert-Panel_v01.md` — the gates that make it dealer-grade + the "never authenticated" ceiling.
- `veradis-v4/_SPEC/…Canonical-Report-Spec_v03.md` — the report the output must reproduce (14 sections).
- Method/Algorithm **v21** (`/04-product/pcs-locked/`) — the scoring maths to encode.
- `@veradis/pcs-types` (build to this contract) · `@veradis/pcs-core` (constants exist; **the scorer files it re-exports are empty — that's the core build**).
- Fixtures (acceptance): RW Don Giovanni · Smith VC · Tuscan · Salisbury · **the live 2007 RCM proof-set report** (`_reports/PCS-CA-2026-0007/`).

## 2. Production topology (Vercel + Supabase — precise)
| Layer | Runs on |
|---|---|
| App + API + curator UI | **Vercel** — new **`apps/copilot`**, own git repo, **git-connected auto-deploy** (no manual CLI) |
| Per-order provisional job | Vercel **background/queued fn** (vision + Tier-1 APIs + top-K corpus + score; defer deep enrichment) |
| Corpus ingest (scrape+embed) | Vercel **Cron batch** (never in a request) |
| DB / graph / orders / reports | **dedicated `veradis-copilot` Supabase project**, managed via the **Supabase connector/MCP** — **never touch operating-prod** `tchfcyvclcjchoodgdnx` |
| Photos + hashes | Supabase Storage |
| Vector store | Supabase **pgvector** |
| Model serving | external APIs (vision · OCR · embeddings · narrative) behind one **adapter interface** (env-swappable; record model per observation) |

## 3. Execution rules (proceed on these defaults; escalate ONLY true blockers)
- `apps/copilot` standalone; own Supabase project via MCP; secrets **env-only** (never chat/code — stub a missing-key adapter behind a flag, list it, keep moving).
- **Deterministic scorer: the LLM drafts narrative, NEVER the number.** Pinned seed; two runs must match to the digit.
- Category-agnostic engine; **Coins first, then Watches**; profiles are versioned data.
- Render pricing flat **CHF 20 / CHF 40** for now.
- **Honesty ceiling (hard): "verified against the documentary record, expert-reviewed" — never "authenticated." No %-of-value fees.**
- Commit per epic, tests green, note assumptions in the PR.

## 4. Data model (Supabase; extends the live `verify_orders`)
`report · report_version(snapshot_jsonb, sha256, supersedes) · evidence_item(hash, c2pa) · check_result(quadrant, authority_state) · source_citation(tier, retrieval_state) · correction(claimed, corrected, kindness) · curator_action(credential_class, signed_at, immutable) · category_profile(version, jsonb) · corpus_document · corpus_chunk(embedding vector)`.

## 5. Source router + corpus (the quality layer)
- **Tier 1 official APIs = ground truth** (can *close* a check). **Tier 2–3 archives = corroboration** (cite + adjust confidence). **Tier 4 forums / dealer YouTube = cite-as-evidence, NEVER ingest as fact** (videos via **transcripts**; cite, don't republish).
- **Coins:** PCGS API, Numista (image-ID), NNP, acsearch (die-match), VarietyVista/CONECA · CoinTalk (T4).
- **Watches:** WatchBase feed, Ranfft, Caliber Corner, serial charts · **The Watch Register** (theft) · Perezcope + forums (T4).
- **Learning loop:** every curator-confirmed report writes its evidence back to the corpus/graph — the moat compounds (100 genuine Rolexes → better future Rolex reports).

## 6. Scoring + guardrails (non-negotiable)
Weights **30/30/25/15** on the face · **95% CI, tier on the lower bound** · missing checks widen the ±, never lower the score · Risk cap ≤90 (ALR-off) + fixed paragraph · Unscored/Flagged/Withheld routing · **corrections first-class** (kindness register) · **capture the provenance narrative + receipt at intake** (Custody quadrant — moves the score) · **sealed-original rule** (intact seal + COA + maker spec = material evidence; never recommend breaking a seal) · **critic may only withhold/downgrade** · independence + staleness lines · hash chain + reproducibility + falsifiability + Method §6 liability verbatim · redaction tiers (owner/insurer/public).

## 7. THE BUILD — ordered epics (P0 engine + dealer gates merged)

### Phase A · Engine foundations + Coins (category-agnostic — proves the pipeline)
- **E1 Foundations** — schema (§4), pgvector, category-profile loader, author the **Coins** profile, job orchestrator.
- **E2 Intake** — paid order → job; pull Stripe fields + Tally photos to Storage.
- **E3 Ingestion** — vision attribute-from-image + **mislabel correction** + **C2PA anti-fraud gate ④**.
- **E4 Enrichment** — source router (PCGS/Numista) + corpus retrieval (pgvector) + graph cross-ref.
- **E5 Inference + Verification** — **deterministic scorer (encode v21) gate ⑤** + composite/CI/tier + **critic**.
- **E6 Render** — canonical report + provisional watermark + **verify-this-report QR + hash chain gate ⑥**.
- **E7 Curator confirm → definitive** — thin review page + `curator_action` (+ credential field, gate ⑨).
- **E8 Corpus pipeline** — ingest Coins Tier-1/2 + embed + **learning loop**.
- **Acceptance A:** a real coin end-to-end → provisional a curator confirms in ~15 min · a mislabelled coin auto-corrected · reproduces the **2007 RCM proof-set** report incl. the **v01→v02 ladder**.

### Phase B · Watches (dealer-grade)
- **E9 Watch profile + movement-first forensic vision** — caliber ID, redial/franken/super-clone tells (Perezcope-class corpus). **gate ①**
- **E10 Stolen-property** — The Watch Register (per-check/partner) + Interpol ID-Art → a real theft-clear line. **gate ②**
- **E11 Brand archive-extract workflow** — orchestrate the owner's extract request as a tracked evidence event (Rolex = none, say so). **gate ③**
- **E12 Co-branding + embeddable listing badge** — dealer logo + veradis; a widget for a product page (CARFAX-on-the-listing). **gate ⑦**
- **E13 Redaction tiers + conformal pricing line.** **gate ⑧**
- **Acceptance B:** reproduces the **RW Don Giovanni** · a genuine + a super-clone test object · theft-clear line · a co-branded listing badge with verify-QR.

### Phase C · Remaining categories
Medals (reproduce **Smith VC**; Gazette/VAC/TNA/CWGC + Noonans + regimental graph) → Cards (Scryfall/pokemontcg.io/PSA) → Silver (reproduce **Tuscan/Salisbury**; hallmark = cert).

## 8. Human-touch checklist (the ONLY human tasks — none is the founder building)
| Task | Who | When |
|---|---|---|
| Create accounts + keys (PCGS, Numista, WatchBase, Watch Register partner, model provider) + the `veradis-copilot` Supabase & Vercel projects; paste secrets to env | **CTO** (one-time ~1–2h) | before E4 / Phase B |
| Confirm the scorer reproduces the fixtures | **Founder / Head of Intelligence** | after E5 (a read) |
| Curator confirm per order (credentialed for high value) | CTO / hire | ongoing, low volume |
| Expert-panel + GC sign-off before **public** launch | external | parallel to fundraising |

## 9. Done already — do not rebuild
Purchase page + Stripe (live, taking orders) · Tally photo capture · two-tier promise copy · report template + fixtures · `pcs-types` contract · graph + ingest infra · the live 2007-set demo report.

## 10. First move
CTO runs §8 row 1 → Claude Code starts **Phase A · E1**. Reproduce the fixtures. Ship Coins, then Watches.

*Reports are the product. So transparent a dealer hands one to a customer; so honest they never say more than they can prove. AI generates. veradis verifies.*
