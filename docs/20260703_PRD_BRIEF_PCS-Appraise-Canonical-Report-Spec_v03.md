# The Reports Are the Product — Canonical Specification for Verify (PCS) and Appraise

**File:** `20260703_PRD_BRIEF_PCS-Appraise-Canonical-Report-Spec_v03.md`
**Workstream:** PRD
**Date:** 3 July 2026 (v03)
**Author:** Brent (directed), drafted by Claude
**Audience:** Head of Product · Head of Intelligence · CTO · Engineering
**Status:** v03 — canonical basis for the production report system
**Supersedes/extends:** v02 (3 July 2026, archived) · `20260702_PRD_RPT_Appraise-Valuation-Graph-Sources_v01.md` (source architecture; still valid)
**Worked demonstrations (the living test suite):** `/09-marketing/case-studies/` — **Smith VC group PCS v04 (the report-surface showcase)** + Appraise v03, Tuscan tea service (v01→v05 evidence ladder), Salisbury cup (attribution correction), plus the RW watch case on `/website/v4/solutions/`.

**v02 → v03 changelog:** adds §16 (Report surface v2 — seven enhancements from the pcs-locked review), founder-approved 3 July 2026. §15 dispositions 1, 2, 4 and 5 are now implemented in the Smith PCS v04 fixture. §§0–15 otherwise unchanged.
**Panel conditions folded (3 July 2026, evening):** independence line and staleness rule added to §3.3 fixed copy; "Clear" scope caveat added to §16.2; "authenticated" prohibition added to §10. Source: `20260703_INT_RPT_Expert-Panel-GoLive-Review_v01.md` — **required reading for CTO, Head of Intelligence, and Engineering**; the five seats' remaining conditions are their pre-launch checklist.

---

## 0. What this document is

The PCS and Appraise reports are veradis.ai's product. The website sells them; the graph powers them; the institutions earn from them. This spec defines the production versions completely: structure, scoring, evidence handling, versioning, pricing, attestation, and the standards they must conform to. Every rule here was validated against six live method tests run 2 July 2026 — read the case-study files before building; they are the acceptance fixtures.

One sentence to build by: **we score what we can check, we say what we can't, and every number is traceable to a named source.**

---

## 1. The report family

| Report | Question | Price (deck v12 canon) | Grade |
|---|---|---|---|
| **Verify (PCS)** | Is it real? | CHF 20 | Grade 1 — machine, indicative |
| **Appraise** | Real — worth what? | CHF 40 (includes Verify) | Grade 1 — machine, indicative |
| **Inspect** (new — §16.4) | Physical characterisation session | Priced per category/logistics | Grade 1.5 — instrumented capture feeding a re-run |
| **Reviewed** (build next) | Countersigned | Grade 1 price + partner fee | Grade 2 — USPAP-compliant workfile, credentialled appraiser countersignature |
| **Certified** (partner-led) | FMV for CRA/CCPERB/claims | Partner-priced | Grade 3 — certified instrument on our workfile |

Every report declares on its face: report ID, version, effective date, method version, data-snapshot ID, value type (Appraise), basis (documentary / documentary+visual / inspected), intended use, and what the veradis signature attests (data integrity — never authenticity, never advice).

---

## 2. The commercial versioning model — evidence as the upgrade path

Validated by the Tuscan ladder (71 Provisional → 76 → 78 → 83 across four versions). Versioning is not plumbing; it is the revenue mechanic:

| Event | Price | Rule |
|---|---|---|
| First Verify report | **CHF 20** | Full PCS at whatever evidence exists; wide CI if thin |
| Intake completion re-run | **Free** | One re-run within **7 days** of first purchase, so nobody pays twice for finishing their upload |
| Evidence re-run (new photos/documents) | **CHF 5** | Re-scores, issues vN+1, chains hashes; unlimited, rate-limited (max 1/day/object) |
| Upgrade Verify → Appraise | **+CHF 20** | Delta to the CHF 40 price; runs on the current evidence version |
| Appraise evidence re-run | **CHF 5** | Same rule; band may move **either direction** and publishes anyway |
| Inspect session (§16.4) | Category/logistics-priced | Instrumented capture; always triggers a bundled re-run |
| Annual refresh / sighting attestation | Subscription hook | Feeds the Enrich family/collection tiers; insurers want <3-year-old reports |

