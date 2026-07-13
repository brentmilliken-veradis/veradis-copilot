# PCS / Appraise Co-Pilot — v02: the MVP engine, 5 categories, the corpus moat

**Workstream:** PRD · **12 Jul 2026** · directed by Brent, drafted by Claude with a virtual expert panel.
**Extends** v01 (pipeline, reuse map, first source matrix). **Adds:** the community-corpus (RAG) layer as the moat block; attribute-from-image + mislabel correction; the 5 MVP category profiles with real named sources; explicit alignment to the 5-block platform architecture; the panel's design principles.
**Sources of truth:** Canonical Report Spec v03 · Method/Algorithm v21 · the agentic-pipeline ADR · the v02 community-corpus research (folded in below).

> **One line to build by (unchanged):** we score what we can check, we say what we can't, every number traces to a named source — **and the confidence interval carries the doubt, so the engine never has to be perfect.**

---

## 1. The panel — who designed this, and the principle each contributed

A design review, not a rubber stamp. Domain seats mirror the Spec v03 §12 gate; engine seats were added for the build.

- **Vintage-watch auction specialist (ex-Phillips).** *"The movement is the tell, not the dial."* When a dial is swapped or a case re-lumed, the caliber and its finishing give the truth. Read the movement first; treat the owner's brand claim as a hypothesis, not a fact.
- **Commonwealth medals specialist (Noonans/Spink orbit).** *"Identity is a naming-to-roll match, never a slab."* The engine's job is to read the rim engraving and match it to a medal roll + the Gazette citation. A 400k-lot auction archive (Noonans) is the closest thing this hobby has to a database — mine it.
- **Senior numismatist (die-variety + grading).** *"Die-match beats description."* An image die-match against millions of catalogued lots (acsearch) resolves identity and flags fakes better than any text search. Coins are where the machine-readable data is richest — prove the engine here.
- **USPAP personal-property appraiser.** *"Separate the confidence axis from the coverage axis, and never let a fee ride on the value."* A wide interval on thin evidence is honest, not weak. Independence line on every Appraise.
- **Provenance / art-crime researcher (ARCA/IFAR).** *"'Clear' means 'no match on the check date' — never 'not stolen.'"* Because no free real-time stolen-object API exists, the Risk quadrant must render the gap honestly and turn it into the paid check, not a false all-clear.
- **ML retrieval / RAG architect.** *"Cite the corpus; never ingest it as fact."* Forums and dealer forensics are the highest-signal Risk knowledge and the least structured. Retrieve them as **evidence with a confidence weight**, surface them as linked citations — do not parse them into ground truth. Official APIs are ground truth; the corpus is corroboration.
- **Knowledge-graph / ontology engineer.** *"Every attribute is a node, resolved to an authority ID."* Getty AAT/ULAN, Nomisma (coins), Linked Art JSON-LD, CIDOC-CRM. Entity resolution is what lets the same object cross-index against a tenant collection, a family account, and an auction lot at once.
- **Computer-vision / forensics lead.** *"Trust the photo over the form, and check the photo itself."* Derive attributes from the image (marks, logos, movements, hallmarks); C2PA-check every upload for AI-generation/edit before it can score. The mislabel case ("Omega" → Rolex crown) is the flagship demo of attribute-from-image.

---

## 2. The engine, mapped to your architecture diagram (the five blocks)

The co-pilot **is** the "Verify an object" loop in the platform diagram. Component-by-component:

