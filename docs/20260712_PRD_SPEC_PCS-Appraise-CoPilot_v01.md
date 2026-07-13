# PCS / Appraise Co-Pilot — build spec (v01)

**Workstream:** PRD · **12 Jul 2026** · drafted by Claude, directed by Brent · **Status:** v01 for CTO / Head of Intelligence / Engineering.
**Sources of truth:** Canonical Report Spec v03 (`veradis-v4/_SPEC/…Canonical-Report-Spec_v03.md`) · PCS Methodology / Algorithm v21 (`/04-product/pcs-locked/`) · the agentic-pipeline ADR (`…/ADR_Agentic-PCS-Pipeline_v01.md`) · the source matrix in §4 below · the existing `@veradis/pcs-types` contract.

> **Mandate.** The co-pilot does not invent a new report. It **reproduces the canonical Verify (PCS) and Appraise reports** from a submitted object + photos, drafting every section against named sources, for a curator to confirm — **provisional** in minutes, **definitive** the same day. Acceptance = it reproduces the existing fixtures (RW watch · Smith VC group · Tuscan tea service · Salisbury cup) from their inputs, to tolerance. It exists so Brent reviews for 15 minutes instead of building a report for two hours — and so the 101st report is as good as the first.

---

## 1. What the co-pilot is (and is not)

- **Is:** an assisted-draft engine that fills the canonical report skeleton (Spec v03 §3, all 14 sections), scores the four quadrants per method v21, cites every claim, and hands a curator a near-finished, honest draft to confirm or correct.
- **Is not:** an autonomous authenticator. Per the guardrails (Spec v03 §10) it never says "authenticated"; it scores the **documentary record**, names gaps, and routes insufficiency to Unscored→refund. The human sign-off is a product feature, printed on the face (§16.5), not a stopgap.
- **Two tiers, one report:** the co-pilot's output is the **provisional** version (wide CI, "under expert review"); the curator's confirmation issues the **definitive** vN. The band only ever tightens on confirmation.

This is the first buildable increment of the ADR pipeline — the ADR is the destination, this spec is the on-ramp.

---

## 2. Pipeline (each stage maps to a report section it fills)