Non-negotiable behaviours: re-runs that *lower* a score or band publish with the same delta panel as ones that raise it (the ladder must be able to go down — see §11 acceptance test F). Every version supersedes its predecessor at the same permalink; superseded versions stay resolvable, watermarked, and hash-chained. "We do not sell a guess" refund rule stands: insufficient evidence to score at all → refund, not a low-quality report.

**The upsell is the report itself.** Every empty evidence slot is a labelled, specific ask ("VC reverse · date of act engraving"), and every gap line ends with the action that closes it. **v03 sharpens the promise (§16.1): a re-run is sold on the interval, not the point — new evidence provably narrows the CI; it only may move the score.** The Tuscan tests showed the psychology works: the owner went hunting — and found a wedding photograph and a medal group we didn't know existed.

---

## 3. Canonical report skeleton

Both reports share sections 1–5 and 9–11; Appraise adds 6–8. Order is fixed. **v03 inserts the registry sweep (5a) and material characterisation (5b) between verdict and evidence.**

1. **Header** — object title, owner-facing name if the origin is documented ("The Lennox-Wright wedding service"), companion-report link, supersedence link.
2. **Meta strip** — report ID · version · effective date · method+snapshot · owner locale/currency rule · basis.
3. **Scope & intended use** — declared users, value type, extraordinary assumptions stated as formal assumptions, "not a certified appraisal / not a certificate of authenticity." Two fixed lines (panel conditions): **"veradis' fee is fixed and does not depend on the value concluded"** (independence — every Appraise report) and **"Values and registry results are as of the effective date; insurers typically require re-verification after 12–36 months"** (staleness — both reports; it is also the refresh-subscription hook). Reliance by parties other than the named intended users is at their own risk.
4. **Delta panel** (v02+) — the evidence ladder, all versions, one row per changed measure **including CI width**, honest footer line. This panel is the first thing under the meta strip; it is the product's proof-of-motion.
5. **Verdict** — PCS: score /100 **with 95% credible interval ("83 ± 8") and tier chip (Gold/Silver/Bronze) assigned on the lower bound**, component bars with ghost-markers at previous values, disclosed 30/30/25/15 computation, locked disclosure copy for the tier. Appraise: FMV band (owner currency leads, CHF in parentheses) + grade chip + two-value cards (sell vs insure) with the value-type distinction spelled out.
   - **5a. Registry sweep** (§16.2) — every risk registry named with result and check date; ALR line shown as the open gap with the fixed coverage paragraph.
   - **5b. Material characterisation** (§16.4) — declared vs observed vs reference table (composition, weight, dimensions); pending cells name the instrument and the session that fills them.
