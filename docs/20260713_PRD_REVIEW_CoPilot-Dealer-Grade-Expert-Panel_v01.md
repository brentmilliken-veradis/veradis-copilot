# Final expert review — is the co-pilot report dealer-grade?

**13 Jul 2026 · PRD · pre-build critical review.** The question on the table, in Brent's words: *does the report reach and exceed the standard a watch house or a certified second-hand-watch dealer would use to validate verification and pricing for their own customers?* Panel: the eight design seats (v02 spec) + a **senior marketing/brand lead** + a **second-hand watch-house principal** (the "would you actually use this?" seat).

---

## The verdict, up front (so nobody has to hunt for it)

**On transparency, sourcing and pricing-defensibility: it already exceeds the industry norm.** What a dealer hands a customer today is a verbal "it's genuine, trust me" and a generic receipt. veradis hands a sourced dossier — every claim cited, honest gaps named, a published confidence interval, a defensible price, reproducible to the digit. No high-street dealer offers that. As a **co-branded verification-and-pricing report attached to a listing, it is a category-leading trust instrument today.**

**On definitive authenticity of a high-value watch: not yet — and it must never claim to be.** For a $30k Rolex, three things a dealer relies on are not yet in the engine: a **theft check** (The Watch Register — gated, no API), a **forensic authenticity read** (movement-first, super-clone/franken tells), and the **brand archive extract** (owner mail-in). Until those are wired, the report is a **best-in-class pre-screen + provenance/price intelligence, expert-reviewed** — not a substitute for a watchmaker opening the case. The brand ceiling stays **"verified against the documentary record, expert-reviewed," never "authenticated."** Hold that line and the report is trusted *because* it doesn't overreach.

**Net:** ship it as the transparent verification+pricing layer dealers put on every listing; build the four things below to climb from "pre-screen" to "a dealer stakes the sale on it" for high value.

---

## The panel — each seat's critical take + the one fix they require

- **Second-hand watch-house principal (the buyer of this).** *"I'd put this on every listing under $5k tomorrow — it closes the customer's trust gap and lets me hold price. For a grail, I still need the theft check and someone who's opened the caseback. Give me a **theft-clear line, a movement read, and my logo next to yours** and I'll pay per report."* **Fix: Watch Register theft check + movement forensics + co-branding.**
- **Vintage-watch auction specialist.** *"The movement is the tell. Right now the vision reads the dial and serial; it must read the caliber and the finishing and flag a swapped movement or a redial. Without that, a watch report is provenance, not authentication."* **Fix: movement-first forensic vision.**
- **Art-crime / provenance researcher.** *"No theft check = no dealer reliance for resale. The honest 'pending' line is correct but a reseller needs it resolved. Watch Register or Interpol ID-Art, per-check."* **Fix: stolen-property integration (paid/partner).**
- **Computer-vision / forensics lead.** *"Two builds: (1) super-clone/franken tell-detection trained on the Perezcope-class corpus; (2) C2PA on ingest — the first fraud vector is a doctored submission photo, and it must be blocked before a dealer's name is on the report."* **Fix: forensic tell-model + C2PA anti-fraud.**
- **USPAP appraiser.** *"The price is defensible — asks excluded, real sales, FX, recency. For a dealer/insurer, add the conformal line ('90% of like references sold inside this band') and keep the independence + staleness lines. Never a %-of-value fee."* **Fix: conformal pricing calibration.**
- **ML / RAG architect.** *"The corpus tiering is right. The one gap: the scorer must be **deterministic (pinned seed)** so two runs match — a dealer/insurer can't rely on an LLM that drifts. Encode v21; the LLM drafts narrative, not the number."* **Fix: deterministic scorer, LLM out of the score.**
- **Knowledge-graph engineer.** *"Add the **verify-this-report** endpoint + QR now. A dealer's customer must independently confirm the report is genuine and unaltered — hash-chained. The report is itself an object that can be forged."* **Fix: verify-report permalink/QR + hash chain (report anti-forgery).**
- **Senior marketing / brand lead.** *"The report is credible and beautiful — that's 80% of the sell. For the dealer segment the value is conversion + price + fewer disputes. Make it **co-brandable**, make it **embeddable on a listing** (the CARFAX badge), and put a **3-second customer takeaway** at the top (the ring already does this). Position it: 'the independent report that lets you charge what it's worth.' Don't sell dealers 'authentication' — sell them **a closed sale and a defended price.**"* **Fix: co-branding + embeddable listing badge + segment-specific headline.**
- **Insurance underwriter.** *"I'd schedule against the Appraise band if it carries the redaction tiers (serials/location) and the <3-year staleness. Add the insurer copy."* **Fix: redaction tiers (owner/insurer/public).**
- **Conservator / registrar.** *"The Object ID core + hash + provenance graph is museum-grade already. Fine for institutions."* **No new fix — already covered.**