| # | Stage | Reuses | Produces (report section) |
|---|---|---|---|
| 1 | **Intake & normalise** — order + Tally photos + Stripe fields → a `ScoreRequest`; select the **category profile** (Spec v03 §6) | `@veradis/pcs-types` contract; category profiles as versioned data | Header, Meta strip, Scope (§3.1–3.3) |
| 2 | **Evidence conditioning** — hash each photo (SHA-256), preserve EXIF, **C2PA content-credential check** (flag AI-generated/edited before it poisons a report — non-negotiable anti-fraud, §5), map to the profile's capture-slot list, compute the coverage gauge | Capture protocols (profile data) | Evidence panel + coverage gauge (§9), Delta panel (§3.4) |
| 3 | **Vision pass** — OCR serial / reference / hallmarks / naming-engraving / backstamp+Rd number; identify movement/calibre; read date-letter; detect category red flags (redial, renaming, married pieces, erased inscription) | multimodal model (record which model produced each observation) | populates the identity keys + Checks table observations (§10) |
| 4 | **Source resolution (the router)** — given category + observed identity keys, call the **reachable** external sources (§4) and the **internal graph** (§5); each returns `{value, citation, retrieval_state}` where state ∈ retrieved / pending-lookup / not-digitised / access-restricted (Spec v03 §8) | source adapters (`@veradis/pcs-adapters` — to build) | Checks table authority states (§16.3), Registry sweep (§16.2), Family/collection graph (§11) |
| 5 | **Graph cross-reference** — query the veradis knowledge graph (tenants + family accounts) for identity/person/unit/object matches and cross-object corroboration; classify each as **Cited / Attested / Linked** (§14) | Supabase graph + ingest infra (exists) | Family graph panel (§11); custody/story evidence |
| 6 | **Quadrant scoring (draft)** — Identity · Custody & story · Material · Risk at locked weights **30/30/25/15**; per-check authority states (Authority-resolved / Declared-only / Missing); **Risk capped ≤90 while ALR-off** with the fixed coverage paragraph; missing checks **widen the CI**, they don't lower the score; inconsistencies score 0 on that check; corrections are first-class `{claimed, evidence, corrected_value, kindness_note}` | `@veradis/pcs-core` constants (weights, tier bands, seed salt); method v21 (to encode) | Verdict + component bars (§3.5), Corrections panel |
| 7 | **Composite + tier** — arithmetic shown on the face; **95% CI published; tier assigned on the lower bound** (Gold ≥80 / Silver ≥60 / Bronze ≥40); route Unscored (refund) / Flagged (paid + evidence bundle) / Withheld (refund, curator-mediated) | `pcs-core` TierMapper (to build) | Verdict tier chip + disclosure copy |
| 8 | **Valuation (Appraise only)** — comps from reachable price sources; asks excluded; weights auction 1.0 / confirmed 0.8 / probable 0.5 / dealer 0.6; per-sale-date FX; recency half-life 24 mo; band = weighted P25–P75 by the factor ledger; owner currency leads, CHF in parens | §7 valuation method | Comparable sales table (§6), Method/factor ledger (§7), Actions (§8) |
| 9 | **Narrative + citations** — draft verdict prose, component notes, actions, reading guide, to the **honesty register** (no "authenticated"; gaps named in brass; kindness on corrections; "Clear" ≠ "not stolen") | LLM (narrative), locked copy blocks | prose across all sections |
| 10 | **Critic / QA gate** — the ADR's critic; may only **withhold or downgrade**: data sufficiency (else Unscored→refund) · every claim carries a citation · tier holds on the lower bound with caps applied · disclosures + liability paragraph present · C2PA clean · the word "authenticated" absent · contradictions across vision/sources/graph flagged | — | gates provisional issue |
| 11 | **Render (provisional)** — the canonical report from the template, watermarked *Provisional — under expert review*; hashes + attestation block; permalink | report template (`_TEMPLATES/…PCS-Report`) + the sample HTML render fixtures | the PDF + online report |
| 12 | **Curator confirm → definitive** — curator reviews the drafted report + evidence bundle, corrects, resolves any Declared-only primary key, clears/holds registry gaps, signs → immutable `curator_actions` row → **definitive vN** | curator UI (thin) | Curator line (§16.5), Attestation (§12) |

**Where the human time goes:** stage 12. Everything above is drafted; the curator confirms identity resolutions, accepts/edits the narrative, and makes the judgment calls the method reserves for a human (Declared-only primary keys, Flagged findings, valuation factor weights). Target: **~15 minutes** on a clean object.

---

## 3. What the co-pilot drafts vs. what the curator must confirm

Trust depends on drawing this line explicitly and printing it (per-check authority states, §16.3).

| Report element | Co-pilot drafts | Curator must confirm |
|---|---|---|
| Identity match from a **named authority** (Getty/Wikidata/Gazette/VAC/maker archive) | ✅ full draft, source cited | spot-confirm |
| Identity key that is **Declared-only** (no source resolved) | ✅ marks half-credit + **curator-review-pending** chip | **must** resolve or accept the pending state |
| Material/movement observation from vision | ✅ observed vs reference table | confirm the read (esp. red flags) |
| **Risk / stolen-property** | ⚠️ can only render **pending / access-restricted** for the gated registers (ALR, Watch Register, Interpol) — never "clear" unless a check was actually run; **sanctions/party screening** it *can* resolve (free API) | decide whether to run a paid ALR/Watch Register check; sign the sweep |
| Custody / story from the **graph** (tenant or family) | ✅ Cited/Attested/Linked nodes with citations | confirm the links, set consent/redaction |
| Corrections (wrong story on a genuine object) | ✅ corrections panel with kindness note | confirm the correction |
| Valuation band (Appraise) | ✅ comps + band + factor ledger | confirm factor weights, sign the value type |
| Tier + CI + disclosure copy | ✅ computed, lower-bound tiered | accept |
| "Authenticated" language anywhere | ❌ blocked by the critic | — |

