# Phase A — status (Coins engine, E1→E8)

**Green.** 94 tests passing, `tsc --noEmit` clean, `eslint` clean. Built to the canon in `docs/` (BUILD-KICKOFF, co-pilot spec v01/v02, P0 Build Plan, Dealer-Grade Expert-Panel, Canonical Report Spec v03, Method v21).

## What's built (category-agnostic engine + Coins profile)

| Epic | Package(s) | What |
|---|---|---|
| E1 | `pcs-types`, `data`, `profiles`, `orchestrator`, `supabase/migrations/0001` | Domain model, Repository + InMemoryRepository, versioned category-profile loader (+ Coins, minimal Medals), lifecycle state machine, P0 schema SQL (authored, not applied) |
| E2 | `intake`, `adapters/storage`, `util/hash` | Paid order → report + hashed evidence, profile selection |
| E3 | `ingestion`, `adapters/vision` | Vision attribute-from-image (stub), **mislabel correction**, C2PA gate ④ |
| E4 | `enrichment`, `adapters/{source,embedding,graph,sanctions}` | Source router (PCGS/Numista Tier-1), corpus retrieval (cite, never close), graph cross-ref, sanctions → `ScoreInputs` |
| E5 | `pcs-core` | **Deterministic scorer** (Method v21): quadrant scorers, PCG64 CI engine, tier mapper, critic, Flagged bundle |
| E6 | `report` | Canonical 14-section renderer, hash chain (gate ⑥), watermark |
| E7 | `curator`, `app/curator`, `app/api/v1/curator` | Curator confirm → definitive (immutable signed action, gate ⑨) |
| E8 | `corpus`, `app/api/v1/cron/corpus` | Ingest → chunk → embed → pgvector, Cron batch, learning loop |
| — | `pipeline` | End-to-end orchestrator (E2→E5) + Phase A acceptance test |

**Acceptance A passes:** a real coin runs end-to-end → a provisional a curator confirms → definitive; a mislabelled coin (typed 2008) is auto-corrected to 2007; the engine reproduces the 2007 RCM proof-set report incl. the v01→v02 Silver→Gold evidence ladder; the scorer is deterministic to the digit.

## Stubbed adapters (set the env key to go live — BUILD-KICKOFF §8)

Every external dependency runs behind a flag; a run logs `STUBBED: …` and lists the key it needs.

| Adapter | Env key | Role |
|---|---|---|
| Vision | `VISION_API_KEY` | attribute-from-image + C2PA |
| PCGS | `PCGS_API_TOKEN` | Tier-1 coin ground truth |
| Numista | `NUMISTA_API_KEY` | Tier-1 coin ground truth (image-ID) |
| Embeddings | `EMBEDDINGS_API_KEY` | corpus vectors |
| Sanctions | `TRADEGOV_CSL_KEY` | sanctions + stolen registries |
| Narrative | `NARRATIVE_API_KEY` | report prose (never the number) |

Data layer runs on `InMemoryRepository` + seeded fixtures; `supabase/migrations/0001_pcs_copilot_schema.sql` is authored but **not applied** (the live `veradis-copilot` Supabase project is not provisioned).

## Human checkpoints & go-live tasks

1. **E5 scorer sign-off — CLOSED (13 Jul 2026).** The canonical NumPy reference now exists (`tools/reference/pcs_reference.py`); the engine matches it exactly at the contract precision (2 dp round-half-even) across all seven §12 cases, on Scenario-B (count-based) n_eff, with bit-level RNG parity locked in `np-parity.test.ts`. Ratified in `20260713_INT_BRIEF_PCS-CI-Neff-ScenarioB-Ratification_v01.md` — the governing document for n_eff semantics and the reproducibility contract.
2. **Go-live infra (CTO one-time).** Create the `veradis-copilot` Supabase project + Vercel project; paste the six API keys into env; apply `0001` via the Studio SQL editor (never operating-prod `tchfcyvclcjchoodgdnx`). Then flip the data layer to the Supabase repository.
3. **Outward-facing (needs explicit go-ahead).** Commits are local — the GitHub remote and Vercel git-connect are not wired.

## Known follow-ups (not Phase A scope)

- `pcs-core`/`pcs-types` are self-contained here; reconcile with the monorepo `@veradis/pcs-*` (`~/dev/veradis-platform/packages`) on graduation.
- The verify-this-report **QR image** is a placeholder; the hash chain + permalink are live. A QR encoder is a go-live add.
- Phase B (Watches: forensic vision, Watch Register, brand extracts) and Phase C per the Dealer-Grade review sequence.
