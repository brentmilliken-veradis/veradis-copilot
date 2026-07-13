# Co-Pilot — Claude Code execution handoff (build it hands-off)

**12 Jul 2026 · PRD · point Claude Code at this to build P0 autonomously with near-zero founder involvement.**
Brent's constraint: he is fundraising and must not be in the build loop. **Claude Code builds; the CTO owns; the founder reviews once.**

## Read these (the build is fully specified — do not re-decide)
- `20260712_PRD_BRIEF_CoPilot-P0-Build-Plan_v01.md` — the 8 epics + tickets + data model (the work list).
- `20260712_PRD_SPEC_PCS-Appraise-CoPilot_v02.md` — engine design, 5 categories, corpus tiers, architecture map.
- `20260712_PRD_SPEC_PCS-Appraise-CoPilot_v01.md` — pipeline + reuse map + source access model.
- `veradis-v4/_SPEC/…Canonical-Report-Spec_v03.md` — the report the output must reproduce.
- Fixtures (acceptance): RW Don Giovanni · Smith VC group · Tuscan tea service · Salisbury cup.
- `@veradis/pcs-types` (the contract to build to) · `@veradis/pcs-core` (constants; **fill the empty scorer files**).

## Execution rules — proceed on these defaults, do NOT ask the founder
- **Where it lives:** new standalone Next app **`apps/copilot`**, its own git repo, deployed on **Vercel via git integration** (push = deploy — no manual CLI).
- **Database:** a **dedicated `veradis-copilot` Supabase project**, managed entirely through the **Supabase connector/MCP** (create tables, migrations, edge functions, pgvector). **Never touch the operating-prod project** (`tchfcyvclcjchoodgdnx`); that rule stands.
- **Secrets:** never in chat or code — **env vars only** (`.env.local` locally, Vercel/Supabase env in prod). If a key is missing, stub the adapter behind a feature flag and continue; list it in the human-touch checklist, don't block.
- **Pricing on the render:** flat **CHF 20 Verify / CHF 40 Appraise** for now (tier-multiplier ruling deferred).
- **Model serving:** pick one vision+embeddings+narrative provider, isolate it behind an adapter interface so it's env-swappable (tri-sovereign posture later). Record which model produced each observation.
- **Category:** build the engine category-agnostic; ship the **Coins** profile first, then **Medals**.
- **Escalate only true blockers** (a missing paid key, a fixture you cannot reproduce after honest effort). Otherwise proceed, note assumptions in the PR, and keep moving.

## Build order (from the P0 plan)
Epic 1 Foundations → 2 Intake/orchestration → 3 Ingestion (vision + **mislabel correction**) → 4 Enrichment (PCGS/Numista + corpus + graph) → 5 Inference+Verification (encode Method v21; critic) → 6 Render (canonical report, provisional watermark) → 7 Curator confirm → definitive → 8 Corpus pipeline (ingest + embed + learning loop). Commit per epic; write tests; keep green.

## Acceptance gates (prove, then stop)
1. A real **coin** order flows end-to-end → provisional report a curator confirms in ~15 min.
2. A deliberately **mislabelled** coin is auto-corrected on the report face (kindness register).
3. The pipeline is category-agnostic → **P1 Medals reproduces the Smith VC report from its inputs**.

## The ONLY things a human does (none of it is the founder building)
| Task | Who | When | Effort |
|---|---|---|---|
| Create PCGS + Numista accounts + API keys; pick model provider; create the `veradis-copilot` Supabase + Vercel projects; paste secrets to env | **CTO** (or founder once) | before Epic 4 | ~1–2 h, one-time |
| Confirm the scorer reproduces the RW / Smith / Tuscan fixtures | **Founder / Head of Intelligence** | after Epic 5 | a read |
| Curator confirm per order | CTO / hire | ongoing, low volume | ~15 min/order |
| Expert-panel + GC sign-off before **public** launch | external | parallel to fundraising | not a build blocker |

## What is already done (don't rebuild)
Purchase page + Stripe (live, taking test orders) · Tally photo capture · the two-tier promise copy · the report template + fixtures · the `pcs-types` contract · the graph + ingest infra.

---
*Founder footprint = one review. Everything else is Claude Code + the CTO. Build to the fixtures.*