---

## 4. Source matrix — what's reachable, by object class (the deep research)

Access legend: **API** free/official · **Bulk** free official file · **Scrape** free site, no API (ToS care) · **Paid-API** · **Paid-web** (no API) · **Gated** (credentials/partner) · **Owner** (mail-in, per-object) · **Manual**. Quadrants: **I** Identity · **M** Material · **R** Risk · **C** Custody.

### Reachable FREE + programmatic TODAY (build the router on these first)
| Source | Feeds | Class | Notes |
|---|---|---|---|
| **trade.gov Consolidated Screening List API** | R | all | Free API key; wraps OFAC SDN + BIS + State. Screens **parties in the custody chain**, not the object. Verify still-live; keep OFAC bulk as fallback. |
| **OFAC Sanctions List Service** (SDN/Consolidated) | R | all | Free official bulk XML/CSV; build the match logic. |
| **OpenSanctions** | R | all | Free bulk (entity-resolved). Commercial *API* needs a licence. |
| **Getty ULAN / AAT / TGN** | I, M | art, silver, all | SPARQL + reconciliation + LOD dumps (ODC-By). Maker authority + material vocabulary. Legacy XML services are dead — use SPARQL. |
| **Wikidata** | I, C | all | SPARQL (no auth) + REST + dumps. Cross-refs makers/institutions; links Getty/VIAF IDs. |
| **VIAF** | I | all | Free authority reconciliation for maker/person names. |
| **Europeana API** | I, C | art, decorative | Free key; object records corroborate comparables + institutional custody (CC0 metadata). |
| **UK National Archives Discovery API** | I, C | medals | Free; returns **catalogue references** to medal rolls (WO 372 etc.), not the images. |
| **The London Gazette REST API** | I, R, C | medals | Free (OGL); verifies gazetted awards/citations **and** insolvency of a named holder. |
| **Canadian Virtual War Memorial API (VAC)** | I | medals (CA) | **Free JSON, paginated.** Strongest free programmatic source for Canadian militaria identity. |

### Scrapable-only (reachable with a scraper this week; no official API — mind ToS)
| Source | Feeds | Class |
|---|---|---|
| **925-1000.com**, **silvermakersmarks.co.uk**, **Assay Office London date-letters** | I, M | silver (the core references; no API exists — structure into an internal lookup table) |
| **Caliber Corner / WatchBase public pages** | M | watches (movement specs) |
| **CWGC** | I | medals |
| **FBI National Stolen Art File** | R | art (≥$2,000; no API) |
| **German Lost Art / Proveana** | R, C | art (Nazi-era) |

### Paid but real (procure when volume justifies)
| Source | Feeds | Class | Cost |
|---|---|---|---|
| **WatchBase Datafeed** (official API) | I, M | watches | ~$0.30/entry — best structured watch reference |
| **WatchCharts API** | M (value) | watches | Professional subscription |
| **artnet / Artprice / Invaluable** | M (value), C | art, decorative, silver | subscription, no API |

### Gated / partner / staff-mediated (no self-serve API — the Risk gap)
- **Art Loss Register** (£85/search, staff-run) · **The Watch Register** (£16/check) — the stolen-property gold standard; **no API**. Per-search or partnership.
- **INTERPOL Stolen Works of Art** — full DB via national NCB vetting; the free **ID-Art** app allows manual/visual checks.
- **WIPO Global Brand Database** — trademark; ToS blocks automation → effectively manual.

### Owner-request / mail-in (a co-pilot CANNOT call these — render as a named **ask/upsell slot**, never a claim)
- **Omega · Patek Philippe · Vacheron Constantin · Jaeger-LeCoultre · Audemars Piguet** archive extracts (I, C). **Rolex offers nothing — never imply a Rolex "extract."**