| Diagram block | Co-pilot component | What it does · sources / models |
|---|---|---|
| **Client** (web/mobile · institution system) | Submit + upload | Object + photos (Tally today → in-app later) + Stripe details. |
| **Front door** (identity/access · API gateway · application API · job orchestrator) | Intake + queue | Create `ScoreRequest` (`pcs-types`), select category profile, enqueue the job. |
| **Processing · Ingestion Engine** | **Attribute-from-image** | Vision/OCR/handwriting (model serving): read serial/reference/hallmark/naming/backstamp/movement; C2PA anti-fraud; **mislabel detection** (§4). |
| **Processing · Enrichment Engine** | **Source router + corpus retrieval** | Call reachable authority APIs + the **corpus/RAG** (§3) + graph cross-ref; each returns `{value, citation, retrieval_state}`. |
| **Processing · Inference Engine** | **Quadrant scoring** | Identity/Custody/Material/Risk per method v21; weights 30/30/25/15; corrections first-class. |
| **Processing · Verification & score** | **Composite + critic** | 95% CI, tier on lower bound, Risk cap, Unscored/Flagged/Withheld; the critic gate (withhold/downgrade only). |
| **Data · Object store** | Photos + hashes | SHA-256, EXIF, C2PA credential. |
| **Data · Platform DB** | Orders / reports / versions | supersedence + hash chain. |
| **Data · Knowledge graph** | Tenants + family accounts | Seaforth / 5 & 15 Field / Wührmann + family graphs; cross-object corroboration. |
| **Data · Vector store** | Corpus embeddings | Forums, catalogues, reconstructed records, dealer content — retrievable by similarity. |
| **Data · Reference corpus — THE MOAT** | The ingested community knowledge | Tier 1–3 sources (§3); grows via the learning loop. |
| **Data · Audit ledger** | Attestation | hash chain, `curator_actions`, reproducibility/falsifiability. |
| **Output & network** | Scored report → you · Verify API → consumers · Enrich-and-Return | the canonical PCS/Appraise report; later the per-ping API. |
| **Model serving (shared)** | vision · OCR · handwriting · embeddings · Claude (narrative) | one shared layer; record which model produced each observation. |
| **Governance & audit rails** | curator sign-off · audit ledger · data residency & consent | across everything; the human-in-the-loop is printed on the face. |
| **Learning loop** | verified answers → corpus | every confirmed report and attested family/tenant item flows back into the Reference corpus, so the next query is stronger. **This is the moat compounding.** |

---

## 3. The corpus / RAG layer — the moat, built honestly

The differentiator isn't the official registers (anyone can call them); it's that veradis **has read every forum, catalogue and dealer teardown** and can cite the right one with a confidence weight. The research gives us a clean build priority:

