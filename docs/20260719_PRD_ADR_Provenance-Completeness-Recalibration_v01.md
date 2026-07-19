# ADR — Provenance-completeness recalibration (Method v21 addendum)

Date: 2026-07-19 · Workstream: PRD · Status: Accepted · Owner: Brent (HoI, until CTO onboards)

## Problem

A 2004 Canada "Poppy" proof silver dollar — single owner from new, in its original
Royal Canadian Mint casing and red box, with a serial-numbered COA, and its identity
Tier-1-confirmed by Numista — scored **Silver** (composite 86, CI lower bound 75.9).
So did a brand-new, fully-papered, first-owner Rolex. That is a miscalibration.
Calling an obviously-excellent, completely-documented object Silver is its own
confident-wrong: a collector correctly reads it as a broken engine, and credibility
dies as surely as it does from over-claiming.

The cause was mechanical, not evidential. The tier sits on the CI lower bound, and
the floor was dragged down by two artefacts:

1. **Custody scored provenance by event COUNT, not timeline COMPLETENESS.** A
   single-owner-from-new history has a *short but complete* ownership record
   (dealer/mint → owner, done). The old scorer treated "few provenance events" as
   "uncertain" and capped description-based coverage at 0.35 — penalising a
   complete compact record the same way it penalised a vague one.
2. **The stolen-property register was held open as a gap** on every object without
   the paid theft add-on — including objects whose provenance is unbroken from new,
   where the register is *moot*. You do not run a stolen-property check on a coin
   someone has owned since it was minted; the theft question is answered by the
   provenance itself.

## Decision

Three changes, all gated behind the calibration honesty gate and validated against
Gold / Silver / Flagged anchors (`packages/enrichment/recalibration-anchors.test.ts`,
`packages/pipeline/watches-e2e.test.ts`).

1. **Custody = timeline completeness.** When provenance establishes an unbroken
   ownership record from new (single owner from new / bought new / held since new)
   AND that claim is backed by at least one document (COA, receipt, original
   packaging, or a named chain), the record is COMPLETE: coverage floors at 0.95,
   quality at 0.95 with a serial-numbered COA/receipt, and every provenance signal
   (plus the completeness itself) counts as a trial — a coherent complete record
   earns a tighter interval, not just a shifted point. `deriveProvenanceCustody`
   returns `firstOwnerFromNew` and `completeTimeline`.

2. **Risk resolves clean when the register is moot.** For a documented
   first-owner-from-new object the stolen-property register is not applicable, so
   the §10.3 ALR partial-coverage cap does not apply (Risk can reach 100) and a
   second resolved risk trial is earned (tighter CI). The report discloses the
   basis honestly: "unbroken ownership from new — stolen-property register not
   applicable." The paid add-on remains meaningful for secondhand or high-value
   objects, where an independent screen adds assurance a claim cannot.

3. **A material red flag can never present Gold/Silver.** Because the recalibration
   makes identity, custody and provenance count for more, a materially-inconsistent
   object (redial, cast seam, wrong metal, re-engraving) with a polished story could
   otherwise drift up to Silver — the exact confident-wrong we refuse. Two guards:
   a material inconsistency VETOES the complete-timeline lift (a forged COA buys no
   custody credit and no clean register), and the presented tier is capped at Bronze
   regardless of how strong the other quadrants look.

## What does NOT change

The negative anchors hold, proven end-to-end: a genuine coin with confirmed identity
but NO provenance stays **Silver** (identity-confirmed-but-provenance-unknown is
honestly only mid-confidence); an undocumented "owned from new" claim stays
**Silver** (a bare claim cannot buy Gold); the super-clone stays **Flagged**. The
lift is earned only by *documented* completeness plus confirmed identity plus
consistent material — never by a provenance claim alone. Provisional Gold lands
~88–93; 95+ remains reserved for expert-confirmed / definitive.

## Anchors (ground truth)

| Object | Provenance | Tier |
|---|---|---|
| 2004 Poppy proof dollar (Numista #27776) | single owner from new, RCM casing + COA no. 03340 | **Gold** (86 floor) |
| Rolex Sub 16610, full set | single owner from new, box + card + receipt | **Gold** |
| Same coin / watch, identity confirmed, no provenance | none | **Silver** |
| "Owned from new", no documents | undocumented claim | **Silver** |
| Super-clone Daytona (redial + non-genuine movement) | — | **Flagged** |

## Consequences

Constants unchanged (weights 30/30/25/15, tier bands, DRAWS, priors all LOCKED).
The recalibration lives in the enrichment→score boundary (custody coverage/quality/
trials, the risk moot-register flag) and one tier-cap guard in the scorer. Two runs
of the same object still match to the digit. Follow-up: structured intake questions
(acquisition mode, first-owner, documents held) so the signals are captured reliably
for owners who don't write a full description, rather than only parsed from free text.