### The three honesty flags to carry into the product
1. **There is no free real-time object-stolen-property API.** Every authoritative stolen register (ALR, Watch Register, Interpol, FBI NSAF) is gated, paid, or scrape-only. The only free real-time Risk signal is **sanctions/party screening** — which checks the *people in the custody chain*, not the object. So the Risk quadrant's stolen-property line is honestly **pending/access-restricted** until a paid check runs — which the method already renders as the ALR-cap paragraph (§16.2). The co-pilot must not fabricate a "clear."
2. **Silver and medal-society expertise have no APIs** — scrape-into-a-table or human corroboration. Build the internal reference tables.
3. **Brand extracts are owner-actions.** The co-pilot surfaces "obtain the Omega extract — closes the identity + custody checks" as the upsell/next-capture (§2 psychology), not as something it did.

---

## 5. The internal graph is the moat — tenants + family accounts

This is what makes a veradis report better than a lone appraiser with Google: **cross-institutional and cross-family corroboration nobody else can do.**

- **Tenant collections already ingested / in flight:** Seaforth (regimental — nominal rolls + the Roy history + catalogue), Wührmann, 5th (BC) Field RCA, 15 Field RCA. The ingest pipeline + Supabase graph already exist (they power the demo).
- **The co-pilot queries the graph** at stage 5: does the submitted object's recipient/unit/maker/serial match a node in any tenant collection? Does a family account hold a corroborating object (the medal group that dates the tea service; the 1945 pension letter that confirms three checks on the Smith VC)?
- **Every match is a cited evidence item** with a retrieval state, feeding Identity/Custody. A cross-institutional link is the single strongest custody signal — and it renders as the family/collection graph panel (§11).
- **Cited / Attested / Linked** (§14) governs off-platform evidence: a public observation *corroborates* (dashed node, weight 0.4); an attested (hashed, C2PA-checked) item *closes* checks; a consent-gated Linked edge feeds both graphs. Promotion Cited→Attested→Linked is one-way, versioned, and each promotion can trigger a CHF 5 re-run.
- **Recruitment + revenue:** every dashed (off-platform) node is a named invitation — "this document, attested, closes the identity check and lifts custody." When a query resolves against an attested family item, the holder shares revenue like an institution. **The graph grows along real regimental and family lines** — the co-pilot is also the network's growth engine.

**Implication for launch category:** because your *own* moat data is regimental (Seaforth / 5 & 15 Field) and the **free external sources are strongest for Canadian militaria** (VAC API + London Gazette API + TNA Discovery + CWGC), the two reinforce. See §8.

---

## 6. Scoring & guardrails the co-pilot must obey (from Spec v03 §4, §10, §16)

- Weights **30/30/25/15**, arithmetic on the face. CI published; **tier on the lower bound**. Missing checks widen CI; inconsistencies zero the check. Integers, no false decimals.
- **Risk cap ≤90 under ALR-off** + fixed coverage paragraph on every report until the licence is signed.
- **Registry sweep** rendered with every registry named, result + check date, and the verbatim caveat: *"Clear" means no match in the named registry on the check date — it never means "not stolen."*
- **Per-check authority states** (Authority-resolved / Declared-only / Missing); Declared-only on a primary identity key → **curator-review-pending** on the verdict.
- **Corrections** lower custody/story, never zero a genuine object; kindness register; never gloat.
- **Prohibitions (hard):** the word **"authenticated"** never appears near a documentary report; **no percentage-of-value fees**; "indicative" + value type on the face; restricted-materials (ivory etc.) hard-cap the band; **independence line** ("veradis' fee is fixed and does not depend on the value concluded") and **staleness line** on every relevant report.
- **Attestation:** hash chain (canonical JSON, SHA-256, predecessor hash), reproducibility + falsifiability sentences, curator line, Methodology §6 liability paragraph verbatim, verify-this-report permalink/QR.
- **Redaction tiers at render:** owner (full) / insurer (custody+serials) / public (locations coarse, serials masked). High-value locations never on circulating copies.