---

## Technical architecture — gaps vs. what's covered

**Already in the design (v01/v02 spec + the demo proved them):** the report skeleton + honesty register, the four-quadrant scorer + CI + lower-bound tiering, the corpus/RAG tiering, attribute-from-image + mislabel correction, the evidence ladder / re-run mechanic (v01→v02 lived it), the sealed-state + provenance-narrative rules, the graph moat + learning loop, Object-ID/hash attestation, the liability + independence + staleness copy.

**Gaps to close for the dealer-grade bar (the build list this review produces):**
1. **Movement-first forensic vision** for watches — caliber ID, finishing, replacement-part / redial / franken tells (the corpus of Perezcope-class knowledge, applied). *The single biggest lift for watches.*
2. **Stolen-property check** — The Watch Register (per-check/partner) + Interpol ID-Art; render a real theft-clear line, not "pending." *Non-negotiable for resale reliance.*
3. **Brand archive-extract workflow** — orchestrate the owner's Omega/Patek/etc. extract request as a tracked evidence event (a workflow, not a claim); Rolex has none — say so.
4. **C2PA / anti-fraud on ingest** — block AI-generated/edited submission photos before a report is issued.
5. **Deterministic scorer** — encode v21 pinned-seed; LLM drafts narrative only. *Reproducibility is a dealer/insurer requirement, not a nicety.*
6. **Verify-this-report endpoint + QR + hash chain** — so the customer can prove the report is genuine and unaltered. *Report anti-forgery.*
7. **Co-branding + embeddable listing badge** — the dealer's logo alongside veradis; a widget the dealer drops on a product page (the CARFAX-on-the-listing model). *This is the B2B distribution wedge.*
8. **Redaction tiers** (owner / insurer / public) + conformal pricing line — for insurer schedulability and public listings.
9. **Credentialed curator path (Grade 2)** — for high value, the confirming human is a credentialed specialist; the report prints who signed. *Trust scales with the credential on the face.*

Items 1–4 are the "does a dealer rely on it for a real watch" gates. 5–9 are what make it a distribution-ready B2B product.

---

## Marketing / segment value (the senior marketing seat, expanded)

- **Segments and the value each pays for:** collectors/families → provenance + value + peace of mind (the demo). **Dealers/resellers → conversion, premium price, fewer returns/disputes** (attach an independent report to every listing). Insurers → schedulable value. Platforms → a compliance API.
- **The dealer wedge is the biggest near-term revenue and the strongest pitch:** "**the independent report that lets you charge what it's worth, and lets your buyer trust you.**" It's the CARFAX model applied to watches/collectibles — the buyer expects the report, the seller who provides it converts higher and holds price.
- **What the report needs for that segment:** co-branding, an embeddable/shareable badge for listings, a QR the buyer scans to verify, and the 3-second verdict up top (present). Keep the "what this is / isn't" honesty — it's *why* dealers can safely attach it.
- **Positioning guardrail (marketing + legal agree):** never market "authentication" to dealers. Market **transparency, sourced verification, defensible price, expert-reviewed.** Overclaiming authenticity is the one thing that turns the honesty moat into a liability.

---

## Go / build decision
**Verdict:** exceeds the current dealer/customer standard on transparency and pricing today; reaches full dealer-grade authenticity reliance for high-value watches after builds **#1–4**; becomes a B2B distribution product after **#7**. Nothing in the review is a reason to stop — it's the sequenced build list.

**Recommended build order (folds into the P0 plan):** keep **Coins P0** to prove the deterministic pipeline (#5) + verify-QR (#6) + C2PA (#4) — all category-agnostic — then **Watches next** with the forensic-vision (#1) + Watch Register (#2) + brand-extract (#3) + co-branding/badge (#7). That sequences the dealer-grade watch product right behind the engine proof.

*Reports are the product. Make them so transparent a dealer can hand one to a customer — and so honest they never say more than they can prove.*
