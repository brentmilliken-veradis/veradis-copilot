# veradis.ai — PCS Methodology Brief v21

**File:** `20260511_INT_BRIEF_PCS-Methodology_v21.md`
**Workstream:** INT
**Date:** 11 May 2026 (v21 reconciliation) · 12 May 2026 (v20 lock; body unchanged)
**Status:** v21 LOCKED — founder-signed production lock. v20 → v21 closes audit RED flag R9 (frontmatter Companion pointer). Body §1–§10 unchanged from v20.
**Custodian:** Head of Intelligence (4-quadrant taxonomy + weights + tier-band thresholds — versioned brief required for any further change)
**Companion (all v20/v21 LOCKED for D5 production pair):** `20260511_PRD_SPEC_PCS-Algorithm_v21.md` (technical implementation) · `20260511_PRD_SPEC_PCS-Build-Plan_v21.md` (engineering plan) · `20260511_LEG_BRIEF_Verify-Disputes-Publicity-NDA_v20.md` (Stripe disputes, publicity, NDA) · `20260511_MKT_DRAFT_Marketing-Site-Copy_v21.md` (LOCKED) · `20260511_MKT_BRIEF_Marketing-Site-Visual-Direction_v20.md` (LOCKED)
**Supersedes:** v20 (12 May 2026, archived to `_ARCHIVE/_ARCHIVE_20260512_INT_BRIEF_PCS-Methodology_v20.md`) · v10.1 (8 May 2026, archived to `_ARCHIVE/_ARCHIVE_20260508_INT_BRIEF_PCS-Methodology_v10-1.md`) · Refund Policy Amendment v01 (11 May 2026, folded into v20, archived to `_ARCHIVE/_ARCHIVE_20260511_INT_BRIEF_PCS-Methodology-Refund-Policy-Amendment_v01.md`)
**Source:** SSOT v10 §11 · 28 April PCS Brief · v10.1 Methodology Brief · 11 May Refund Policy Amendment

---

## v20 → v21 changelog

Frontmatter only. No body changes.

| Audit flag | Section touched | Change |
|---|---|---|
| R9 | Frontmatter Companion line | `20260511_LEG_BRIEF_Verify-Disputes-Publicity-NDA_v02.md` → `_v20.md` (legal companion lock-marker bumped to v20; substantive content unchanged) |
| — | Frontmatter Companion line | PCS Algorithm + PCS Build Plan + Marketing Copy pointers updated from `_v20.md` → `_v21.md` to reflect the v21 set published 11 May 2026 |
| — | Frontmatter File / Status / Supersedes | Re-tagged v20 → v21 per the audit closure |

Body §1–§10 reproduced verbatim from v20. Quadrant weights (30/30/25/15), tier bands, §5 worked example PCS 93.35 / Gold, §6 liability paragraph, §7 Withheld framework, §9 commercial model — all unchanged.

---

**Lock notes — working drafts → v20 LOCKED**

v20 is the founder-signed production lock of the methodology document for the D5 launch and the W3 methodology paper. The lock-marker bump aligns the methodology with the marketing copy v20 and visual brief v20 — all D5-launch companions read v20 LOCKED so engineering, GC, Heritage Intelligence, and the design team work from a single in-sync founder-signed pair. The v10.x semver lineage is preserved through the supersedes chain (v10 → v10.1 → v10.2 working draft → v20 LOCKED).

**Substantive changes from v10.1, carried into v20:**

1. **Tier-band thresholds shift.** §4 reads Gold 80–100 / Silver 60–79 / Bronze 40–59 / Unscored = data-sufficiency / Flagged 0–39. Was 90/75/60/40/0 in v10.1.
2. **Flagged is a paid deliverable.** §4 + new §9. The customer paid to find out; when the network finds counterfeit / stolen / inconsistent, that is the answer they receive — with evidence. Refund triggers move from `{Unscored, Flagged}` to `{Unscored}` only.
3. **Withheld is the sixth output state.** New §7. For Flagged findings where the matching registry's disclosure protocol restricts automatic publication to the requester. Customer refunded; curator-mediated channel takes over; registry notified per protocol. Architecture ships D5; framework dormant pending GC sign-off on the `WITHHELD_SOURCES` list.
4. **Worked example recomputed.** §5 Royal Oak 5516 reads PCS 93.35 / Gold under v20 bands and the algorithm spec's ALR quadrant cap. Tier stable at Gold (vs PCS 94.85 rounded to 94 / Gold in v10.1).