6. *(Appraise)* **Comparable sales table** — source dot, venue, date, result, **basis column** (hammer / premium-incl. / probable close / valuation / ask-excluded), per-sale-date FX, same-reference vs sibling flags.
7. *(Appraise)* **Method & factor ledger** — approach, weights, adjustments with their evidential basis, factors each with named effect (Lifts / Holds / Decides / Info).
8. *(Appraise)* **Actions** — ranked, each with expected effect on the band; localised selling/insuring guidance. Includes the static **market-interest panel**: owner's market plus strongest secondary market, colour-banded (Low / Modest / Warm / High), drawn from observed sale frequency and channel spread, fixed at effective date.
9. **Evidence panel** — see §5. Photo/document inventory with real thumbnails, captions, per-item hashes; filled, document-type, and missing slot states; counter ("5 / 12 views"); the next-most-valuable capture named.
10. **Checks table** — generated from the same evidence records as the scores (never hand-counted); result states: Match / Consistent / Observed / Corrected / Reinterpreted / Flagged / Gap-held-open; **per-check authority state (§16.3): Authority-resolved (source named) / Declared-only / Missing**. Declared-only on a primary identity key sets the curator-review-pending chip on the verdict.
11. **Family/collection graph** (when links exist) — entity nodes (person / event / object / document / public record / gap), one line each; the Enrich hook. External evidence per §14.
12. **Attestation block** — report ID, method+snapshot, snapshot SHA-256, predecessor hash (chain), verify-this-report permalink, signature semantics paragraph, **curator line when a curator acted (§16.5), reproducibility sentence (§16.6), falsifiability sentence (§16.7), and the locked Methodology §6 liability paragraph verbatim**.
13. **Reading guide** — fixed small-print copy per method version, before the footer: plain-language definitions of the score, the four components and their weights, the ± credible interval (worked with the report's own numbers), lower-bound tiering, coverage as a separate axis, authority states, declared/observed/reference, curator-review-pending, snapshot/hash chaining — plus the colour legend with swatches (deep green = evidenced · brass = honesty mark/action open · grey = unscored or Silver · hollow dot = check held open · dashed = off-platform/pending · source-dot classes). Owner-legible; no jargon left undefined. Fixture: Smith PCS v04 final page.
14. **Footer** — sources with links, method version, legal line.

**PDF rendering:** page 1 = header through verdict; page 2 = evidence + checks; annexes = comparables detail, graph, attestation. EN/FR. Photo grids never break across pages. Redaction tier applied at render (see §9). veradis prism + wordmark header repeats on every page; Letter and A4 variants ship from the same source.

---

## 4. Scoring specification (PCS v1)

- **Components:** Identity · Custody & story · Material integrity · Risk profile, at the LOCKED cross-quadrant weights **30/30/25/15** (Algorithm Spec v21), disclosed on the face with the arithmetic shown (e.g., "(90×.30)+(86×.30)+(66×.25)+(90×.15) = 82.8, reported as 83"). Quadrant-internal attribute weights per domain profile (annex, not face).
- **Confidence interval:** 95% credible interval published with every score ("83 ± 8"); **tier assigned on the lower bound**. Missing checks widen the interval rather than lowering the score (locked §4 asymmetry); inconsistencies score 0 on the affected check. The CI replaces the v01 "Provisional cap" mechanic — a thin-evidence report is a wide-interval report, honestly labelled.
- **Tiers:** locked vocabulary — Gold (lower ≥80) / Silver (≥60) / Bronze (≥40) / Unscored (refunded) / Flagged (paid, with evidence bundle) / Withheld (refunded, curator-mediated) — with the locked disclosure copy per tier. Descriptive subtitles ("verified · documentary") may accompany, never replace, the tier.
- **Two axes, always:** the score (confidence) plus an **evidence-coverage gauge** (views on file / views required, documents on file). A 78 with 5/12 views must never read as "less real" than an 88 with full coverage — the display separates the axes.
- **Risk under ALR-off:** quadrant capped at 90 with `STOLEN_REGISTRY_PARTIAL_COVERAGE`; the fixed coverage paragraph ships on every report until the ALR licence is signed.
- **Honesty register (hard rules):** any component <80 renders in brass-deep with its gap named in the note, not a footnote; gaps appear as hollow dots in source lists; scores are integers, no false decimals; the ceiling is stated and specified as capturable slots (§16.4) rather than awarded.
- **Corrections are first-class objects:** `{claimed, evidence, corrected_value, kindness_note}` — rendered as their own panel (the Salisbury three-strike table is the fixture). Corrections lower the custody/story component; they never zero a genuine object. Intake pre-empts the known taxonomy (number-type misdeclared, impossible dates, wrong-person attribution) with category hints.
- **Story verification is symmetric:** the same timeline-coherence check that corrected "1904" confirmed "September 1939." Both outcomes are product wins; the copy must never gloat or flatter.

---

## 5. Evidence specification

- **Capture protocols are data, not code:** per category profile, an ordered slot list `{slot_id, label, guidance (angle/light), required_for (component), unlocks}`. The intake UI and the report's missing-slot grid render from the same list. Missing slots carry the camera glyph, label, and — where known — the score/CI effect of filling them.
- **Filled slots render the actual image** — thumbnail in the grid, caption below, label overlay; click-through pins the photo to the checks it supports (evidence pinning). Every image: SHA-256 hashed into the snapshot, EXIF capture time preserved, **C2PA content-credential check on ingest** (AI-generated or edited submission photos are flagged before they poison a report — non-negotiable anti-fraud).
- **Documents and linked objects are separate slot classes** (sand-toned in the demo fixtures): a 1939 wedding photograph is a Document node; the corroborating medal group is a Linked Object with its own record. Both feed the custody/story component and the graph panel.
- **Instrumented slots** (new with §16.4): weight, dimensions, XRF composition, assay readings — captured at an Inspect session, stored as structured measurements with instrument, operator, and calibration reference; rendered in the material characterisation table.
- **Object ID compliance:** every capture protocol includes the ICOM/Getty Object ID core (photographs + the nine identification fields), so any PCS report is natively usable in a theft or customs case.

---

## 6. Category profiles (v1 launch set)

| Profile | Identity keys | Required views (core) | Condition taxonomy | Red flags | Comparable keys |
|---|---|---|---|---|---|
| **Watches** | maker + reference + serial; movement calibre | dial, caseback/serial, movement, crown/clasp, box+papers | dial (orig/redial), case polish, service state | franken, redial, serial mismatch | reference · condition · B&P |
| **Medals (UK/CW)** | naming engraving (rank/name/unit), gazette entry | obv/rev per medal, suspension naming, mount, group layout | naming style, ribbon, mount | renamed, copy striking, wrong naming style | recipient class · campaign · group completeness |
| **Ceramics/china** | backstamp + Rd/pattern number (never a serial) | backstamp, number close-up, full layout counted, gilt edges raking light, interiors, handles | chip, hairline, crazing, staining, gilt wear, regilding | married pieces, wrong-era backstamp claims | maker · pattern · completeness · condition |
| **Silver** | hallmarks (assay, date letter, maker) + engraving | hallmark macro, inscription, full object, weight/scale | dents, erasure, re-engraving, repairs | erased/re-cut inscriptions, let-in marks | maker · form · named vs anonymous |
| **Fine art** | artist, signature, catalogue raisonné, labels/verso | recto, verso, signature macro, labels, frame | craquelure, relining, overpaint | attribution inflation, forged labels | artist · medium · size · period |
| **Cards/collectibles** | issue + grade + cert number | front, back, corners macro, cert | grading-house scale | trimmed, recoloured, cracked slabs | issue · pop report · grade |

Profiles ship as versioned data. Each carries its own component weighting overrides (v2), photo-slot list, **material-characterisation slot class (composition / weight / dimensions vs reference population — §16.4)**, correction hints for intake, and the public-registry connectors relevant to it (maker archives, Rd table, Gazette/WO 373, hallmark tables, catalogues raisonnés, population reports).

---

## 7. Valuation specification (Appraise v1)

Carried from the source-architecture report, hardened by the tests: sales-comparison approach; **asks never enter the band**; weights auction 1.0 / confirmed close 0.8 / probable close 0.5 / dealer sale 0.6; per-sale-date FX; premium basis recorded per comp; recency decay half-life 24 months; band = weighted P25–P75 positioned by the factor ledger, capped at the documented ceiling; grades Cited / Informed / Illustrative by same-reference count and window; below threshold → refuse and refund. **Value types are separate sections with definitions cited** (FMV per CCPERB/CRA wording; replacement stated as a different type with its own number). Contributory allocation deferred to inspection is a legitimate, stated outcome. **Owner-currency rule:** owner's currency leads, CHF in parentheses, FX rate and date on the face. Geo market-interest (Cold/Warm/High) from observed sale frequency, channel spread, and days-to-sale; Cold returns advice, never silence. Conformal calibration ("90% of like objects sold inside this band") replaces prose confidence when data permits; Grade 2 countersignatures are the labelled calibration set.

---

## 8. The graph hooks (Enrich)

Every report reads and writes the entity graph: persons, events, organisations, places, documents, public records, and linked objects, per the schema already live in the Seaforth data (CIDOC-CRM-mappable; Linked Art JSON-LD as the interchange profile; Getty AAT/ULAN/TGN identifiers for types, makers, places; Nomisma for numismatics; Spectrum 5.1 alignment for institutional flows; W3C PROV-O for the report/attestation provenance itself).

The consumer-side wedge is the **family graph**: cross-object corroboration (the medal group dates the tea service; the tea service dates the photograph) raises custody/story scores with evidence, not sentiment, and renders as the graph panel. This is the family-subscription product: hold the graph free, pay per action (Verify/Appraise/re-run), subscribe for continuous enrichment — "the family is the institution," now demonstrated twice (Bell-Irving, Lennox-Wright).

Public-record connectors are graph citizens with retrieval states: `retrieved / pending-lookup / not-digitised / access-restricted`. Field lesson from the Lennox MM: the London Gazette WWII supplements are scanned PDFs — name-indexed only via the Gazette awards search and TNA's WO 373 (Discovery blocks robots; Findmypast holds the RA Military Medal index). The connector spec must model *authenticated* and *manual-order* retrieval paths, and reports must say "record exists, retrieval pending" rather than "not found."

---

## 9. Versioning, attestation, redaction

- **Supersedence:** vN+1 supersedes vN at the same permalink; vN stays resolvable with a superseded banner naming what changed.
- **Hash chain:** each snapshot is canonical JSON (sorted keys), SHA-256 hashed; the snapshot includes `supersedes_hash`. Photos/documents hash individually into the snapshot. Print the current and predecessor hash in the attestation block.
- **Signature semantics (fixed paragraph):** attests that the named sources returned these values on the effective date under the stated method version and disclosed weighting — not authenticity, not a certified appraisal, not advice.
- **Attestation additions (v03):** curator line when applicable (§16.5) · reproducibility sentence (§16.6) · falsifiability sentence (§16.7) · locked Methodology §6 liability paragraph verbatim.
- **Verify-this-report:** permalink + QR on the PDF; endpoint returns current version, version history, and hash validation.
- **Redaction tiers at render:** owner copy (full) · insurer copy (custody detail, serials full) · public copy (locations coarse — "secure institutional storage" — serials partially masked). Precise locations of high-value objects never appear on circulating copies (the Smith room-201 lesson).

---

## 10. Compliance guardrails

Unchanged from the source report and re-affirmed: "indicative," value type on the face, no percentage-of-value fees anywhere, CCPERB/CRA only via Grade 3 partners, restricted-materials flag (ivory etc.) hard-caps bands, VC/militaria tone standards, cultural-property export notes affect FMV text only. Legal review gates Grade 2 launch. **Crown-copyright / VC-mark posture (Methodology v21 §10, LEG App. 2): Smith VC imagery is institutional-surface only — demo, RFP, investor materials; never the public commercial surface.** **Vocabulary prohibition (panel condition, hard): the word "authenticated" never appears near a documentary-tier report, in product or marketing — "verified against the documentary record" is the ceiling. Re-runs are always sold as "tighten the ±," never as a path to a better score.**

---

## 11. Acceptance tests

| # | Fixture | What it proves |
|---|---|---|
| A | RW watch (site + PCS card) | Cited comps, mid-value, serial-keyed identity, structural custody gap honestly framed |
| B | **Smith VC group PCS v04** | **Report-surface v2 showcase: locked weights, published CI, lower-bound tiering (83 ± 8 → Silver), registry sweep, authority states, material characterisation, curator-pending, Risk cap + ALR paragraph, locked liability paragraph. Projection: Inspect session → ~92 Gold.** |
| C | Tuscan v01 | Text-only intake: partial scoring, wide CI, 0/12 slots, refusal-to-guess |
| D | Tuscan v01→v05 ladder | Evidence re-runs, delta panels, hash chain, owner-currency re-denomination, document/linked-object slots, family graph |
| E | Salisbury cup | Attribution correction: genuine object, wrong story; corrections panel; kindness register |
| F | **To build: a down-revision case** | New evidence lowers a band/score; same delta panel, same tone. The ladder must demonstrably go down |
| G | **To build: an external-evidence case** | A cited off-platform document (the Butts pension letter) upgrades to attested and closes a check — §14 end-to-end |

The engine must reproduce A–E from their snapshots within tolerance; F and G are written as fixtures before launch.

---

## 12. Expert review gate (before public launch)

Five seats, in order: (1) USPAP-credentialled personal-property appraiser (ISA CAPP/ASA, Canadian preferred) — signs off the Appraise skeleton as if signing it; (2) specialty-insurance underwriter/claims lead (Chubb/Hiscox/AXA XL or Helvetia Arte/Zurich) — "would you schedule and pay against this?"; (3) auction-house specialist per launch category (medals: Noonans/Spink/eMedals; watches: ex-Phillips/Christie's); (4) CAC/AIC conservator + museum registrar (Spectrum flow) — Rod's network; (5) provenance/art-crime researcher (ARCA/IFAR orbit) + cultural-property counsel. Their sign-offs become part of the method-version release notes.

---

## 13. Open questions for the team

FX source-of-truth service and rounding rules per currency; re-run rate-limit abuse cases (dealers hammering CHF 5 re-runs as a monitoring service — maybe that *is* a product); category-profile governance (who ships a new category); Grade 2 partner economics (flat fee per review — never a percentage); C2PA vendor choice; conformal-calibration data threshold per category; **owner-annotation feature** (owners add provenance commentary at upload; attested, hash-stamped, rendered as owner-voice — never as veradis findings); **tier multipliers vs deck v12 flat pricing** (locked method: Gold 2.0× / Silver 1.5× / Bronze 1.0× on the Verify base; deck v12: flat CHF 20 — needs one founder ruling); **Inspect SKU pricing** (per category and logistics — vault session vs kitchen table).

---

## 14. External evidence — objects and documents outside the graph

Field case, 3 July 2026: Smokey Smith's daughter posted the original 1945 Canadian Pension Commission letter (VC annuity, K-52880, New Westminster address) in a Facebook group. The document sits in the family's private collection, outside the Seaforth catalogue — yet it independently corroborates three checks on the Smith VC PCS. The platform needs a first-class model for this.

### 14.1 Three states

| State | Definition | Evidential force | Report rendering |
|---|---|---|---|
| **Cited** | A public observation of an off-platform item (a post, a publication, an auction catalogue). No custody of the evidence; no hash. | Can **corroborate** a check; can never **close** one. Contributes at tertiary document-quality weight (0.4, per locked method §3). | Dashed node in the graph panel — "Document · private custody · off-platform" — with the citation. |
| **Attested** | The holder submits the item through Verify: photographs hashed, C2PA-checked, EXIF preserved; the item gets its own record and (optionally) its own PCS. | Can **close** checks on other objects (identity keys, dates, addresses, award confirmations). Primary or secondary document-quality weight per class. | Solid node with thumbnail and deep link, marked "private collection" with the holder's chosen display name or anonymity. |
| **Linked** | A consent-gated edge between the holder's private collection/family graph and another graph (institutional or family). Contents stay private; the corroboration travels. | Full graph citizenship: the edge feeds custody/story scoring on both sides and appears in both graph panels. | Normal graph edge; visibility per the consent record. |

### 14.2 Rules

- **Promotion is one-way and versioned.** Cited → Attested → Linked; each promotion is a new evidence event that can trigger a CHF 5 re-run on every report the item corroborates. The pension letter attesting would move Smith identity/custody checks and re-issue the PCS as vN+1.
- **Consent is per-edge, revocable forward.** Revocation stops the edge appearing in future versions; issued report versions are immutable and keep what they lawfully cited.
- **Attribution and revenue.** An attested private item is a contributing source: when a query resolves against it, the holder participates in the revenue share exactly as an institution does. The dashed node is simultaneously an honesty marker and a recruitment lead — the report shows the family what joining adds.
- **Redaction respects the holder.** Private-collection nodes never disclose location; personal addresses in historical documents (the 1945 letter carries one) render on owner copies only, masked on circulating copies.
- **No scraping.** Cited nodes are created from observations the curator or owner records, with the citation named. The platform does not harvest social media.

### 14.3 Recruitment mechanic

Every dashed node on a delivered report is a named, specific invitation ("this document, attested, closes the identity check and lifts custody"). This is §2's upsell psychology extended across household boundaries — the graph grows along real family and regimental lines. Fixture G (§11) demonstrates the loop end-to-end.

---

## 15. Reconciliation with the locked PCS method (v21)

The 3 July review of `/04-product/pcs-locked/` (Algorithm Spec v21, Methodology Brief v21 — both founder-signed LOCKED) found six divergences between the demo-report surface and the locked production method. The locked method wins on math; this spec wins on report surface and commercial mechanics. **Status at v03: items 1, 2, 4, 5 implemented in the Smith PCS v04 fixture; item 3 implemented pending the pricing ruling (§13); item 6 specified in §16.4.**

1. **Component weights** — adopt 30/30/25/15, disclosed on the face. Smith 85 → 83 (with the Risk cap); Tuscan v05 holds at 85 (recompute at next revision). ✅ v04
2. **Confidence interval** — published with every score, tier by lower bound, missing checks widen the CI. ✅ v04
3. **Tier vocabulary** — Gold/Silver/Bronze/Unscored/Flagged/Withheld with locked disclosure copy. ✅ v04 (multiplier-vs-flat-price ruling open, §13)
4. **Risk cap under ALR-off** — cap at 90, fixed coverage paragraph on every report. ✅ v04
5. **Liability paragraph** — Methodology §6 verbatim in the attestation. ✅ v04
6. **Material characterisation depth** — specified as §16.4; Smith vault protocol gains XRF + calibrated weight. Fixture shows the pending state.

Carried rule: `DECLARED_ONLY` on a primary identity attribute sets `curatorReviewPending` on the report face. ✅ v04

---

## 16. Report surface v2 — the seven enhancements (approved 3 July 2026)

### 16.1 Sell the interval, not the point
The CI is the re-run promise. New evidence provably narrows the interval; it only may move the point — so the CHF 5 re-run is marketed as "tighten the ±," which is always true, never hype. The delta panel carries a CI-width column; the report face states the current width and names the single capture that narrows it most.

### 16.2 The registry sweep, rendered
Every risk registry the method checked, as a named table: Interpol stolen-works · FBI Art Crime · ICOM Red List · CBP repatriation · OFAC/SECO/EU/UK sanctions · liens/litigation — each with result and check date. The ALR row renders as the open gap (hollow dot) with the fixed coverage paragraph beneath. This is the section a buyer or underwriter photographs; it costs nothing because the adapters already return per-registry results. **Fixed caveat (panel condition), in the reading guide verbatim: "Clear" means no match in the named registry on the check date — it never means "not stolen."**

### 16.3 Per-check authority states
Each check displays its resolution: **Authority-resolved** (source named — maker archive, Getty, Wikidata, regimental register), **Declared-only** (half credit), **Missing**. The checks table becomes a source-quality ledger. Declared-only on a primary identity key surfaces the **curator review pending** chip on the verdict — honesty and the human-in-the-loop made visible.

### 16.4 Material characterisation + the Inspect SKU
A declared / observed / reference table for composition, weight, and dimensions, per category profile. Medals: alloy composition by XRF against published reference analyses of the striking stock, calibrated weight, die characteristics. Watches: case assay/hallmark vs declared material, head weight vs reference population. Pending cells name the instrument and the session. Product consequence: the **Inspect session** becomes a standard SKU — conservator, camera, scale, XRF, one afternoon — priced per category and logistics, always bundled with a re-run. It is the productised form of the Smith "vault session ask" and the stated path from the low 80s to the mid-90s.

### 16.5 Curator visibility
When a curator confirms, overrides, or clears a hold, the report face says so: name/credential class, action, date — backed by the signed immutable `curator_actions` row. This is the printed bridge to Grade 2: same slot, higher credential.

### 16.6 Reproducibility sentence (attestation, fixed copy)
"Re-running this method against this data snapshot reproduces this score to the digit (pinned-seed deterministic pipeline; golden tests in CI)."

### 16.7 Falsifiability sentence (attestation, fixed copy)
"This method returns Flagged, with the evidence, when an identity fails its checks; appeals resolve within fourteen days. A verification that cannot say no would be worthless — this one can."

**Explicitly excluded from the face:** the Bayesian machinery (the CI number ships, the math stays in the methodology paper), quadrant-internal attribute weight tables (annex), anything that breaks the one-page verdict.

---

*Every claim in this spec traces to a worked fixture in `/09-marketing/case-studies/`, the source-architecture report, or the locked method pair in `/04-product/pcs-locked/`. Build to the fixtures. AI generates. veradis verifies.*