- **Tier 1 — official APIs (ground truth, ingest cleanly):** Scryfall (MTG), pokemontcg.io / TCGdex (Pokémon), Numista (coins/banknotes, incl. **image-ID**), PCGS public API (CoinFacts + Auction Prices Realized, 1k/day free), PSA public API (card cert), PriceCharting (cards, paid), WatchBase DataFeed (watches, paid).
- **Tier 2 — free/scrapable, no API (high value, snapshot + cite):** Heritage archive (2M+ lots, all categories), Newman Numismatic Portal (14k catalogues, free), Noonans + Spink + eMedals (medals), acsearch.info (coins + **die-match**), 925-1000.com + silvercollection.it (silver marks), TCDB (sports cards), Caliber Corner + Ranfft (watch movements — snapshot Ranfft; it's frozen since the maintainer died in 2024), VarietyVista / CONECA (coin varieties), the NGC/PMG/Beckett/SGC/CGC cert-lookup pages.
- **Tier 3 — subscription/licence (buy the feed, don't scrape):** CoinArchives Pro, Card Ladder, VCP, Greysheet, WatchCharts, LiveAuctioneers/Invaluable aggregators.
- **Tier 4 — MANUAL-ONLY (cite as evidence, never ingest as fact):** all forums (WatchUSeek, Omega Forums, British Medal Forum, GMIC, CoinTalk, Blowout, 925-1000 forum) and forensic experts (**Perezcope** for watches, Forum Ancient Coins fake reports). Highest Risk signal, unstructured human judgement — surface as a linked citation with a confidence note, never as a resolved fact.

**Rule (the RAG architect's):** Tier 1 = ground truth (can *close* a check). Tiers 2–3 = corroboration (can *raise/lower confidence*, cite with the retrieval state). Tier 4 = evidence-pointer only (dashed node, "expert opinion, off-platform"). The confidence interval absorbs the difference — which is exactly why the product is a *score*, not a verdict.

---

## 4. Attribute-from-image + mislabel correction — "trust the photo, not the form"

The owner's typed label is a hypothesis. The engine derives the true attributes from the image and cross-indexes:

1. **Read the marks.** Vision/OCR/logo detection reads the maker mark, serial/reference, hallmark, naming engraving, backstamp, or movement signature.
2. **Cross-index visually** where a matcher exists: **acsearch die-match** (coins), **Numista image-ID** (coins), labelled card image sets (**Scryfall / pokemontcg.io / TCDB**), hallmark tables (**925-1000 / silvercollection.it** + Assay Office app), watch movement/dial image sets (WatchBase / Ranfft / Caliber Corner), plus a generic reverse-image first pass to narrow the field.
3. **Reconcile with the claim.** If the derived maker contradicts the stated one — user typed **Omega**, the crown and movement say **Rolex** — the engine raises a **first-class correction** (`{claimed, evidence, corrected_value, kindness_note}`, Spec v03 §4), **re-routes to the correct category profile**, and re-scores. The report shows the correction with the kindness register — never gloats. This is a *product win*, not an error: it's veradis catching what the owner couldn't, on the record.
4. **Guard the input.** C2PA / EXIF check flags an AI-generated or edited submission photo before it can poison a score (Spec v03 §5 non-negotiable).

This single capability — *we tell you what it actually is, from the photo* — is the most demonstrable trust moment in the whole service.

---

## 5. The five MVP categories

Chosen to span the difficulty spectrum: two API-rich categories that prove the engine fast, two high-value/moat categories that carry the brand and the existing fixtures, one decorative-arts category where the hallmark *is* the cert. Each profile ships as versioned data (identity keys · required views · red flags · corpus sources · comps).

### A · Coins & banknotes (numismatics) — *the engine-prover*
- **PCS specialisation:** variety/die attribution; mint mark; grade; die-match against catalogued lots.
- **Identity keys:** country · denomination · year · mint mark · variety (never a "serial"). **Red flags:** cast/tooled fakes, altered dates, cleaned/whizzed surfaces, counterfeit slabs.
- **Sources:** *Tier 1* PCGS API, Numista API (image-ID). *Tier 2* NNP (14k catalogues, free), acsearch (die-match), VarietyVista/CONECA, NGC/PMG cert pages. *Tier 4* CoinTalk, Forum Ancient Coins fake reports. **Cert:** real (PCGS/NGC/PMG). **Comps:** Heritage APR, PCGS APR, acsearch.
- **Why first:** richest machine-readable data + the flagship die-match mislabel demo. Proves every engine capability end-to-end.

### B · Trading cards (sports + TCG) — *the volume-prover*
- **PCS specialisation:** set/card identity, print variation, grade + cert authenticity, slab-fraud detection.
- **Identity keys:** set · card # · player/character · variant/parallel · grade · cert #. **Red flags:** trimmed cards, recoloured, cracked/counterfeit slabs, mismatched cert.
- **Sources:** *Tier 1* Scryfall (MTG, free), pokemontcg.io/TCGdex (free), PSA cert API. *Tier 2* TCDB, CheckCOA multi-house cert, NGC/Beckett/SGC/CGC pages. *Tier 3* PriceCharting, Card Ladder. *Tier 4* Blowout, Net54, r/sportscards. **Cert:** real (PSA/BGS/SGC/CGC). **Comps:** Heritage, Goldin, PWCC, PSA APR, 130point.
- **Why:** best free APIs in the whole map + huge, fast, younger-buyer demand. (Note: **TCGplayer API is closed** — route pricing via PriceCharting + auction archives.)

### C · Medals & militaria (UK/Commonwealth/Canadian) — *the moat*
- **PCS specialisation:** rim-naming → roll match → Gazette citation; group cohesion; renaming/copy-strike detection.
- **Identity keys:** recipient naming (rank/name/unit) · campaign/award · group completeness. **Red flags:** renamed, copy striking, wrong naming style, married groups.
- **Sources:** *free official* London Gazette API, **VAC Virtual War Memorial API (CA)**, TNA Discovery, CWGC. *Tier 2* **Noonans (400k lots)**, Spink, **eMedals (Canadian)**, Angloboerwar/North East Medals rolls. *Tier 4* British Medal Forum, GMIC. **Cert:** none — naming-to-roll is the identity. **Comps:** Noonans/Spink/eMedals archives. **Moat:** your ingested regimental graph (Seaforth / 5 & 15 Field). **Fixture:** reproduce **Smith VC** from inputs.
- **Why:** aligns to your network + your existing tenants + the best *free* official sources among the heritage categories.

### D · Watches / horology — *the hero, the highest value*
- **PCS specialisation:** reference+serial identity, **movement-first** authentication, redial/franken/service-swap detection.
- **Identity keys:** maker · reference · serial · caliber. **Red flags:** franken, redial, serial mismatch, service-replaced parts. **Cert:** official brand **archive extract** (Omega/Patek/VC/JLC/AP — owner mail-in; **Rolex: none**) → render as a named ask, not a claim.
- **Sources:** *Tier 1* WatchBase DataFeed (paid). *Tier 2* Ranfft (snapshot), Caliber Corner, 17jewels, ChronoMaddox, serial charts. *Tier 4* **Perezcope** (forensics), Omega/Rolex forums, VRF. **Comps:** Phillips, Antiquorum, Heritage, Chrono24/WatchCharts (licence). **Fixture:** reproduce **RW Don Giovanni**.
- **Why:** the brand hero, highest value per object; deep corpus; the movement-first read is a strong forensic story.

### E · Silver & hallmarked ware / decorative arts — *the decorative-arts wedge*
- **PCS specialisation:** hallmark parse (standard/town/date-letter/maker) — **the mark is the cert**; erasure/re-engraving detection; weight vs reference.
- **Identity keys:** hallmarks + inscription. **Red flags:** erased/re-cut inscriptions, let-in marks, married pieces, repairs. **Cert:** the assay hallmark itself (parseable).
- **Sources:** *free official* Assay Office London date-letter tools. *Tier 2* **925-1000.com (12k marks)**, silvercollection.it, silvermakersmarks.co.uk. *Tier 4* 925-1000 forum, ASCAS, Bexfield/AC Silver. **Comps:** Woolley & Wallis, Christie's/Sotheby's/Bonhams silver, Heritage. **Moat:** Wührmann + Tuscan-style decorative-arts tenants. **Fixture:** reproduce **Tuscan tea service** ladder + **Salisbury** correction.
- **Why:** rounds out the decorative-arts side, the hallmark gives a clean parseable identity, reuses your existing fixtures.

**Recommended build order:** **Coins → Medals → Watches → Cards → Silver.** Coins prove the automated pipeline + the mislabel die-match on the richest data; Medals immediately bank the moat and reproduce Smith VC on the same pipeline; Watches deliver the hero; Cards add volume; Silver closes the decorative-arts loop. *(Strategic alternative if you want to lead brand-first: Medals → Watches → Coins → Silver → Cards.)*

---

## 6. Confidence over perfection — the design that makes grey sources safe

- **Three source-quality states per check:** **Authority-resolved** (Tier 1 API — can close), **Corpus-corroborated** (Tier 2–3 — raises/lowers confidence, cited), **Declared-only / Forum-cited** (Tier 4 or user claim — half credit, widens CI, curator-review-pending on a primary key).
- Missing/soft evidence **widens the interval; it never lowers the score** (Spec v03 §4). A watch scored from forum consensus + a serial chart is an honest wide-CI Silver, not a false Gold.
- Every Tier-4 citation renders as a **dashed node** — simultaneously an honesty marker and a recruitment lead (attest the extract, close the check, tighten the ±).
- The critic gate blocks any close on a Tier-2/3/4 source and blocks the word "authenticated." The human confirms the judgement calls.

This is why the co-pilot can lean on messy community knowledge without lying: **the score is the doubt, quantified.**

---

## 7. Build order, acceptance, open decisions
- **P0:** engine skeleton (category-agnostic) + **Coins** profile + attribute-from-image + corpus retrieval (Tier 1–2) + scorer + critic + curator confirm. Acceptance: score a real coin end-to-end and demo a mislabel correction.
- **P1:** **Medals** profile — reproduce **Smith VC** from inputs (the moat + fixture gate); wire the free official sources + Noonans corpus + the regimental graph.
- **P2:** **Watches** (reproduce RW) + **Cards**; add WatchBase + PSA/Scryfall/pokemontcg APIs; the registry sweep.
- **P3:** **Silver** (reproduce Tuscan + Salisbury); gated Risk-source procurement (ALR/Watch Register); C2PA vendor; toward auto-definitive with human sampling.
- **Open founder rulings:** lead category (data-first vs brand-first); where it runs (populate `veradis-platform` vs standalone); pricing (flat CHF 20 vs Gold/Silver multipliers); corpus licence budget (WatchBase, PriceCharting, CoinArchives Pro); C2PA vendor.

---

*The reports are the product; the corpus is the moat; the confidence interval is the honesty. Build the engine on the richest data, prove it on your own fixtures, and let the learning loop compound. AI generates. veradis verifies.*