Quadrant weights (30/30/25/15), pass thresholds within quadrants, and the §6 liability paragraph are unchanged.

---

## §1 — Premise

The Provenance Confidence Score (PCS) is veradis.ai's industry-standard verification output. Published as an open methodology so it becomes the industry's property, not veradis.ai's.

**Canonical framing:** "Intelligence, not insurance." Probabilistic verification report based on data at time of query. Not a legal certificate. Not indemnity.

**Standard-setting strategy.** Stripe in payments, LEED in building certification — the company that publishes the standard owns the standard. Publish early, publish openly, invite institutions to co-author. Every secondary market platform, insurer, or auction house that embeds PCS in transaction documentation creates relational + commercial switching cost.

---

## §2 — The Four Quadrants (Canonical Weights)

PCS is a weighted blend of four quadrants. Each quadrant scored 0–100. Weighted blend produces final PCS 0–100 with confidence interval.

| Quadrant | Weight | Question answered |
|---|---|---|
| **Identity Integrity** | 30% | Does the object match the claimed identity? |
| **Chain of Custody** | 30% | Is the provenance chain complete and unbroken? |
| **Material Integrity / Forensic Match** | 25% | Do physical signatures match expected? |
| **Risk Profile** | 15% | Are there encumbrances, disputes, or compliance flags? |

**Composite formula:**
```
PCS = (0.30 × Identity) + (0.30 × Custody) + (0.25 × Material) + (0.15 × Risk)
```

**Weight calibration.** These are working hypotheses. Will be empirically validated through Seaforth 500-object turn study + first 50 Verify transactions across maison and auction-house tiers. Recalibration requires versioned brief, not casual update. Weights unchanged from v10.1.

---

## §3 — Quadrant Definitions + Pass/Fail Criteria

Unchanged from v10.1. Reproduced here for self-containedness.

### Quadrant 1 — Identity Integrity (30%)

**Question:** Does the object match the claimed identity?

**Data points:**
- Maker / manufacturer / artist (authority-resolved: ULAN, VIAF, Wikidata, manufacturer archive)
- Production date / period (precision-bracketed: exact, decade, "circa")
- Serial number / accession number / catalogue ID
- Material composition (declared vs. observed)
- Inscriptions / marks / hallmarks (transcribed + authority-checked)

**Scoring:** percentage of identity attributes populated and authority-resolved. Authority-resolution earns 1.0; declared-only 0.5; missing 0.

**Pass criteria:** ≥70 to qualify for "Verified" status. Below 50 triggers curator review flag.

### Quadrant 2 — Chain of Custody (30%)

**Question:** Is the provenance chain complete and unbroken?

**Data points:**
- Documented ownership transitions (acquisition records, deed-of-gift, sale records)
- Exhibition history
- Publication / catalogue raisonné references
- Conservation records
- Storage / location history
- Insurance appraisal records

**Scoring:** chain completeness percentage. Gap analysis: identify missing periods. Gap >5 years = high gap risk; 1–5 years = medium; <1 year or fully documented = low.

**Pass criteria:** ≥70 for major transactions. Below 50 = "intelligence with gaps" disclosure required.

### Quadrant 3 — Material Integrity / Forensic Match (25%)

**Question:** Do physical signatures match expected?

**Data points:**
- Forensic analysis results (spectroscopy, isotope analysis, micro-engraving, dendrochronology, etc.)
- Production-mark consistency (manufacturer toolmarks, period-correct fasteners, etc.)
- Material composition (lab-verified vs. declared)
- Condition assessment (consistent with claimed age/storage history)
- Replacement detection (case, dial, label, stretcher, etc.)

**Scoring:** percentage of forensic checks completed and consistent. Inconsistencies score 0 on the affected check; missing checks reduce confidence interval rather than score. Period-correct service replacements (e.g. service-era bracelet on a vintage watch) score under the `EXPECTED_PERIOD_REPLACEMENT` class at 0.7 credit with disclosure — distinct from Frankenwatch indicators (redial, swapped movement, recase) which remain 0 credit. The class is specified per-domain in the algorithm spec §4.

**Pass criteria:** ≥60 acceptable when third-party forensic data unavailable. ≥75 when forensic data present.

### Quadrant 4 — Risk Profile (15%)

**Question:** Are there encumbrances, disputes, or compliance flags?

