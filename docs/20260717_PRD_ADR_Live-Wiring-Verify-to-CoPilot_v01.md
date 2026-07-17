# ADR-002 · Wire the live verify.veradis.ai flow to the CoPilot PCS engine (+ multi-category)
**Status:** Proposed (for CTO ratification) · **Date:** 2026-07-17 · builds on ADR-001 (agentic pipeline) + PHASE-A-STATUS.

## Context
Phase A (coins) is green in `veradis-copilot`: deterministic scorer (Method v21, NumPy-parity to the digit), 14-section report renderer, curator confirm→definitive, corpus/RAG, `runProvisional` orchestrator. But: its intake is a **Tally webhook**; it runs on **stubbed adapters + InMemoryRepository** (the dedicated copilot Supabase is unprovisioned); and the **live consumer flow** (verify.veradis.ai store + veradis-accounts) delivers reports **by hand** via `/admin`. Goal: a real paid order auto-produces a report via the engine, stored on the object in the collector's account, across the categories Brent collects — wired **before any paying customer**. Today that's protected by Stripe **TEST mode**; real customers are gated on the SARL live-flip, so the runway exists.

## Decision
1. **Intake adapter (new).** verify.veradis.ai paid `report` order (Stripe webhook + the object's photos/fields from veradis-accounts storage) → copilot `intake` → `runProvisional`. Sits parallel to `app/api/intake/tally/route.ts`; reuses the same category-agnostic intake.
2. **Delivery bridge (new).** copilot **provisional** (auto) + **curator-confirmed definitive** report → written onto the veradis-accounts `reports` row on the object (file + score + status), replacing manual `admin-deliver`. Two Supabase projects; one-way bridge via service role.
3. **Categories are data-driven** (`profiles/data/<cat>.vN.json` via `loader.ts`). Today: **coins** (full), **medals** (minimal). Add **watches, art, fine-china, medals(full)** — each = profile JSON + Tier-1 sources + calibration.
4. **Gates unchanged.** ADR-001 critic/QA agent (may only withhold/downgrade) gates the provisional; the curator (Brent) confirms the definitive.

## Prerequisites — LIVE blockers (human/CTO; the build agent cannot do these)
- Provision the dedicated **copilot Supabase** + apply `0001` schema (never operating-prod `tchfcyvclcjchoodgdnx`). Cost decision.
- Enter the **six API keys** (Vision · PCGS · Numista · Embeddings · Sanctions · Narrative) into env — never in the repo. Credentials are entered by a human, not the agent.
- Deploy copilot (Vercel + git remote) — needs explicit go-ahead.
Until these land, the engine runs on stubs (canned data): good for wiring + tests, not for a real score.

## Honesty rule for new categories (non-negotiable)
A category ships to a **paying customer** only after its **real Tier-1 sources + calibration + a Dealer-Grade-style review** — the depth coins got. Before that it runs **provisional · thin-sources · flagged**: fine for **Brent's own collection testing**, never for a customer. A confident-wrong score is the one failure that kills the brand (ADR-001).

## Sequencing
- **P0 — now, no keys:** build the intake adapter + delivery bridge against stubs/InMemory; scaffold `watches/art/fine-china/medals-full` profiles so objects flow end-to-end; write tests.
- **P1 — CTO provisions:** keys + copilot Supabase → **coins & medals live** end-to-end through the real store.
- **P2 — per category:** Vision + Narrative keys first (so real photos read + prose drafts), then Tier-1 sources + calibration + review, category by category (watches → art → china …).
- **Gate:** all of it before the SARL / Stripe-live flip. No real customer exposed.