---

## 7. Reuse map — do NOT start from scratch

| Need | Already exists | Status |
|---|---|---|
| Input/output contract | `@veradis/pcs-types` (ScoreRequest, QuadrantScore, ScoreResponse, Tier) | ✅ done — build to it |
| Weights, tier bands, seed salt | `@veradis/pcs-core` constants | ✅ constants exist; the scorer files it re-exports are **empty — this is the core build** |
| Category profiles | Spec v03 §6 (watches/medals/ceramics/silver/fine-art/cards) | 📋 specified — ship as versioned data |
| Report skeleton + copy | Canonical Report Spec v03 (14 sections) + locked copy blocks + disclosure canon | ✅ fully specified |
| Report render | `_TEMPLATES/…PCS-Report` + the RW/Smith/Tuscan HTML fixtures | ✅ fixtures are the acceptance tests |
| Graph + ingest + storage | Supabase graph, `packages-ingest`, tenant collections | ✅ live (powers the demo) |
| Parent architecture | the agentic-pipeline ADR | ✅ this spec is its P0/P1 |
| Sanctions/authority adapters | trade.gov CSL, Getty, Wikidata, Gazette, VAC | 🟢 reachable free today |

**Net new to build:** the four quadrant scorers (encode method v21), the source adapters (`pcs-adapters`), the vision pass, the router + graph cross-ref, the critic, and a thin curator-confirm UI.

---

## 8. Build increments (and the launch-category call)

- **P0 — the co-pilot MVP, one category (≈2–3 weeks).** Recommend **Canadian militaria (medals) first.** Why: it's the only category where the **free programmatic sources are strong** (VAC API + London Gazette API + TNA Discovery + CWGC) *and* it sits on top of **your own moat data** (Seaforth / 5 & 15 Field regimental graph) *and* your ingest pipeline already loads it. Deliver: vision pass + those free sources + graph cross-ref + scorer + critic + curator confirm, rendering the canonical PCS. Reproduce the **Smith VC fixture** from its inputs as the acceptance gate. This alone converts manual reports to 15-minute reviews for your warmest pipeline.
- **P1 — add watches + the registry sweep + Appraise comps.** Watch identity via WatchBase feed (paid API) + owner-extract asks; Appraise valuation for both categories; the rendered registry sweep with the reachable registers.
- **P2 — procure the gated Risk sources** (ALR / Watch Register per-search, Interpol credentialing), build the **silver/hallmark scrapers into internal tables**, add the C2PA vendor, add ceramics/fine-art profiles.
- **P3 — toward auto-definitive** for high-confidence bands with human sampling (the full ADR pipeline; the co-pilot becomes the engine).

**Honest note:** because the authoritative stolen-property and brand-extract sources stay gated/manual, even a mature co-pilot ships reports with "pending / owner-request" lines — and the method **turns those into the upsell and the recruitment mechanic** (§2, §5). The co-pilot doesn't need every source to be valuable; it needs to draft honestly and cite what it has. That honesty *is* the product.

---

## 9. Open decisions (fold with Spec v03 §13)
- **Category first:** medals (recommended) vs watches — one founder ruling.
- **Where it runs:** populate the empty `veradis-platform` monorepo, or ship as a standalone service beside the verify app.
- **Pricing:** tier multipliers (Gold 2.0× / Silver 1.5×) vs deck-v12 flat CHF 20 — the method/pricing conflict is still open.
- **C2PA vendor** for the anti-fraud ingest check.
- **Gated-source procurement order** and budget (ALR/Watch Register first, or WatchBase).
- **Curator UI** scope for P0 (could be as thin as a review page over the drafted report + an approve button).

---

*Build to the fixtures. Score what we can check, say what we can't, make every number trace to a named source. That is the co-pilot, and it is the product.*