**Data points:**
- Stolen art / cultural property registries (Art Loss Register, Interpol, FBI Art Crime, ICOM Red List, CBP repatriation)
- Cultural patrimony / repatriation flags (NAGPRA, UNESCO 1970, Washington Principles)
- Sanctions exposure (OFAC, UK, EU, Swiss)
- Insurance / lien encumbrances
- Litigation history
- AML / source-of-funds compliance flags

**Scoring:** baseline 100. Each flag detected reduces score per severity matrix. Pass threshold: ≥80 (no high-severity flags). Quadrant is capped at 90 whenever the ALR feature flag is disabled (v01 launch posture — see algorithm spec §10).

**Pass criteria:** any single high-severity flag (stolen, patrimony dispute, sanctions hit) reduces overall PCS via the algorithm's COMPOSITE_OVERRIDE_FLAGGED mechanism, routes the report to Flagged (or Withheld where §7 applies), and triggers curator confirmation on non-sanctions sources to guard against false positives (per GC review).

---

## §4 — PCS Tier Mapping (v20 — REVISED)

Tier ranges shifted in v20. Unscored is no longer a score band — it is a data-sufficiency determination evaluated before scoring lands. Flagged is a paid deliverable. Withheld is the sixth state introduced in §7.

| Tier | Score band (lower CI bound) | Customer pays | Deliverable | Verify multiplier |
|---|---|---|---|---|
| **Gold** | 80–100 | Yes | Full attribution report, no gap disclosure | 2.0× base |
| **Silver** | 60–79 | Yes | Full attribution with notes / disclosed gaps | 1.5× base |
| **Bronze** | 40–59 | Yes | Full attribution with explicit gap disclosure | 1.0× base |
| **Unscored** | data-sufficiency = false | **No — refunded** | No deliverable; email capture for coverage-update notification | n/a |
| **Flagged** | 0–39, or high-severity Risk override | Yes | Full evidence bundle; 14-day appeal window | 1.0× base (paid as Bronze) |
| **Withheld** | Legal-disclosure restriction on the Flagged source — see §7 | **No — refunded** | No automatic deliverable; curator-mediated channel; registry-notification protocol fires | Premium upsell CHF 1K–10K (SSOT §9) if recipient engages |

**Tiering on the lower CI bound, not the point.** Honesty register: we tier on what we can defend, not what we hope. A point of 85 with CI [73, 91] is Silver, not Gold. Conservative by design.

**Disclosure copy (v20 + GC review).**

| Tier | Disclosure |
|---|---|
| Gold | "Authentication confidence: High. Suitable for secondary-market transaction subject to the buyer's standard diligence and the liability terms below." |
| Silver | "Authentication confidence: Moderate. Verified with documented gaps; transaction-suitable with disclosure of: {gap-summary}." |
| Bronze | "Authentication confidence: Limited. Intelligence with material gaps; recommend physical inspection by qualified specialist." |
| Unscored | "Insufficient data for a confident answer. Full refund processed. We will notify you if coverage of this object class improves." |
| Flagged | "Network finds evidence the claimed identity does not match this object: {finding-summary}. Evidence enclosed. Appeal available within fourteen days." |
| Withheld | "This query has been routed to a curator-mediated channel under the disclosure protocol of the matching registry. Full refund processed. A veradis.ai specialist will contact you within 48 business hours." |

Confidence interval reported with every PCS (e.g., PCS 87 ± 4 at 95% confidence).

The v10.1 Gold copy ("Recommended for secondary market transaction without further verification") was tightened in v20 — the prior wording directly contradicted the §6 liability paragraph and read as misrepresentation. Replaced with "subject to the buyer's standard diligence and the liability terms below."

---

## §5 — Worked Example (Audemars Piguet Royal Oak 5516, 1972) — v20

**Identity (30%):** Manufacturer Audemars Piguet (archive-resolved). Reference 5516 confirmed in production ledger. Serial number cross-referenced. Calibre 2120 movement. **Score: 96.**

**Custody (30%):** Original delivery to Golay Fils et Stahl Geneva, Nov 1972. Private collection 1974–2019 (insurance appraisal records). Christie's Geneva 2019 sale (lot record + buyer documented). Current consignment. 17-year gap (private collection 1974–1991) documented via insurance records. **Score: 91. Gap Risk: Low.**

**Material (25%):** Case micro-engraving consistent with Le Brassus production marks. Bracelet integrated joints consistent with original 1972 tooling. No evidence of case or dial replacement. Movement serial matches case serial. **Score: 95.**

