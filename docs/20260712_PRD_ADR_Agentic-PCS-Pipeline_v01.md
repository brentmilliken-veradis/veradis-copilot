# ADR-001 · Agentic PCS pipeline — instant provisional, expert-confirmed definitive

**Status:** Proposed · **Date:** 12 Jul 2026 · **Owner:** Head of Product (for the CTO, month-2 → 05-engineering)
**Drivers:** the immediacy value prop; the honesty register; solo-founder manual scoring today; liability.
**Source of truth:** PCS Methodology v21, SSOT v10. This ADR proposes; the CTO ratifies in 05-engineering.

---

## Context

veradis's promise is immediacy — "is it real, in seconds, every source named." The demo delivers that
because those objects are already in the network. A **new buyer's object is not**: its data must be
gathered and scored, and today the PCS is **methodology applied by hand** (v21 is prose; the scorer is
W2 work). That is the whole reason the purchase flow had to say "24–48h", which fights the pitch.

We resolved the promise to a **two-tier delivery** (decided 12 Jul): a **provisional** report fast, an
**expert-confirmed definitive** report the same day. This ADR defines the engine that makes the
provisional tier instant and keeps the definitive tier defensible — without betraying the honesty
register (a confident-wrong "authentic" is the one failure that kills the brand).

## Decision

Build an **agentic PCS pipeline** that, on payment + photos, produces a **provisional** Provenance
Confidence Score in minutes, gated by a **critic/QA agent that can only withhold or downgrade — never
inflate** — then routes to a human/expert (Brent now, an appraiser later) for the **definitive** report.
Automate the definitive tier later with human-in-the-loop sampling. Every tier names every source.

## Architecture (stages)

1. **Intake.** Order + photos + fields (brand, model, reference, serial, object type). Normalise, store.
2. **Vision pass.** OCR the serial and reference; read hallmarks / silversmith marks / watermarks;
   identify the movement/calibre; detect replacement parts, re-engraving, inconsistencies. Emit
   structured observations, each with a confidence and the crop it came from.
3. **Source agents (parallel), each returns evidence + a citation:**
   - Maker catalogue (reference/serial match) — licensed/ingested per maker.
   - Movement-maker spec (e.g., ETA calibre) — reference data.
   - Trademark — WIPO Madrid (public).
   - Sanctions / risk — OFAC (public), CBP feed.
   - Stolen-property — Art Loss Register / The Watch Register (gated), Interpol (mTLS, gated).
   - veradis network — cross-references in the knowledge graph.
4. **Scorer (methodology-as-code, v21).** Four quadrants — Identity · Material · Risk · Custody —
   locked weights 30/30/25/15, 95% credible interval, **tier by the lower bound**. Apply the caps
   (e.g., Risk capped while stolen-registry coverage is partial). Compute PCS + band + tier.
5. **Critic / QA agent (the guardrail).** Checks, and may only *withhold or downgrade*:
   - **Data sufficiency** — enough signal to answer? If no → **Unscored → automatic refund.**
   - **Source coverage** — is each quadrant backed by a named source? Unsourced claim → drop it.
   - **Citation integrity** — every statement traceable to evidence.
   - **Tier defensibility** — does the tier hold on the *lower* bound, with caps applied?
   - **Contradiction check** — vision vs sources vs network disagree? → flag, widen band, or withhold.
   - **Disclosure** — liability paragraph, refund clause, "provisional" label present.
   - **Fraud signal** — evidence of counterfeit/stolen → **Flagged** (delivered, kept, not refunded).
6. **Provisional report.** Generate the dossier from the template, stamped **Provisional — under expert
   review**, wider band. Buyer gets immediate access (the CARFAX pattern).
7. **Confirm → Definitive.** Human/expert reviews the evidence bundle, confirms or corrects, tightens
   the band; the report of record is issued. Later: auto-definitive for high-confidence categories, with
   a human sampling a percentage for QA.

## State model
`created → paid → provisional → definitive` · plus terminal `unscored` (auto-refund), `flagged`
(delivered/kept), `withheld` (registry-protocol restriction → refund). The provisional and definitive are
versions of one report; the band only ever tightens on confirmation.

## Data sources — live vs gated (procurement matters)
- **Live/public now:** WIPO Madrid, OFAC, CBP, ULAN/VIAF/Wikidata.
- **Gated / needs procurement + GC:** Art Loss Register (dormant, `ALR_ENABLED=false`), The Watch
  Register (dealer API), Interpol (mTLS). Until connected, **Risk is capped and the cap is disclosed** —
  the method naming its own limit, not a flag against the object. This is honest and already in v21.
- **Licensed/ingested:** maker catalogues + movement specs, per category/partner.

## Models / infra
Tri-sovereign posture (SSOT): Apertus (Swiss sovereign) and Cohere in the request path; Anthropic
development-only. **Vision** needs a capable multimodal model — keep the adapter provider-agnostic and
record which model produced each observation (auditability). Orchestration: a durable job runner
(queue + steps + retries) so a slow source agent degrades gracefully rather than blocking the provisional.

## Options considered
- **A · Stay fully manual.** Honest, zero build — but "24–48h", no immediacy, doesn't scale. Rejected.
- **B · Fully automated instant, no human.** Fast — but a confident-wrong verdict is an existential
  brand/liability risk, and registers aren't all connected. Rejected.
- **C · Two-tier: agentic provisional + human-confirmed definitive (this ADR).** Immediacy *and*
  defensibility; the critic gate makes instant safe; scales by automating the definitive later. **Chosen.**
- **D · Instant only for in-network objects.** Good for repeat/collection objects; doesn't serve the
  cold buyer. Folded into C as a fast-path.

## Consequences
**Positive:** delivers the core promise; the critic/QA gate is the moat and the honesty proof; two tiers
let us launch manual now and automate incrementally; strong "verification for the AI economy" investor
story. **Negative / risks:** vision error → mitigated by the critic gate + provisional labelling + band;
gated registers → mitigated by disclosed caps + procurement plan; latency/cost of multi-agent runs →
mitigated by durable orchestration + category-scoped rollout (watches first); auto-verdict liability →
**GC sign-off required** before any tier ships without a human.

## Phasing
- **P0 (now):** manual two-tier — issue a provisional fast (labelled), confirm the same day. No engine.
- **P1:** automate the **provisional** for one category (watches) — vision + the live sources + scorer +
  critic; human still writes the definitive. First proof the pipeline holds.
- **P2:** connect gated registers (ALR / Watch Register / Interpol); add categories (medals, silver, art).
- **P3:** auto-**definitive** for high-confidence bands with human sampling; expand network fast-path.

## Open questions / dependencies
- Scorer-as-code (v21 → deterministic implementation) — the core build (W2 / CTO).
- Register procurement + contracts + GC liability sign-off for automated verdicts.
- Vision reliability thresholds per category (when is an observation trusted vs sent to human).
- Where it runs (populate `veradis-platform`, or the standalone verify app) — see the launch/phase-2 plan.

---
*Ties to: PCS Methodology v21 (quadrants, weights, tier-by-lower-bound, caps, Unscored/Flagged/Withheld),
Legal Appendices v21 (liability, refund, EU disapplication), SSOT v10 (tri-sovereign, entity).*