**Risk (15%):** No flags across Interpol stolen-works, FBI Art Crime, OFAC, sanctions registries. ALR feature flag disabled at v01 launch — quadrant capped at 90 with disclosure (per algorithm spec §10). **Score: 90.**

**Composite PCS:** (0.30 × 96) + (0.30 × 91) + (0.25 × 95) + (0.15 × 90) = 28.8 + 27.3 + 23.75 + 13.5 = **93.35 / Gold tier** under v20 bands.

**Confidence interval:** [88, 96] at 95% credible interval (Bayesian beta-binomial per quadrant, Monte-Carlo composite — algorithm spec §7). Lower bound 88 ≥ 80 → Gold.

**Disclosure paragraph:**

> "Authentication confidence: High. Suitable for secondary-market transaction subject to the buyer's standard diligence and the liability terms below.
>
> Stolen-property check covers Interpol, FBI Art Crime Team, ICOM Red Lists, and CBP repatriation registry. Art Loss Register integration scheduled Q3 2026. This report does not discharge the recipient's own diligence obligations under applicable cultural-property, sanctions, or AML law, including any duty to consult the Art Loss Register."

**Note vs v10.1.** v10.1 worked example reads PCS 94.85 (rounded to 94) / Gold with Risk = 100. v20 reads PCS 93.35 / Gold with Risk = 90 (ALR quadrant cap per algorithm spec §10). Delta = exactly 1.5 composite points = 0.15 weight × 10-point Risk-quadrant cap. Tier unchanged. Methodology paper v1 (W3 sprint deliverable) publishes the v20 worked example.

---

## §6 — Liability Framing (canonical, with GC)

Unchanged from v10.1. Every PCS report — including Flagged and Withheld surfaces — ships with this paragraph:

> "This Provenance Confidence Score is a probabilistic verification report based on digital data analysis cross-referenced against the veradis.ai knowledge graph. It is intelligence, not insurance. The PCS reflects the probability of identity match, custody continuity, material integrity, and risk-profile cleanliness based on available data at the time of query. It does not constitute a legal certificate of authentication, a guarantee against loss, or an indemnity against fraud. For high-value transactions, buyers should conduct physical inspection by a qualified specialist. veradis.ai is not liable for financial loss resulting from reliance on this report."

PCS T&Cs single-page (GC sprint W2) productises this framing for Stripe + FB Marketplace consumer disclosure. v20 also adds the Flagged Evidence Bundle disclosure copy (per-finding) and the Withheld routing message (per §7) to the GC review queue before v20 publication.

---

## §7 — Withheld output state (NEW in v20)

**Purpose.** Some Flagged findings cannot ship as automatic public deliverables because the matching registry's disclosure protocol restricts publication to the requester, or because the requester's jurisdiction imposes a reporting duty on the platform. Withheld is the algorithm's mechanism for staying clean of those duties while still doing right by the registry, the buyer, and the rule of law.

**When Withheld fires.** When `COMPOSITE_OVERRIDE_FLAGGED` is set *and* the primary registry source is on the curator-maintained `WITHHELD_SOURCES` list, or when the requester's jurisdiction is paired with the source in `WITHHELD_JURISDICTION_PAIRS`. Current candidates pending GC sign-off: Interpol stolen-works (several jurisdictions impose notification duty), Art Loss Register once enabled (contractual non-disclosure on certain match types), national patrimony registries in Switzerland / EU / UK / Italy / Greece.

**On Withheld fire:**

1. Customer is refunded automatically.
2. The matched registry is notified per its protocol (Interpol via partner channel, ALR via contractual route, national patrimony per the jurisdiction's procedure). Curator action, SLA 24 hours.
3. The requester receives a holding message routing them to the curator-mediated Premium channel (SSOT §9 — CHF 1K–10K SKU).
4. The curator-mediated engagement either upgrades to Premium or terminates the request with case-specific disclosure authored by the curator (not the algorithm).
5. Every Withheld event writes to `pcs.withheld_events` with the full audit trail (registry, hit details, jurisdiction, requester, refund txn, notification timestamps, outcome).

**SLA.** Registry notification 24h hard. Requester routing message 1h. Curator-mediated first contact 48h business hours.

**Critical legal posture.** Withheld protects the customer (refund + routing), the registry (its protocol respected), and the platform (no statutory reporting trap, no prejudice to an open investigation) simultaneously. GC confirmation required before the `WITHHELD_SOURCES` list is populated for production. v01 algorithm spec ships the routing mechanism live and the list empty; at D5 launch, Withheld cannot fire. The architecture is in place for the moment GC unblocks.

**Marketing surface.** The marketing copy v20 and visual brief v20 carry the five-tier thumbnail set on `/verify`. Withheld is the sixth state and is not currently rendered. A v21 visual brief revision adds the Withheld disclosure pattern once GC signs off.

---

## §8 — Standard-Setting Roadmap

Unchanged from v10.1 except the methodology-paper milestone now references v20.

| Milestone | Owner | Date |
|---|---|---|
| Methodology paper v1 published (open methodology, against v20) | Head of Intelligence + Chief Archivist | W3 sprint (25–29 May) |
| Co-author invitation sent to first 5 institutional partners | Head of Intelligence | Post-anchor (Jun) |
| First auction house / insurer references PCS in transaction docs | CRO | Q3 2026 |
| First Compliance Verify enterprise contract cites PCS methodology | Head of Fundraise + CRO | Q4 2026 |
| Public methodology v3 (post-empirical-validation) | Head of Intelligence | Q1 2027 |

---

## §9 — Commercial model + refund policy (NEW in v20)

The v20 amendment establishes the commercial reasoning behind the tier table in §4. This section sits inside the methodology document because the refund mechanic is a methodological property — it expresses what the network is willing to charge for and what it is not.

### §9.1 The principle

> *We will not sell you an inconclusive answer.*
>
> If the report comes back **Unscored** — we have insufficient data to give you a confident answer — it is free. Full refund. No questions.
>
> A **Flagged** report is not a refund event. If our network finds evidence the object is counterfeit, stolen, or inconsistent with the manufacturer's record, that is the answer you paid for. We will deliver it with sources, and you will keep it.

This pull-quote ships verbatim on the PCS PDF refund-policy footer, the Stripe checkout disclosure, the /verify pull-quote on the marketing site, and the PCS ToS §3.

### §9.2 Why Flagged is paid

Flagged is the highest-value verification the network produces. A consumer pays $49 for PCS Standard precisely to find out whether the object is real *before* they write the cheque. When the network finds evidence the object is counterfeit, stolen, or inconsistent with the manufacturer's record, that is the answer the consumer paid for. Refunding it undermines the commercial model the D2C wedge depends on — and reads to the customer as if the platform does not stand behind its own negative findings.

The v10.1 logic that refunded Flagged hedged against false-positive exposure. That risk is real but mitigated through (a) the §6 liability paragraph (evidence aggregation, not authentication opinion); (b) cited sources on every Flagged report — the Evidence Bundle in algorithm spec §5.1; (c) the right of appeal documented in ToS §8 (14-day window). The refund mechanism is the wrong tool for false-positive risk. The appeal mechanism is the right one.

### §9.3 Refund automation

Stripe trigger condition under v20: `output_state IN (unscored, withheld)`. Refund automatic in both cases. Reason codes: `unscored_insufficient_data` and `withheld_legal_restriction`. Audit trail to `pcs.refund_events`.

Bronze unchanged: paid, delivered, gap-disclosure on the deliverable. Silver and Gold unchanged. Flagged unchanged in mechanic (Flagged was previously withheld; now paid + delivered with Evidence Bundle).

### §9.4 ToS alignment

Two ToS revisions sequenced with v20 publication:

- §3 (Pricing and refunds) — update refund trigger language to Unscored + Withheld only. Bronze, Silver, Gold, Flagged are all paid + delivered.
- §8 (Appeal rights) — confirm 14-day appeal window for any Flagged finding remains available; specify the `appeals@veradis.ai` channel and the 5-business-day curator-mediated review SLA.

GC ownership. Publication sequenced with v20.

### §9.5 SSOT alignment

SSOT v10 §9 Pricing table — no change. Verify pricing (Basic $10 / Standard $49 / Dossier $150 / Premium $1K–10K) is unaffected. Refund mechanics live in this methodology document, not in SSOT.

SSOT v11 candidate (post-anchor): name the Verify consumer SKUs (Basic / Standard / Dossier / Premium) explicitly in §9. Not required for v20 publication.

---

## §10 — Open items for methodology paper v1 (W3 deliverable)

Carried from v10.1 §8 with status updates.

- *Empirical validation plan.* Seaforth 500-object turn study + curator QA — design lands W3. Carried.
- *Confidence-interval calculation method.* Resolved in v20 — Bayesian beta-binomial per quadrant, Monte-Carlo composite, pinned-seed for reproducibility. Specified in algorithm spec §7.
- *Domain-specific weight variants.* Resolved as: same cross-quadrant weights (30/30/25/15), domain-specific data-point inventories per quadrant. Specified in algorithm spec §2 (Identity) and §4 (Material). Carried for fine-art and wine-domain inventory work in v02.
- *EU AI Act Article 10 alignment statement.* Required for any EU institutional sale. Owner GC. D7 deliverable. Carried.
- *EU consumer 14-day withdrawal disapplication.* Closed by LEG App. 1 §10 — double-checkbox at Stripe checkout, durable-medium acknowledgement in receipt and PDF. Resolved.
- *Stripe dispute / chargeback procedure + reason-code matrix.* Closed by LEG App. 1 §3, §4. Resolved.
- *Discretionary refund channel for non-Flagged factual-error complaints.* Closed by LEG App. 1 §11 — `support@veradis.ai` channel, $500 founder / $2000 GC authority tiers, hard rule against Flagged refunds via this path. Resolved.
- *Entity transition BC INC. → SARL.* Closed by LEG App. 1 §6, App. 3 §7 — cohort split, no novation. Resolved.
- *Data residency for EU/Swiss Verify traffic.* Closed in framework by LEG App. 1 §12 — Frankfurt `eu-central-1` with SCCs, or geo-fence fallback. Engineering confirmation owed before D5.
- *Investor-brief access gate.* Closed by LEG App. 3 §1 — manual qualification gate, 24-hour review window, accredited / qualified investor representation under NI 45-106 and FinSA Art. 4. Resolved.
- *Click-through NDA on `/about`.* Closed by LEG Annex 3A — ~350-word click-through text. Resolved.
- *Smokey Smith VC / Crown copyright / VC-mark s. 419.* Closed by LEG App. 2 — institutional-only-for-D5 disposition conditional on Rod Bell-Irving 48-hour sign-off, no commercial-surface use. Resolved.
- *PCS ToS §3 + §8 execution.* Carried to W2 per LEG App. 1 §0. D5 operates under fallback posture: `TOS_LIVE=false`, chargeback dossier rests on §6 paragraph + Stripe checkout disclosure + EU disapplication metadata. Carried.
- *Article 22 GDPR repositioning of Flagged appeal.* Carried to W2 per LEG App. 1 §5. Algorithm spec §14.3 carries a forward-reference. Carried.
- *Watch corpus IP/ToS exposure.* Not addressed by LEG v02. v01 ingestion restricted per Build Plan §9 to licence-clear sources (Rolex Vintage Yearbook, Omega VDB research fair-dealing, Antiquorum executed letter, public registries). Auction archives, dealer catalogues, forums deferred pending separate IP counsel review. Carried.
- *Public-facing target publication.* Hodinkee or Quill & Pad for horological tier; Apollo for fine-art tier; museum-sector publication for institutional tier. Carried.
- *Co-authorship invitation criteria.* Which 5 institutions are invited and why. Carried.
- *Withheld `WITHHELD_SOURCES` list.* GC confirmation required before the framework can fire in production. NEW in v20. Carried.
- *Flagged Evidence Bundle per-finding disclosure copy.* GC review required before v20 publication. NEW in v20. D5 hard.
- *Mandatory vs conditional forensic checks per domain.* Curator review (algorithm spec §4) flags that the missing-check-widens-CI policy is correct only for genuinely conditional checks; mandatory ones must score zero on missing. Domain-by-domain inventory authored alongside Seaforth turn study. Carried to v02 / Q3 2026.
- *Empirical priors per domain.* Replace Jeffreys priors with Seaforth-turn-study empirical posteriors. Q3 2026. Carried.

---

*End. PCS Methodology Brief v21 LOCKED · supersedes v20 · closes audit RED flag R9 · founder-signed production lock at D5 (Fri 15 May 2026). Supersedes v20 (archived), v10.1 (archived) and the Refund Policy Amendment v01 (archived). Companion to PCS Algorithm Specification v21, PCS Build Plan v21, Marketing Copy v21, and the Verify Legal Appendices v20. Next revision: Methodology Paper v1 (W3) or first empirical recalibration from Seaforth turn study.*
