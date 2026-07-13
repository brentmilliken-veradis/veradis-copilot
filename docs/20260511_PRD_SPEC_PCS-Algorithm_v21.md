# veradis.ai — PCS Algorithm Specification v21

**File:** `20260511_PRD_SPEC_PCS-Algorithm_v21.md`
**Workstream:** PRD
**Date:** 11 May 2026 (v21 reconciliation) · 12 May 2026 (v20 lock)
**Status:** v21 LOCKED — founder-signed production lock. v20 → v21 closes audit RED flags R1 (AP 5516 worked-example consistency) and R9 (frontmatter Companion pointer). Locks D5 (Fri 15 May 2026).
**Custodian:** Head of Intelligence (algorithm + thresholds) · Head of Product (implementation + APIs)
**Companion (all v21 LOCKED for D5 production pair):** `20260511_INT_BRIEF_PCS-Methodology_v21.md` (methodology) · `20260511_PRD_SPEC_PCS-Build-Plan_v21.md` (engineering plan) · `20260511_LEG_BRIEF_Verify-Disputes-Publicity-NDA_v20.md` (Stripe disputes, publicity, NDA) · `20260511_MKT_DRAFT_Marketing-Site-Copy_v21.md` (LOCKED) · `20260511_MKT_BRIEF_Marketing-Site-Visual-Direction_v20.md` (LOCKED)
**Supersedes:** v20 (12 May 2026, archived to `_ARCHIVE/_ARCHIVE_20260512_PRD_SPEC_PCS-Algorithm_v20.md`) · v01 working draft (12 May 2026, D3 evening update)
**Source of truth:** SSOT v10 §11 · PCS Methodology Brief v21 (which folded v10.1 + 11 May Refund Policy Amendment)

---

## v20 → v21 changelog

| Audit flag | Section touched | Change |
|---|---|---|
| R1 | §13.2 #12 (AP 5516 worked-example note) | `92.45 / Gold` → `93.35 / Gold`. Aligns with §12.1 arithmetic and Methodology v21 §5 worked example. |
| R3 follow-up | §14.3a Stripe-checkout / webhook reference | Renamed `apps/verify-web` → `apps/verify`; `verify-api` Stripe webhook receiver → Stripe webhook receiver under `apps/verify/api/v1/*`. Closes Reconciliation Report §3.1 R3 residual per disposition (a) — adopts founder-canonical four-app tree (`apps/marketing`, `apps/demo`, `apps/verify`, `apps/stage`) consistent with Build Plan v21 §1. |
| R9 | Frontmatter Companion line | `20260511_LEG_BRIEF_Verify-Disputes-Publicity-NDA_v02.md` → `_v20.md`. Methodology / Build Plan / Marketing Copy pointers retagged to v21. |
| — | Frontmatter File / Status / Supersedes | Re-tagged v20 → v21 per the audit closure. |

§12.1 (composite arithmetic + worked-example body) already reads 93.35 in v20 — verified, no edit. Methodology v21 §5 reads 93.35 — verified, no edit. Confidence interval [88, 96] and Gold tier unchanged. All §1–§14 body content is reproduced verbatim from v20 except the §13.2 #12 number.

**Lock notes — v01 working draft → v20 LOCKED**

v20 is the founder-signed production lock of the algorithm specification for D5 launch and the W3 methodology paper. The lock-marker bump aligns the spec with the marketing copy v20, visual brief v20, methodology brief v20, and build plan v20 — all D5-launch companions read v20 LOCKED so engineering and design teams work from a single in-sync founder-signed pair. Internal references to "v01" / "v02" in roadmap context (e.g. "ships at D5 launch" vs "slips to post-anchor") and the `pcs-v01` seed-salt constant are intentionally preserved: the v01/v02 nomenclature on the algorithmic release-line is decoupled from the document lock-marker. The seed salt does not change with the doc version — that would invalidate every cached score for no methodological reason.

---

## §0 — Purpose, scope, constraints

This document is the technical companion to PCS Methodology v10.1, as amended by the 11 May 2026 Refund Policy Amendment (publishing as v20). It is written for engineers building the verify.veradis.ai scoring service and the demo.veradis.ai institutional surface. It specifies how the four-quadrant model in v10.1 §2–§4 is computed, how authority resolution is sequenced, how confidence intervals are produced, how the curator queue routes exceptions, how the watch corpus is ingested for the D5 launch, and how the output-tier and refund logic implement the v20 commercial model.

**LOCKED inputs from v10.1 + v20.** Quadrant weights (30/30/25/15), pass thresholds, liability framing, and the v20 commercial model (Flagged paid + delivered with evidence; Unscored refunded; Withheld curator-mediated) are LOCKED. **Tier-band thresholds shift in v20 to Gold 80–100 / Silver 60–79 / Bronze 40–59 / Unscored indeterminate / Flagged 0–39.** This document does not redesign these. Any further recalibration requires a new versioned PCS Methodology Brief.

**Out of scope.** Domain-specific data-point inventories beyond watches, military heritage, and automotive (further domains land in v02). UI surface specs (those live in `20260513_PRD_BRIEF_Demo-Platform-Architecture_v03.md`). Marketing site rendering of PCS thumbnails (those live in the Marketing Site Visual Direction v20 §3 /verify). Cap-table or commercial pricing logic (Verify SKU prices LOCKED in SSOT v10 §9; consumed read-only here).

**Reading order.** §1 architecture · §2–§5 quadrant pseudocode · §6 authority resolution · §7 confidence interval · §8 tier mapping · §9 curator QA queue · §10 ALR decision · §11 watch corpus · §12 test cases · §13 build plan.

---

## §1 — Architecture overview

PCS scoring is a deterministic pipeline with one stochastic step (the Monte Carlo draw inside the confidence interval). The inputs are an `Object` graph node and a `Query` context. The output is a `PCSReport` containing the composite score, the four quadrant scores, a 95% credible interval, the tier, the disclosure paragraph, and the audit trail.

```
                ┌────────────────────────────────────┐
   Query ──▶    │  ScoringOrchestrator               │ ──▶ PCSReport
   ObjectId     │   ├─ AuthorityResolver  (§6)       │
                │   ├─ IdentityScorer     (§2)       │
                │   ├─ CustodyScorer      (§3)       │
                │   ├─ MaterialScorer     (§4)       │
                │   ├─ RiskScorer         (§5, §10)  │
                │   ├─ ConfidenceEngine   (§7)       │
                │   ├─ TierMapper         (§8)       │
                │   └─ CuratorQueue       (§9)       │
                └────────────────────────────────────┘
```

Every component is pure with respect to the graph snapshot at query time. Snapshots are immutable, addressed by `(objectId, snapshotTs)`. A re-issued PCS report against the same snapshot must produce a bit-identical score; only the confidence interval may differ if the Monte Carlo seed is not pinned. The seed is pinned in production runs (see §7).

**Service shape.** Implemented as a Supabase edge function (`/api/v1/score`) backed by Postgres with the `vector` and `pgmq` extensions. The orchestrator emits structured events to `pcs.score_events` for the curator queue and the empirical-validation pipeline.

**Latency budget.** P50 800 ms, P95 2.5 s, P99 6 s. Authority resolution dominates; results are cached at the resolver layer with a 30-day TTL for stable IDs and a 24-hour TTL for sanctions/registry hits.

---

## §2 — Quadrant 1: Identity Integrity (30%)

Identity scores the percentage of identity attributes that are populated *and* authority-resolved. Authority-resolution earns full credit; declared-only earns half; missing earns zero. The attribute inventory is domain-keyed.

```pseudocode
function scoreIdentity(object, domainProfile):
    inventory = domainProfile.identityInventory  # e.g. watches, military, automotive
    weights   = inventory.attributeWeights        # sums to 1.0 within quadrant

    score = 0.0
    checks = []
    for attribute in inventory.attributes:
        value = object.getAttribute(attribute.key)
        resolution = AuthorityResolver.resolve(attribute, value)

        if resolution.status == AUTHORITY_RESOLVED:
            credit = 1.0
        elif resolution.status == DECLARED_ONLY:
            credit = 0.5
        else:
            credit = 0.0

        score += weights[attribute.key] * credit
        checks.append(QuadrantCheck(
            attribute = attribute.key,
            credit    = credit,
            evidence  = resolution.evidenceUri,
            authority = resolution.authority))

    return QuadrantScore(
        quadrant = "Identity",
        raw      = score * 100,
        passed   = score * 100 >= 70,
        flags    = []  if score * 100 >= 50  else  [QuadrantFlag.CURATOR_REVIEW],
        checks   = checks)
```

**Domain inventories (locked for D5 launch).**

| Domain | Attributes | Default weights |
|---|---|---|
| Horology | maker, reference, serial, calibre, case-material, dial-config, hallmarks | 0.20 / 0.20 / 0.20 / 0.15 / 0.10 / 0.10 / 0.05 |
| Military heritage | maker, model, serial, regiment-issue, period-marks, broad-arrow | 0.20 / 0.20 / 0.20 / 0.20 / 0.10 / 0.10 |
| Automotive | manufacturer, VIN, chassis, engine-number, body-number, build-spec | 0.15 / 0.30 / 0.20 / 0.15 / 0.10 / 0.10 |

Inventory weights live in `domain_profiles` in Postgres. Changing them is a schema migration plus a versioned brief — they are *quadrant-internal* weights, distinct from the LOCKED 30/30/25/15 cross-quadrant weights.

---

## §3 — Quadrant 2: Chain of Custody (30%)

Custody scores chain completeness with an explicit gap analysis. The chain is a sorted list of custody events (acquisition, gift, sale, exhibition, conservation, storage). Gaps between events count against the score per v10.1 §3.

```pseudocode
function scoreCustody(object, domainProfile):
    events = sortByDate(object.custodyEvents)
    if events.isEmpty():
        return QuadrantScore("Custody", 0, false, [GAP_TOTAL], [])

    inception = events.first().date
    today     = now()
    totalSpan = years(inception, today)

    # 1. Coverage: fraction of timeline backed by at least one event-document
    coveredYears = sumCoveredYears(events)
    coverage     = clamp(coveredYears / totalSpan, 0, 1)

    # 2. Gap penalty: each gap > 12 months reduces coverage; > 5 years escalates
    gaps = identifyGaps(events, minGapMonths = 12)
    gapPenalty = 0.0
    for g in gaps:
        if g.years > 5:
            gapPenalty += 0.15  # high gap risk
        elif g.years > 1:
            gapPenalty += 0.05  # medium gap risk
        else:
            gapPenalty += 0.0

    # 3. Document-quality multiplier
    qualityMultiplier = mean([documentQuality(e.document) for e in events])
    # documentQuality returns 1.0 for primary records (deed-of-gift, sale invoice,
    # signed appraisal), 0.7 for secondary (catalogue mention, exhibition listing),
    # 0.4 for tertiary (oral history, undated photograph).

    raw = clamp(coverage - gapPenalty, 0, 1) * qualityMultiplier * 100
    gapBucket = if any(g.years > 5 for g in gaps) then HIGH
                elif any(g.years > 1 for g in gaps) then MEDIUM
                else LOW

    return QuadrantScore(
        quadrant = "Custody",
        raw      = raw,
        passed   = raw >= 70,
        flags    = [DISCLOSURE_REQUIRED] if raw < 50 else [],
        checks   = events.toCheckList(),
        metadata = { "gapBucket": gapBucket, "gapCount": len(gaps) })
```

`identifyGaps` returns intervals between consecutive event end-dates and next start-dates. Coverage is computed over event-windows, not point events; insurance appraisal records are treated as windows from `appraisalDate` to `appraisalDate + appraisalValidityYears` (default 1, override per insurer).

---

## §4 — Quadrant 3: Material Integrity / Forensic Match (25%)

Material scores the percentage of forensic checks that ran *and* returned a consistent result. v10.1 §3 specifies a critical asymmetry: an inconsistency scores 0 on the affected check, but a *missing* check does not penalise the score — it widens the confidence interval. This pseudocode encodes that asymmetry.

```pseudocode
function scoreMaterial(object, domainProfile):
    expectedChecks = domainProfile.materialChecks
    actualChecks   = object.forensicResults

    weightedSum = 0.0
    weightUsed  = 0.0
    missingCheckWeight = 0.0
    inconsistencies    = []

    for check in expectedChecks:
        result = actualChecks.find(check.key)
        if result is None:
            # Missing check → does not lower score; widens CI via §7
            missingCheckWeight += check.weight
            continue
        if result.status == CONSISTENT:
            weightedSum += check.weight * 1.0
        elif result.status == AMBIGUOUS:
            weightedSum += check.weight * 0.5
        else:  # INCONSISTENT
            weightedSum += check.weight * 0.0
            inconsistencies.append(result)
        weightUsed += check.weight

    if weightUsed == 0:
        # No forensic data at all
        return QuadrantScore("Material", 0, false,
                             [NO_FORENSIC_DATA, CURATOR_REVIEW], [],
                             metadata = { "missingWeight": 1.0 })

    raw = (weightedSum / weightUsed) * 100
    passThreshold = if missingCheckWeight > 0.3 then 60 else 75

    flags = []
    if inconsistencies:
        flags.append(MATERIAL_INCONSISTENCY)
    if missingCheckWeight > 0.5:
        flags.append(CURATOR_REVIEW)

    return QuadrantScore(
        quadrant = "Material",
        raw      = raw,
        passed   = raw >= passThreshold,
        flags    = flags,
        checks   = actualChecks,
        metadata = { "missingWeight": missingCheckWeight,
                     "inconsistencyCount": len(inconsistencies) })
```

`missingWeight` is consumed by §7 to inflate the per-quadrant variance.

**D5 forensic check inventory — horology.** Movement-serial / case-serial concordance, calibre photometric match, lume isotope (if claimed pre-1965), case-mark chirality, dial-print microscopy, bracelet tooling-mark consistency, replacement detection (case, dial, hands, crown, bracelet).

**D5 forensic check inventory — military.** Broad-arrow stamp pattern, period-correct fastener metallurgy, regimental engraving consistency, finish layer chronology (when available), serial-die comparison.

**D5 forensic check inventory — automotive.** VIN-plate metallurgy, chassis stamping consistency, engine-block casting marks, period-correct paint layer chemistry, build-sheet verification.

---

## §5 — Quadrant 4: Risk Profile (15%)

Risk starts at 100 and is reduced by detected flags. The high-severity rule under v20 is hard: any single high-severity flag forces the Flagged tier (with the Evidence Bundle per §5.1) regardless of other quadrant scores. For non-sanctions high-severity hits (stolen-property registries, patrimony disputes) the algorithm holds the Flagged report behind a 60-minute curator confirmation (S0 in §9) before delivery to the requester, to guard against false positives — per GC review. Sanctions hits (OFAC/SECO/EU/UK) ship without the hold because the curated nature of those registries makes false-positive risk lower than the non-publication exposure of a real hit.

```pseudocode
function scoreRisk(object, query):
    score = 100.0
    flags = []

    # 1. Stolen / cultural property registries
    stolenHits = StolenRegistryAdapter.check(object)        # §10
    for hit in stolenHits:
        flags.append(RiskFlag(severity = HIGH, source = hit.source, ref = hit.id))
        score -= 100  # forces score floor; will be capped at 0 below

    # 2. Cultural patrimony / repatriation
    patrimonyHits = PatrimonyAdapter.check(object)
    for hit in patrimonyHits:
        if hit.disposition == DISPUTED:
            flags.append(RiskFlag(severity = HIGH, source = hit.source))
            score -= 100
        elif hit.disposition == REVIEW:
            flags.append(RiskFlag(severity = MEDIUM, source = hit.source))
            score -= 25

    # 3. Sanctions
    sanctionsHits = SanctionsAdapter.check(object.parties + query.parties)
    for hit in sanctionsHits:
        flags.append(RiskFlag(severity = HIGH, source = hit.source))
        score -= 100

    # 4. Liens, litigation, AML
    encumbrances = EncumbranceAdapter.check(object)
    for e in encumbrances:
        if e.type in (LIEN_ACTIVE, LITIGATION_ACTIVE):
            flags.append(RiskFlag(severity = MEDIUM, source = e.source))
            score -= 15
        else:
            flags.append(RiskFlag(severity = LOW, source = e.source))
            score -= 5

    score = clamp(score, 0, 100)
    hasHigh = any(f.severity == HIGH for f in flags)

    return QuadrantScore(
        quadrant = "Risk",
        raw      = score,
        passed   = score >= 80 and not hasHigh,
        flags    = flags + ([COMPOSITE_OVERRIDE_FLAGGED] if hasHigh else []),
        checks   = [stolenHits, patrimonyHits, sanctionsHits, encumbrances])
```

The `COMPOSITE_OVERRIDE_FLAGGED` flag is consumed by `TierMapper` (§8) and short-circuits tier assignment to `Flagged` regardless of composite score.

### §5.1 — Flagged Evidence Bundle (v20 paid deliverable)

Under v20, Flagged is a paid deliverable, not a withheld output. The buyer paid for the answer; when the answer is "counterfeit / stolen / inconsistent with the manufacturer's record," that is the answer they receive — with the evidence. The algorithm assembles a `FlaggedEvidenceBundle` on every Flagged output (whether tier was forced by Risk override or fell out of the 0–39 band) and ships it as part of the PCSReport payload.

```pseudocode
structure FlaggedEvidenceBundle:
    finding:         enum { COUNTERFEIT, STOLEN, SANCTIONS_HIT, PATRIMONY_DISPUTE,
                            MATERIAL_INCONSISTENCY, IDENTITY_MISMATCH, MIXED }
    primarySources:  list[EvidenceCitation]   # named, dated, link or document hash
    supportingChecks:list[QuadrantCheck]      # the failed checks with their evidenceUri
    contradictions:  list[ContradictionRecord]# claimed vs observed, with citation
    appealWindow:    Duration                 # 14 days per ToS §8
    curatorContact:  Endpoint                 # where the recipient files an appeal

function assembleFlaggedBundle(quadrantScores, riskQuadrant, object):
    finding = inferFinding(riskQuadrant.flags, quadrantScores)
    sources = collectPrimarySources(riskQuadrant.checks)
    failed  = [c for q in quadrantScores for c in q.checks if c.credit == 0]
    contras = collectContradictions(object, quadrantScores)
    return FlaggedEvidenceBundle(
        finding = finding,
        primarySources = sources,
        supportingChecks = failed,
        contradictions = contras,
        appealWindow = days(14),
        curatorContact = curator_endpoint_for(object.domain))
```

**What the bundle does not contain.** Personal data of any party other than the requester (no buyer names, no consignor names without consent). Speculative reasoning unsupported by a primary source. Any commentary that reads as a legal determination — language stays in the evidence-aggregation register per v10.1 §6.

**Withheld is the exception.** If the bundle's primary sources include a registry hit where the source's protocol forbids automatic disclosure to the requester (current candidates: Interpol stolen-works, ALR once enabled, certain national patrimony registries), the algorithm routes to **Withheld** instead of shipping the bundle — see §9.5 below. The customer is refunded; the curator-mediated channel takes over.

---

## §6 — Authority resolution

### §6.1 Priority order

For every authority-resolvable attribute (maker, artist, manufacturer, place, person), the resolver attempts sources in this fixed order and stops at first canonical match:

1. **ULAN** (Getty Union List of Artist Names) — fine-art makers, artists, foundries.
2. **VIAF** (Virtual International Authority File) — persons, corporate bodies, families.
3. **Wikidata** — fallback for entities outside ULAN/VIAF (manufacturers without museum cataloguing, regiments, watch references).
4. **Manufacturer archive** — domain-specific endpoints: Omega Vintage Database, Rolex production ledger fragments (where licensed), AP archives, Patek Philippe extracts, Bonhams/Christie's/Sotheby's auction archives keyed by reference.

A resolution that traverses to step 4 is still `AUTHORITY_RESOLVED` if the manufacturer archive is on the trusted-source list (§6.4). If no source confirms, the resolver returns `DECLARED_ONLY`.

### §6.2 Adapter interface

```pseudocode
interface AuthorityAdapter:
    name: string
    rank: int                   # 1 = ULAN, 4 = manufacturer archives
    rateLimitPerMin: int
    lookup(attribute: AttributeKey, value: any) -> AuthorityResult
    health() -> AdapterHealth   # for circuit breaker

class AuthorityResolver:
    adapters: List[AuthorityAdapter]  # sorted by rank
    cache:    KvCache(ttl = 30d for stable IDs, 24h for volatile sources)

    resolve(attribute, value):
        cached = cache.get(key(attribute, value))
        if cached and not cached.expired:
            return cached
        for adapter in self.adapters:
            if not adapter.health().ok:
                continue
            try:
                result = adapter.lookup(attribute, value)
                if result.status == MATCHED:
                    cache.put(key, result)
                    return AuthorityResult(
                        status     = AUTHORITY_RESOLVED,
                        authority  = adapter.name,
                        canonicalId= result.canonicalId,
                        evidenceUri= result.evidenceUri)
            except RateLimitExceeded:
                queueRetry(adapter, key)
            except AdapterError as e:
                logAndContinue(e)
        return AuthorityResult(status = DECLARED_ONLY)
```

### §6.3 API integration spec (per source)

| Source | Endpoint | Auth | Rate limit | Caching |
|---|---|---|---|---|
| ULAN | `vocab.getty.edu/sparql` (SPARQL) and JSON-LD | none | 10 req/s soft | 30d |
| VIAF | `viaf.org/viaf/{viafID}` and `/AutoSuggest` | none | 5 req/s soft | 30d |
| Wikidata | `query.wikidata.org/sparql` and `wbgetentities` | none | 5 req/s SPARQL, 30 req/s wbgetentities | 30d |
| Omega VAS | `databases.omegawatches.com/extract` (manual extract; not public API) | account-bound web session, OCR-scraped or partner feed | 1 req/min | 90d (production data is immutable) |
| Rolex | no public API; ingested watch corpus (§11) is the authority | n/a | n/a | n/a |
| ALR | `theartlossregister.com/api/v2/lookup` (subject to §10) | API key | per contract, expected 60 req/min | 24h hit, 7d miss |
| Interpol stolen-works | `interpol.int/notices/api/stolen-works` (limited) | mTLS + API key | 30 req/min | 24h |
| OFAC SDN | `sanctionssearch.ofac.treas.gov/api` | none | 10 req/s | 24h |
| ICOM Red List | static dataset, ingested quarterly | n/a | n/a | 90d |

All non-trivial sources are wrapped in a circuit breaker (`failures > 5 in 60s → open for 30s`) and a queue-based retry pipeline (`pgmq`) for transient failures. The resolver never blocks the score path on a degraded source: it returns `DECLARED_ONLY` and emits an event so the curator queue can re-score later.

### §6.4 Trusted-source list

Maintained in `authority_sources` table. Sources flagged `trusted = true` count as authority-resolved. Sources flagged `trusted = false` (ad-hoc forum scrapes, dealer claims) are stored as `evidence` with a confidence weight but do not count as resolution.

---

## §7 — Confidence interval calculation

### §7.1 Recommendation: Bayesian beta-binomial per quadrant, Monte-Carlo composite

**Decision: Bayesian. Locked for v01.**

Each quadrant's score is, structurally, a weighted proportion of checks passed. Beta is the natural conjugate prior for a proportion. With informative domain priors, beta-binomial handles the sparse-data cold-start problem we will hit at launch (each domain has between 0 and 200 prior observations). Frequentist asymptotics require sample sizes we do not have for two of the three D5 launch domains.

**Why Bayesian beats frequentist here.**

1. *Sparse data.* For watches we will have ≤200 verified objects at D5 launch; for military heritage ≤500; for automotive ≤30. Frequentist Wilson or Clopper-Pearson intervals are honest at these sample sizes but uninformative — a 95% Wilson interval on 3-of-4 forensic checks passed sits at roughly [0.30, 0.95]. Useless for tier mapping.
2. *Domain priors.* Beta(α, β) lets us encode, per domain, what we expect "a typical complete object" to look like. We start with weakly informative priors (Jeffreys, Beta(0.5, 0.5)) for D5 launch and tighten them after Seaforth turn-study delivers empirical priors (Q3 2026).
3. *Composability.* A weighted sum of independent betas has no closed form. Monte Carlo is the correct way to propagate uncertainty across the four quadrants. Frequentist would require a Bonferroni-style correction that overstates uncertainty for our use case.
4. *Honesty register.* Bayesian credible intervals communicate "given what we know now" — which matches "intelligence, not insurance" exactly. Frequentist intervals communicate long-run frequency under repeated sampling, which is the wrong epistemic frame for one-shot art-market verification.

### §7.2 Per-quadrant posterior

```pseudocode
function quadrantPosterior(quadrantScore, domainProfile):
    # Convert weighted score into effective successes/failures.
    # Each check carries a weight; total weight scales the "trial count".
    n_eff = sum(check.weight for check in quadrantScore.checks) * domainProfile.scaleFactor
    successes = (quadrantScore.raw / 100) * n_eff
    failures  = n_eff - successes

    # Domain prior — Jeffreys at v01 launch, empirical post-Seaforth.
    prior = domainProfile.priors[quadrantScore.quadrant]   # Beta(α0, β0)

    posterior = Beta(prior.alpha + successes,
                     prior.beta  + failures)

    # Material quadrant: missing-check weight inflates variance.
    if quadrantScore.quadrant == "Material":
        inflation = 1.0 + 2.0 * quadrantScore.metadata.missingWeight
        posterior = inflateVariance(posterior, factor = inflation)

    return posterior
```

`scaleFactor` controls how much the data dominates the prior. Default 10 for horology (high information per check), 5 for military, 3 for automotive (very few priors).

### §7.3 Composite credible interval

```pseudocode
function compositeCI(quadrantPosteriors, weights = (0.30, 0.30, 0.25, 0.15),
                     draws = 10000, seed = pinned_seed):
    rng = seededRng(seed)
    samples = []
    for i in 0..draws:
        s = (weights.identity * quadrantPosteriors.identity.sample(rng)
           + weights.custody  * quadrantPosteriors.custody.sample(rng)
           + weights.material * quadrantPosteriors.material.sample(rng)
           + weights.risk     * quadrantPosteriors.risk.sample(rng)) * 100
        samples.append(s)
    point = mean(samples)
    lo, hi = quantile(samples, 0.025), quantile(samples, 0.975)
    return ConfidenceInterval(point = point, lo = lo, hi = hi, level = 0.95)
```

10K draws give ±0.3 PCS-point Monte Carlo error at the 95% quantile. Pinned seed makes production runs reproducible per `(objectId, snapshotTs)`.

**Deterministic implementation contract (required for bit-identical reproducibility across implementations and audit defensibility).**

| Component | Specification |
|---|---|
| Hash function | SHA-256 over the byte-concatenation `objectId ‖ "|" ‖ snapshotTs ‖ "|" ‖ "pcs-v01"` (UTF-8). Take the first 8 bytes as a little-endian uint64; that is the RNG seed. |
| RNG | PCG64 (O'Neill 2014). Reference implementation: `numpy.random.Generator(numpy.random.PCG64(seed))` in Python; `@stdlib/random/base/pcg64` in JS; equivalent crate `rand_pcg` in Rust. |
| Beta sampler | Cheng's BB algorithm (BB for α,β > 1) and BC algorithm (for α,β ≤ 1), as implemented in NumPy 1.17+ `Generator.beta`. Cross-language ports must produce identical samples for identical (α, β, seed-state). |
| Draw count | 10'000 per quadrant posterior. |
| Quantile method | Linear interpolation (NumPy default, `interpolation='linear'`). |

Implementers must include the SHA-256 of the canonical NumPy reference output for the §12 test cases in `tests/golden/`. The GitHub Actions CI pipeline diffs every PR against those golden outputs.

### §7.4 What the user sees

`PCS 87 ± 4 (95% CI)` means point estimate 87, lower bound 83, upper bound 91. The CI width is published — tight CIs read as "we have the data," wide CIs read as "intelligence with gaps." This is intentional. It is the honesty register made numerical.

---

## §8 — Tier mapping (v20 bands)

### §8.1 Tier mapping function

Tier mapping under v20 has three structurally different states beyond the three positive bands. **Unscored is a data-sufficiency determination, not a score band** — the algorithm decides whether the object is scoreable *before* computing a composite. **Flagged is a paid deliverable** with the evidence bundle from §5.1. **Withheld is a legal-disclosure-restricted route** that refunds the customer and escalates to a curator-mediated channel (§9.5).

```pseudocode
function mapToTier(object, quadrantScores, composite, ci, riskFlags):
    # 1. Data-sufficiency gate. Unscored fires before scoring lands.
    if not isScoreable(object, quadrantScores):
        return TierDecision(tier = Tier.UNSCORED, reason = "insufficient_data")

    # 2. Withheld gate. Legal-restricted disclosure routes here before Flagged ships.
    if hasWithheldDisclosureRestriction(riskFlags, object.jurisdiction):
        return TierDecision(tier = Tier.WITHHELD, reason = "legal_restriction")

    # 3. Risk-override hard short-circuit. Any composite-override flag forces Flagged.
    if COMPOSITE_OVERRIDE_FLAGGED in riskFlags:
        return TierDecision(tier = Tier.FLAGGED, reason = "risk_override",
                            bundle = assembleFlaggedBundle(quadrantScores, ..., object))

    # 4. Score-band mapping, by LOWER bound of the credible interval.
    # Honesty register: we tier on what we can defend, not what we hope.
    lower = ci.lo

    if   lower >= 80:  return TierDecision(tier = Tier.GOLD)
    elif lower >= 60:  return TierDecision(tier = Tier.SILVER)
    elif lower >= 40:  return TierDecision(tier = Tier.BRONZE)
    else:              return TierDecision(tier = Tier.FLAGGED,
                            reason = "score_band",
                            bundle = assembleFlaggedBundle(quadrantScores, ..., object))
```

### §8.2 isScoreable

```pseudocode
function isScoreable(object, quadrantScores):
    # An object is scoreable when at least two of the four quadrants have
    # populated checks AND the Identity quadrant is non-empty.
    populated = count(q for q in quadrantScores if len(q.checks) > 0)
    identityPopulated = len(quadrantScores.identity.checks) > 0
    return populated >= 2 and identityPopulated
```

This is intentionally permissive — most queries with a real serial/reference and any corroborating data clear the gate. The gate exists to catch ill-formed queries (image-only with no metadata, or metadata-only with no domain match in the corpus).

### §8.3 Tier table (v20 LOCKED)

| Tier | Score band (lower CI bound) | Customer pays | Deliverable | Verify multiplier |
|---|---|---|---|---|
| **Gold** | 80–100 | Yes | Full attribution report, no gap disclosure | 2.0× base |
| **Silver** | 60–79 | Yes | Full attribution with notes / disclosed gaps | 1.5× base |
| **Bronze** | 40–59 | Yes | Full attribution with explicit gap disclosure | 1.0× base |
| **Unscored** | data-sufficiency = false | **No — refunded** | No deliverable; email capture for coverage-update notification | n/a |
| **Flagged** | 0–39, or any high-severity Risk override | Yes | Full evidence bundle (§5.1); 14-day appeal window | 1.0× base (paid as Bronze) |
| **Withheld** | Legal-disclosure restriction on Flagged source | **No — refunded** | No automatic deliverable; curator-mediated channel; registry-notification protocol fires | n/a (Premium upsell channel CHF 1K–10K if recipient engages) |

**Multiplier base definition.** "Base" in the multiplier column is the PCS Standard SKU price ($49 USD consumer / CHF 49 equivalent) per SSOT v10 §9 (read here through the v11 SKU enumeration noted in v20 §9.5). PCS Basic ($10) and PCS Dossier ($150) are *separate SKU axes* (depth of report, not confidence) and are tier-independent: a Basic Gold is $10 × 2.0 = $20; a Dossier Gold is $150 (Dossier is a fixed-price deep-report SKU, multiplier does not apply). PCS Premium (CHF 1K–10K) is the curator-mediated channel referenced in §9.5, not a tier multiplier.

Verify revenue routes 60–80% back to the source institution per SSOT v10 §12 moat 3 (Founding 51 permanent 80%). The algorithm emits a `pcs.revenue_share_events` row per scored query with `sourceInstitutionId`, `sharePct`, and the contributing-corpus attribution. See §14.4.

The liability paragraph from v10.1 §6 (LOCKED, unchanged in v20) ships with every tier, including Gold.

### §8.4 Disclosure copy (v20)

| Tier | Disclosure |
|---|---|
| Gold | "Authentication confidence: High. Suitable for secondary-market transaction subject to the buyer's standard diligence and the liability terms below." |
| Silver | "Authentication confidence: Moderate. Verified with documented gaps; transaction-suitable with disclosure of: {gap-summary}." |
| Bronze | "Authentication confidence: Limited. Intelligence with material gaps; recommend physical inspection by qualified specialist." |
| Unscored | "Insufficient data for a confident answer. Full refund processed. We will notify you if coverage of this object class improves." |
| Flagged | "Network finds evidence the claimed identity does not match this object: {finding-summary}. Evidence enclosed. Appeal available within fourteen days." |
| Withheld | "This query has been routed to a curator-mediated channel under the disclosure protocol of the matching registry. Full refund processed. A veradis.ai specialist will contact you within {SLA} hours." |

The Gold copy was tightened in this revision per GC's review note — "without further verification" was directly contradicted by the v10.1 §6 liability paragraph and read as misrepresentation. Replaced with "subject to the buyer's standard diligence and the liability terms below."

### §8.5 What the marketing site renders

The five-tier thumbnail set on `/verify` (Visual Direction v20 §3) renders Gold/Silver/Bronze/Unscored/Flagged at the v20 bands above. The Raymond Weil Don Giovanni sample PCS is rendered at each of the five tiers. **Withheld is a sixth state** not yet in the marketing thumbnail set; it ships post-GC confirmation per v20 §7 — flag for the design team to add at v21 if/when GC approves the framework.

### §8.6 Tier-downgrade rule — removed

The v01 draft contained a `point - lower > 12` downgrade rule. **Removed in this revision.** Tiering by the lower bound of the credible interval already encodes uncertainty; downgrading again on the same uncertainty is a double penalty (per CTO review). Wide-CI cases now surface in the disclosure copy ("{gap-summary}") rather than the tier label.

---

## §9 — Curator QA queue

### §9.1 Trigger conditions

A score path enqueues a curator review when *any* of:

1. Composite point ∈ [50, 60) — boundary cases.
2. `point - lower > 12` — wide CI, enqueue for curator review (no tier downgrade per §8.6; surface wide-CI gap-summary in disclosure copy instead).
3. Any single quadrant raw < 40.
4. `MATERIAL_INCONSISTENCY` flag.
5. `NO_FORENSIC_DATA` flag.
6. Authority resolver returned `DECLARED_ONLY` for any *primary* identity attribute (maker, reference, serial, VIN — by domain).
7. Risk severity = MEDIUM (HIGH triggers Flagged tier and *also* enqueues for human-in-the-loop reporting per §10).
8. Manual flag from any veradis.ai surface (e.g. consignor or curator dispute).

The trigger fires at score time. The score is still returned to the caller, with `tier = (computed)` and `metadata.curatorReviewPending = true`. Re-scoring after curator action is a separate pipeline.

### §9.2 Routing

Queue rows live in `pcs.curator_queue` (Postgres + `pgmq`). Routing is deterministic by domain and severity:

| Domain | Curator pool | On-call escalation |
|---|---|---|
| Horology | Watch-curator pool (D5: 1 internal + 1 contract) | Head of Intelligence |
| Military heritage | Military-curator pool (D5: Brent + Seaforth contract curator) | Head of Intelligence |
| Automotive | Automotive-curator pool (D5: 1 contract specialist) | Head of Intelligence |
| Cross-domain (mixed lots) | Senior curator | Head of Intelligence |

Severity:
- `S0` — Risk HIGH. SLA 1 hour. Page on-call.
- `S1` — Risk MEDIUM, or Material inconsistency. SLA 4 hours.
- `S2` — Boundary score / wide CI / declared-only primary. SLA 24 hours.
- `S3` — Manual review request, no live transaction. SLA 72 hours.

### §9.3 SLA enforcement

Each queue row carries `enqueuedAt`, `slaDueAt`, `tier`, `status`. A scheduled job (`pcs.sla-watchdog`, runs every minute) escalates breached rows:

```pseudocode
function slaWatchdog():
    breached = sql("""
        select * from pcs.curator_queue
        where status = 'pending' and sla_due_at < now()
    """)
    for row in breached:
        if row.severity == 'S0':
            page(row.on_call_escalation, row)
        else:
            email(row.curator_pool_lead, row)
        update(row, status = 'breached', breached_at = now())
        emit_event('curator.sla.breached', row)
```

Breach metrics surface in the weekly intelligence review. We commit publicly to publishing breach rates as part of the standard-setting strategy (v10.1 §7) — a methodology that hides its failure modes is not a standard.

### §9.4 Curator action interface

A curator can: confirm score, override quadrant scores (with required reason code + evidence link), force tier (with reason code), reject as unscoreable, escalate. Every action writes an immutable row to `pcs.curator_actions` with `curatorId`, `curatorCredentials`, and `signatureTs` (per GC review — supports expert-witness chain in litigation). The curator action produces a re-scored `PCSReport` linked to the original via `priorReportId`. Both reports remain queryable.

### §9.5 Withheld routing (v20 §7)

Withheld is the sixth output state introduced by the v20 amendment. It fires when a Flagged finding's primary source is a registry whose disclosure protocol restricts automatic publication to the requester — current candidates: Interpol stolen-works (notification protocol applies in several jurisdictions), ALR once enabled (contractual non-disclosure on certain match types), national patrimony registries in Switzerland/EU/UK/Italy/Greece.

```pseudocode
function hasWithheldDisclosureRestriction(riskFlags, jurisdiction):
    for flag in riskFlags:
        if flag.severity != HIGH: continue
        if flag.source in WITHHELD_SOURCES:
            return true
        if (flag.source, jurisdiction) in WITHHELD_JURISDICTION_PAIRS:
            return true
    return false
```

`WITHHELD_SOURCES` is a curator-maintained list keyed off the registry's published disclosure protocol. `WITHHELD_JURISDICTION_PAIRS` covers situations where the source itself is open but the requester's jurisdiction imposes a reporting duty (e.g. cultural-property reporting in Switzerland under CPTA).

**On Withheld fire:**
1. Customer is refunded automatically via Stripe (`output_state = withheld`).
2. The matched registry is notified per its protocol — Interpol via the partner channel, ALR via contractual route, national patrimony per the jurisdiction's procedure. This is a curator action with an SLA of 24 hours.
3. The requester receives a holding message routing them to the curator-mediated Premium channel (CHF 1K–10K SKU per SSOT v10 §9).
4. The curator-mediated engagement either upgrades to Premium or terminates the request with the appropriate disclosure to the requester (which the curator authors case-by-case, not the algorithm).
5. Every Withheld event writes to `pcs.withheld_events` with full audit trail (registry, hit details, jurisdiction, requester, refund txn, notification timestamps, outcome).

**SLA — Withheld.** Registry notification: 24h hard. Requester routing message: 1h. Curator-mediated engagement first contact: 48h business hours.

**Critical legal posture.** Withheld is the algorithm's mechanism for staying out of jurisdictions where automatic Flagged disclosure could trigger statutory reporting duties on the platform itself, or could prejudice an ongoing investigation. GC confirmation required before the WITHHELD_SOURCES list is populated for production. v01 ships with the routing mechanism live and the list empty pending GC sign-off — i.e. Withheld can never fire at D5 launch, but the architecture is in place.

### §9.6 S0 curator hold on non-sanctions Risk HIGH (false-positive gate)

Required by GC review. The v01 draft routed any Risk HIGH directly to Flagged tier and shipped the Evidence Bundle to the requester without human confirmation. A false-positive Interpol or stolen-property hit published as "DO NOT TRANSACT" into a live transaction is defamation / tortious-interference exposure in every relevant jurisdiction (UK *Hedley Byrne*, CH OR Art. 41, EU). v02 of the spec gates the publication.

```pseudocode
function shipFlaggedReport(report, riskFlags):
    if Tier.WITHHELD == report.tier:
        return executeWithheldRouting(report)        # §9.5

    sanctionsOnly = all(f.source in SANCTIONS_REGISTRIES
                       for f in riskFlags if f.severity == HIGH)

    if not sanctionsOnly and any(f.severity == HIGH for f in riskFlags):
        # S0 60-min curator hold before delivery.
        held = enqueueCuratorHold(report, severity = "S0",
                                  reason = "non_sanctions_risk_hit",
                                  slaMinutes = 60)
        # Customer charge is authorised, not captured, until the hold clears
        # (Stripe auth-on-submit, capture-on-tier-resolve per §14.0 — see below).
        return held.statusUrl

    # Sanctions HIGH or score-band Flagged ships directly.
    deliverReport(report)
```

`SANCTIONS_REGISTRIES` is the curator-maintained allowlist of registries whose disclosure protocols are mandatory and whose false-positive rates are vanishingly low: OFAC SDN, SECO, EU consolidated, UK OFSI, UN sanctions. Curated, government-grade, machine-readable, low false-positive.

Within the 60-minute window the curator either (a) confirms the hit — Flagged Evidence Bundle ships, Stripe captures, audit row written; (b) rejects the hit as false-positive — report re-runs without the override, ships at the resulting tier; (c) escalates to Withheld if the curator determines the source falls under §9.5 disclosure restriction. All three actions write to `pcs.curator_actions` with `curatorId` and `curatorCredentials`.

SLA on the hold: 60 minutes. Breach escalates per §9.3 watchdog to Head of Intelligence on-call.

### §9.7 Stripe auth/capture ordering (deferred from §14)

Stripe charges are authorised on submit (`payment_intent.create` with `capture_method = manual`) and captured on tier resolution. The capture order:

- Gold / Silver / Bronze / Flagged (score-band or sanctions HIGH) — capture immediately on tier resolve.
- Unscored — void the auth; no charge appears on the customer's statement.
- Withheld — void the auth; curator-mediated channel handles billing separately if Premium engages.
- Flagged with non-sanctions HIGH on S0 hold — auth held until curator clears (max 60 min). Captured on curator confirm; voided on curator reject (becomes whatever lower tier applies) or escalate-to-Withheld.

---

## §10 — ALR integration vs cap-with-disclosure

### §10.1 Decision required

The Risk quadrant requires a stolen-works check. Art Loss Register is the obvious primary source. The question: do we ship D5 with an ALR API subscription, or do we ship D5 with a Risk-quadrant cap and disclosure language?

### §10.2 Decision: Cap-with-disclosure for D5 launch. Pursue ALR API for D7 (post-anchor).

**Rationale.**

1. *Commercial.* ALR's published licensing posture for API access is enterprise-tier. Indicative pricing (per their 2025 partner sheet) is GBP 25K–60K annual minimum plus per-query. We do not have signed Verify revenue to underwrite that at D5. Spending pre-seed on an enterprise compliance feed before we have a single paid Verify dossier is the wrong allocation.
2. *Coverage.* Interpol stolen-works (free), FBI Art Crime Team national stolen-art file (free), ICOM Red Lists (free, static), and the public CBP repatriation registry give us baseline coverage for non-fine-art domains — which is *all three* of our D5 domains (horology, military, automotive). ALR's strongest coverage is fine art, which is not in D5 scope.
3. *Honesty register.* "We have not checked ALR" stated explicitly is more credible than a quiet ALR check we cannot afford to repeat. The methodology is published; the gap is published with it.
4. *Path to API.* Anchor close (15 June) plus first auction-house Verify reference (target Q3 2026) are the two events that justify ALR procurement. Build the integration adapter behind a feature flag at D5 so onboarding is a contract signature plus a key rotation, not an engineering project.

### §10.3 D5 implementation: cap-with-disclosure (revised under v20)

```pseudocode
function checkStolen(object):
    hits = []
    hits.extend(InterpolStolenWorksAdapter.check(object))
    hits.extend(FbiArtCrimeAdapter.check(object))
    hits.extend(IcomRedListAdapter.check(object))
    hits.extend(CbpRepatriationAdapter.check(object))
    # ALR adapter exists but is feature-flagged off until licence signed.
    if FeatureFlag.ALR_ENABLED:
        hits.extend(ArtLossRegisterAdapter.check(object))
    return hits

function applyAlrCap(quadrantScore):
    if not FeatureFlag.ALR_ENABLED:
        # Cap Risk QUADRANT at 90 to reflect the unchecked source.
        # The cap propagates a 1.5-point composite penalty (0.15 × 10) which
        # surfaces transparently in the score, the CI, and the disclosure.
        if quadrantScore.raw > 90:
            quadrantScore.raw = 90
            quadrantScore.flags.append(STOLEN_REGISTRY_PARTIAL_COVERAGE)
    return quadrantScore
```

**Tier cap dropped under v20.** The v01 draft also forced Gold→Silver when ALR was unavailable. **Removed in this revision.** Rationale: the v20 commercial model is "deliver the answer the customer paid for, with the evidence." Capping tier above the quadrant penalty is double-counting; the disclosure copy carries the gap; the buyer is informed without the tier being artificially undercut. This also restores the v10.1 §5 canonical AP 5516 worked example to Gold under v01 — methodology paper v1 can publish the AP example consistent with this spec (see §12.1 below).

**Disclosure language (D5, revised under v20 + GC review).** Every report in the `ALR_ENABLED = false` window ships with: *"Stolen-property check covers Interpol, FBI Art Crime Team, ICOM Red Lists, and CBP repatriation registry. Art Loss Register integration scheduled Q3 2026. This report does not discharge the recipient's own diligence obligations under applicable cultural-property, sanctions, or AML law, including any duty to consult the Art Loss Register."*

GC's revision drops "Gold-tier classification suspended" (commercial poison per CRO review) and adds explicit non-reliance language (UK Sale of Goods Act §12 and Swiss CPTA exposure per GC review).

### §10.4 ALR adapter spec (built D5, dormant)

```pseudocode
class ArtLossRegisterAdapter implements RiskAdapter:
    endpoint    = "https://api.theartlossregister.com/v2"
    authMethod  = HMAC_SHA256
    rateLimit   = 60_per_minute        # contractual
    timeout     = 4s
    circuitBreaker = standard

    check(object):
        payload = {
            "claimedTitle":  object.identity.title,
            "claimedMaker":  object.identity.maker.canonicalId,
            "claimedDate":   object.identity.productionDate,
            "physicalDesc":  object.physicalDescription,
            "imageHashes":   object.imageHashes,        # perceptual hashes
            "queryRef":      pcs_query_ref(object)
        }
        response = sign_and_post(self.endpoint + "/lookup", payload)
        return [parseHit(h) for h in response.hits]
```

Image hashing uses pHash + dHash, cached on the object. ALR matches on title + maker + image; image hashing must be deterministic and stable across re-ingest.

---

## §11 — Watch corpus ingestion (D5 launch scope)

### §11.1 Goal

Ship D5 with two ingested watch corpora: Rolex and Omega. The corpora replace the missing public archive APIs and become the authority sources for `maker`, `reference`, `serial-range`, `calibre`, and `production-year` on watches.

### §11.2 Rolex corpus

No public API; no licensed feed. Source mix:

| Source | Type | Confidence | Volume target |
|---|---|---|---|
| Rolex Vintage Yearbook 2020–2025 | Published reference | 0.95 | ~800 references |
| Bonhams / Christie's / Phillips / Sotheby's auction archives 2010–2025 | Lot records | 0.85 | ~25K lots |
| RolexForums + Vintage Rolex Forum (curated threads only) | Community | 0.50 | ~5K serial windows |
| Existing dealer catalogues (Hodinkee Shop, Watch Box, A Collected Man) | Commercial | 0.75 | ~3K objects |

Ingestion pipeline:

```pseudocode
class WatchCorpusIngest:
    def ingest_source(source: SourceManifest):
        raw = fetch(source)                       # http or filesystem
        normalised = normalise(raw, source.schema)
        for record in normalised:
            obj = WatchCorpusObject(
                domain     = "horology",
                maker      = "rolex",
                reference  = record.reference,
                serial     = record.serial,
                calibre    = record.calibre,
                year       = record.year,
                source     = source.id,
                evidenceUri= record.evidenceUri,
                confidence = source.confidence)
            upsert(corpus_horology, obj, conflict = "merge_higher_confidence")
        emit_event("corpus.ingested", source.id, count = len(normalised))
```

Conflict policy: when two sources disagree on a `(reference, serial)` mapping, the higher-confidence source wins for the canonical record; the lower-confidence source is retained as `alternateClaim`. Curator action may overwrite either.

### §11.3 Omega corpus

Omega has the Omega Vintage Database (OVD) and the formal "Extract from the Archives" service. Both are partner-friendly but not public-API:

| Source | Type | Confidence | Volume target |
|---|---|---|---|
| Omega Vintage Database (web) | Manufacturer archive | 0.95 | ~12K reference rows |
| Extract from the Archives (per-object) | Manufacturer attestation | 1.00 | on-demand, per Verify query |
| Auction archives (as Rolex above) | Lot records | 0.85 | ~15K lots |
| Antiquorum archive | Specialist | 0.90 | ~8K lots |

OVD ingest is a quarterly delta job (web extract + diff). Extract-from-the-Archives is a per-object call for Gold-tier-candidate Omegas — the Extract becomes an authority artifact attached to the PCSReport audit trail. This is the only authority source with `confidence = 1.0`.

### §11.4 Authority lookup contract

Once ingested, the corpus exposes the same `AuthorityAdapter` interface as ULAN/VIAF/Wikidata, ranked at position 4 (manufacturer archive) in §6.1. A Rolex 5513 reference lookup that hits the corpus with `confidence ≥ 0.85` returns `AUTHORITY_RESOLVED`; a hit at `0.50` returns `DECLARED_ONLY` (community-only attestation does not authority-resolve).

### §11.5 Refresh cadence

Rolex corpus: monthly delta until D7, quarterly thereafter.
Omega corpus: quarterly OVD delta; per-object Extract on demand.
Auction archives: continuous ingest as auction houses publish results (1–4 days post-sale).

---

## §12 — Test cases

Each test case is a worked example showing input, quadrant computation, posterior, composite, tier, and disclosure. These are the regression cases for the v01 build. Three are pulled from real demo objects; two are constructed.

**Errata (13 Jul 2026, HoI-ratified — see `20260713_INT_BRIEF_PCS-CI-Neff-ScenarioB-Ratification_v01.md`).** The composite CI values below are generated by the canonical NumPy reference (`tools/reference/pcs_reference.py`, scenario B: count-based n_eff) and pinned in `tests/golden/pcs-golden-v21.json`; they supersede the hand-authored values this section previously carried, which were not reproducible from the §7 procedure. **Reproducibility contract:** CI bounds are reported, compared, and hashed at 2 dp, round-half-even on the exact value; the tier maps on the rounded lower bound. Cross-implementation parity is defined AT this precision — bit-identical transcendental libraries across platforms are explicitly not required (sub-2dp drift of ~1 ulp exists between platform libms and is out of contract scope). The per-quadrant "Posterior 95% CI" table columns remain illustrative — the binding posterior parameters are in the golden file.

### §12.1 — Audemars Piguet Royal Oak 5516, 1972 (canonical, from v10.1 §5)

**Domain:** horology. **Object:** AP Royal Oak ref. 5516, serial 102.345, calibre 2120.

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Maker (AP archive ✓), reference (production ledger ✓), serial (cross-ref ✓), calibre (matched ✓), case-mat (✓), dial (✓), hallmarks (✓) | 96 | [92, 98] |
| Custody | 1972 delivery (Golay Fils ✓), 1974–2019 private (insurance windows ✓), 2019 Christie's lot ✓, current consignment ✓; 17-year window covered by appraisals | 91 | [86, 95] |
| Material | Case micro-engraving ✓, bracelet tooling ✓, no replacement ✓, movement-case serial concordance ✓; 1 missing forensic check (lume isotope, irrelevant pre-1970 calibre 2120) | 95 | [90, 98] |
| Risk | No flags; ALR cap applies under §10 | 90 (capped) | [88, 100] |

Composite (point): `0.30 × 96 + 0.30 × 91 + 0.25 × 95 + 0.15 × 90` = `28.8 + 27.3 + 23.75 + 13.5` = **93.35**
Composite CI (Monte Carlo, 10K draws, pinned seed): **[86.75, 96.06]**
Tier under v20 bands: lower bound 86.75 ≥ 80 → **Gold** (no tier cap; §10 quadrant cap on Risk applies — Risk = 90 already reflects the 1.5-point composite penalty).
Disclosure: Gold + revised ALR coverage paragraph per §10.

**Note vs v10.1 §5.** v10.1 worked example reads PCS 94.85 (rounded to 94) / Gold with Risk = 100. v01 (initial draft) capped tier to Silver via the tier cap. v01 (this revision, under v20 bands + dropped tier cap) restores Gold at PCS 93.35 — the 1.5-point composite delta vs v10.1's 94.85 is exactly the 0.15 weight × 10-point ALR Risk-quadrant cap. Methodology paper v1 publishes the v20 worked example.

### §12.2 — Omega Speedmaster Professional 145.022, 1969

**Domain:** horology. **Object:** Speedmaster ref. 145.022-69, serial 30.214.567, calibre 861.

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Maker (OVD ✓), reference (OVD ✓), serial-year (OVD year-band 1969 ✓), calibre (✓), case-mat (✓), dial (config 145.022-69 step-dial ✓), hallmarks (Swiss assay ✓) | 98 | [95, 99] |
| Custody | 1969 delivery (Swiss retailer, OVD partial), 1969–1992 private (no records, 23-year gap), 1992 estate sale (✓), 1992–2022 collector (insurance ✓), 2022 Phillips lot (✓) | 64 | [55, 73] |
| Material | Case marks ✓, dial step ✓, hands period-correct ✓, movement serial concordant ✓, lume tritium consistent with 1969 ✓ | 92 | [86, 96] |
| Risk | No flags. ALR cap applies. | 90 | [88, 100] |

Composite (point): `0.30 × 98 + 0.30 × 64 + 0.25 × 92 + 0.15 × 90` = **85.1**
Composite CI: **[78.29, 89.01]**
Tier under v20 bands: lower bound 78.29 → **Silver** (60–79 band).
Disclosure: Silver + custody-gap disclosure ("23-year unrecorded private holding 1969–1992") + revised ALR coverage paragraph.

This case is the canonical demo for "honesty register": strong identity + strong material, but a real custody gap, surfaced not hidden.

### §12.3 — Lee-Enfield No. 4 Mk 1, 1944, Long Branch arsenal, Seaforth Highlanders armoury

**Domain:** military heritage. **Object:** Lee-Enfield No. 4 Mk 1, serial 4L-12.789, Long Branch 1944, broad-arrow stamped, Seaforth Highlanders regimental issue mark.

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Maker Long Branch ✓ (Wikidata + manufacturer record), model No. 4 Mk 1 ✓, serial ✓, regiment-issue (Seaforth armoury record ✓), period-marks ✓, broad-arrow ✓ | 97 | [93, 99] |
| Custody | 1944 manufacture (Long Branch records ✓), 1944–1968 Seaforth armoury (regimental log ✓), 1968 demilitarised + presented to Foundation (deed ✓), 1968–present Seaforth Foundation collection (continuous ✓) | 96 | [91, 98] |
| Material | Broad-arrow stamp pattern ✓, fastener metallurgy ✓, regimental engraving ✓, finish layer chronology ✓, serial-die match ✓ | 94 | [88, 97] |
| Risk | No flags. Cultural patrimony review: not applicable (Canadian-manufactured, Canadian-held, demilitarised). | 100 | [97, 100] |

Composite (point): `0.30 × 97 + 0.30 × 96 + 0.25 × 94 + 0.15 × 100` = **96.4**
Composite CI: **[87.28, 97.84]**
Tier under v20 bands: lower bound 87.28 → **Gold** (ALR cap does not apply for military — military is not in ALR scope; Risk is not capped for this domain).
Disclosure: Gold (canonical).

This is the cleanest demo case across all three D5 domains. It is a real paying-customer object (Seaforth Foundation). Tier stable under v10.1 and v20 bands.

### §12.4 — Porsche 911 2.7 Carrera RS, 1973, M471 Lightweight

**Domain:** automotive. **Object:** 911 Carrera RS 2.7, VIN 9113600.823, M471 Lightweight spec, original ducktail.

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Manufacturer Porsche ✓, VIN (factory build sheet ✓), chassis (✓), engine-number (build-sheet ✓), body-number (✓), build-spec M471 (✓) | 95 | [88, 98] |
| Custody | 1973 delivery Stuttgart, 1973–1988 first owner (service records ✓), 1988–2003 second owner (partial — service records sparse), 2003 RM Sotheby's lot ✓, 2003–2024 third owner (concours records ✓), 2024 consignment ✓ | 78 | [69, 86] |
| Material | VIN-plate metallurgy ✓, chassis stamping ✓, engine block casting ✓, paint chemistry — single repaint detected on rear quarters (AMBIGUOUS, not INCONSISTENT — repaint is age-consistent but reduces originality) | 73 | [62, 83] |
| Risk | No flags. ALR cap does not apply (automotive out of ALR scope). | 100 | [97, 100] |

Composite (point): `0.30 × 95 + 0.30 × 78 + 0.25 × 73 + 0.15 × 100` = **85.1**
Composite CI: **[71.04, 90.46]**
Tier under v20 bands: lower bound 71.04 → **Silver** (60–79 band).
Disclosure: Silver + Custody-gap disclosure (1988–2003 service-record gap) + Material-ambiguity disclosure (rear-quarter repaint, age-consistent, originality reduced).

### §12.5 — Constructed: Rolex Submariner 5513, 1968, with period-replacement bracelet

**Domain:** horology. **Object:** Submariner ref. 5513, serial 1.987.654, calibre 1520. Original 9315/80 bracelet replaced with later 7836.

**Revised under curator review.** Original draft scored the 7836 bracelet on a 5513 as `INCONSISTENT` (zero credit). Curator review flagged that the vast majority of vintage Submariners on the open market carry non-original bracelets; treating that as material inconsistency misclassifies the vintage Rolex market. Spec adds an `EXPECTED_PERIOD_REPLACEMENT` credit class — period-correct service replacement of bracelet, crown, crystal, or service hands earns 0.7 credit with disclosure (vs 0.0 for genuine Frankenwatch indicators: redial, swapped movement, recase).

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Maker (Rolex corpus ✓), reference 5513 (corpus ✓), serial-year-band 1968 (corpus ✓), calibre 1520 (corpus ✓), case-mat ✓, dial (matt-no-date ✓), hallmarks ✓ | 94 | [90, 97] |
| Custody | 1968 delivery (no record), 1968–1995 private (no record), 1995 Christie's lot (✓), 1995–2018 collector (insurance ✓), 2018 Phillips lot (✓), 2018–present (✓). 27-year unrecorded period at start. | 58 | [48, 67] |
| Material | Case marks ✓, dial print microscopy ✓, hands ✓, **bracelet EXPECTED_PERIOD_REPLACEMENT** (7836 is a service-era Rolex bracelet, period-correct for a 1968 case under service — 0.7 credit with disclosure), movement-case serial concordant ✓ | 85 | [78, 91] |
| Risk | No flags. ALR quadrant cap applies. | 90 | [88, 100] |

Composite (point): `0.30 × 94 + 0.30 × 58 + 0.25 × 85 + 0.15 × 90` = **80.35**
Composite CI: **[73.36, 84.69]**
Tier under v20 bands: lower bound 73.36 → **Silver** (60–79 band).
Curator queue: enqueued (S2) — custody gap (27 years) plus period-replacement disclosure exercise.
Disclosure: Silver + Custody-gap disclosure ("27-year unrecorded ownership 1968–1995") + Material disclosure ("period-correct service-replacement bracelet (7836); originality reduced") + revised ALR coverage paragraph.

This is the canonical demo for "intelligence with documented gaps." Under v10.1 bands + original (incorrect) bracelet treatment, this case landed Bronze 77 / [68, 84] — methodologically wrong (per curator review) and commercially punishing for a routine vintage object. v01 under v20 + period-replacement class lands the case where the secondary market actually transacts it: Silver with disclosed gaps.

### §12.6 — Constructed: Tudor Submariner 7928, ca. 1962, mixed-condition example (Bronze)

**Domain:** horology. **Object:** Tudor Submariner ref. 7928, no serial visible, undocumented dial transition example.

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Maker (Rolex corpus — Tudor cross-ref ✓), reference 7928 (corpus ✓), **serial unreadable** (case-back worn), calibre (best-effort match 390 ✓), case-mat ✓, dial (transition gilt/glossy — period boundary, DECLARED), hallmarks (illegible) | 58 | [48, 67] |
| Custody | No delivery record, no first-owner record, 1985 dealer sale (✓ — partial receipt), 1985–2010 collector (insurance ✓), 2010–present (✓). Two large unrecorded windows. | 51 | [40, 61] |
| Material | Case marks ✓, dial print ambiguous, hands service-replacement (`EXPECTED_PERIOD_REPLACEMENT` 0.7), bezel pearl missing (not scored — cosmetic), crown EXPECTED_PERIOD_REPLACEMENT 0.7, no movement-serial check (caseback not opened) | 65 | [52, 77] |
| Risk | No flags. ALR quadrant cap applies. | 90 | [88, 100] |

Composite (point): `0.30 × 58 + 0.30 × 51 + 0.25 × 65 + 0.15 × 90` = 17.4 + 15.3 + 16.25 + 13.5 = **62.45**
Composite CI: **[53.98, 69.10]**
Tier under v20 bands: lower bound 53.98 → **Bronze** (40–59 band — note: point 62.45 is in the Silver band, but lower-bound tiering keeps it Bronze; the gap surfaces in disclosure).
Curator queue: enqueued (S2) — Identity quadrant <60 plus serial illegibility plus wide CI.
Disclosure: Bronze (limited confidence) + Identity disclosure ("serial unreadable; reference confirmed; calibre and dial period-correct on best-effort basis") + Custody disclosure ("first-owner record absent; documented chain from 1985") + Material disclosure ("hands and crown period-correct replacements; movement integrity not verified") + revised ALR coverage paragraph.

This is the canonical Bronze demo. The shape — sparse Identity, gappy Custody, partial Material, clean Risk — is the routine "trade-show pickup" object the secondary market sees constantly. Bronze with disclosure is the right tier and the right product.

### §12.7 — Constructed: "Rolex Daytona" 6263 with cast case + recased movement (Flagged COUNTERFEIT)

**Domain:** horology. **Object:** Claimed Rolex Cosmograph Daytona ref. 6263, serial purportedly 4.123.456, claimed calibre 727.

| Quadrant | Inputs | Raw | Posterior 95% CI |
|---|---|---|---|
| Identity | Maker (corpus claim ✓ — sample submitted), reference 6263 (corpus has ref ✓), serial-year-band check (FAIL — claimed 4.xxx serial maps to 1976 production, but 6263 production ran 1971–1988; serial overlaps several valid windows — INCONCLUSIVE), calibre (declared 727 — case opened in inspection, movement is a 7750 ETA chronograph caliber — **INCONSISTENT**) | 28 | [18, 38] |
| Custody | No delivery record, no period documentation, single 2024 marketplace listing (✓), claimant statement (DECLARED) | 22 | [12, 32] |
| Material | Case casting marks present (CNC-machined cast aluminum, not the period-correct cold-forged stainless — **INCONSISTENT**), dial print mismatch with corpus reference plate (**INCONSISTENT**), hands (**INCONSISTENT** — pre-1976 hand style on claimed 1976 watch), movement-case serial concordance (**INCONSISTENT** — movement is wrong calibre family), bracelet **INCONSISTENT** (modern replacement, not period-correct service replacement) | 0 | [0, 8] |
| Risk | No registry hit (object is counterfeit, not stolen). ALR quadrant cap applies. | 90 | [88, 100] |

Composite (point): `0.30 × 28 + 0.30 × 22 + 0.25 × 0 + 0.15 × 90` = 8.4 + 6.6 + 0 + 13.5 = **28.5**
Composite CI: **[21.80, 36.54]**
Tier under v20 bands: lower bound 21.80 < 40 → **Flagged**. Finding: `COUNTERFEIT` (multiple inconsistencies across Identity, Material, with the movement-calibre mismatch as primary).

**FlaggedEvidenceBundle:**
- `finding`: COUNTERFEIT
- `primarySources`: Rolex corpus reference 6263 production specification (calibre 727 only, never 7750); Rolex corpus case-construction specification (cold-forged stainless, never cast aluminum)
- `supportingChecks`: movement-calibre mismatch (Material check ID `MOV-CAL-CONCORD`), dial-print mismatch (`DIAL-PRINT-MICRO`), hands-period mismatch (`HANDS-PERIOD`), case-construction mismatch (`CASE-CONSTRUCT`)
- `contradictions`: claimed calibre 727 vs observed 7750; claimed cold-forged case vs observed cast; claimed period vs observed hand style
- `appealWindow`: 14 days
- `curatorContact`: appeals@veradis.ai with `reportId` in subject

Customer is **charged** (PCS Standard $49, paid as Bronze multiplier 1.0× per §8.3). Report delivered with the full evidence bundle. 14-day appeal window. Appeal review by horology curator within 5 business days; if upheld, refund delta and re-scored report.

Disclosure (verbatim from §8.4 Flagged template):

> "Network finds evidence the claimed identity does not match this object: counterfeit. Movement calibre observed (ETA 7750) does not match reference 6263 specification (Rolex calibre 727 only). Case construction observed (cast aluminum) does not match reference 6263 specification (cold-forged stainless). Multiple period-mismatch indicators (hands, dial-print, bracelet). Evidence enclosed. Appeal available within fourteen days."

Plus the §6 liability paragraph (LOCKED).

This is the canonical Flagged demo. The shape is unambiguous: Material at 0 across primary checks, Identity dropping to 28 because the serial-year-band check fails closed-form. Risk clean (the object is fake, not stolen). The Evidence Bundle reads as evidence, not as legal determination — that's the §6 framing and the right register for the marketing thumbnail.

---

## §13 — Build plan, milestones, open items

### §13.1 D-day milestones (W3 sprint)

| Day | Deliverable | Owner |
|---|---|---|
| D1 (Mon) | Schema migrations: `domain_profiles`, `authority_sources`, `pcs.curator_queue`, `corpus_horology` | Eng |
| D2 (Tue) | Adapter scaffolding: ULAN, VIAF, Wikidata, OVD, Rolex corpus, OFAC, Interpol | Eng |
| D3 (Wed) | **Spec lock — this document v01 → v02 with eng comments** | Head of Intelligence |
| D4 (Thu) | Scoring orchestrator end-to-end on §12.3 (Lee-Enfield) test case | Eng |
| D5 (Fri) | All 5 test cases green; spec → LOCKED; methodology paper v1 internal review | Head of Intelligence |
| D6–D7 | Curator queue + SLA watchdog, disclosure copy review with GC | Eng + GC |

### §13.2 Open items (resolved by D5 or carried to v02)

1. *Empirical priors.* Beta priors per domain are Jeffreys (0.5, 0.5) at v01 launch. Replace with Seaforth-turn-study posterior at v02 (Q3 2026). Carried.
2. *Domain expansion.* Fine art and wine domains not in v01 scope. Roadmap item v03.
3. *Per-object Extract from the Archives.* Manual workflow at D5 (curator-initiated). Productise post-Omega partner contract. Carried.
4. *ALR contract.* Procurement starts D7 (post-anchor). Adapter shipped dormant in v01. Quadrant cap still applies until ALR_ENABLED flips. Tier cap dropped per v20 commercial model. Carried.
5. *Image-hash determinism.* pHash + dHash across re-ingest must produce stable hashes. Test at D4. Resolved by D5.
6. *Risk severity matrix.* Encoded in §5 pseudocode but the per-flag deductions need empirical calibration once we have first 50 Verify transactions. Carried.
7. *Tier-downgrade threshold.* Removed in this revision (double-penalty per CTO review). Wide-CI disclosure-copy treatment supersedes. Resolved.
8. *Cross-domain mixed lots.* Routing rule in §9.2 is a placeholder. Spec a proper composite-domain handler in v02.
9. *Withheld framework — GC confirmation.* §5.1 + §9.5 ship the architecture; `WITHHELD_SOURCES` list empty pending GC sign-off. Required before any Withheld can fire in production. Custodian (HoI) coordinates with GC and Vaud advisor per v20 amendment §7. Carried.
10. *Flagged Evidence Bundle GC review.* §5.1 ships the bundle structure. Disclosure copy on the bundle (per-finding) reviewed by GC before D5 lock. Required.
11. *Marketing-site five-tier thumbnail rendering.* Heritage Intelligence delivers Raymond Weil Don Giovanni at all five tiers by D3 Tuesday per Visual Direction v20 §3 /verify. Resolved at D3 delivery.
12. *AP 5516 worked example.* v10.1 §5 reads PCS 94 / Gold; v01 (this revision) reads 93.35 / Gold under v20 bands + dropped tier cap. Methodology paper v1 can publish AP 5516 consistent with v01 (composite 93.35, CI [86.75, 96.06] per the 13 Jul 2026 errata, Gold per §12.1 + Methodology v21 §5). Resolved.
13. *EU AI Act Article 10 data-governance memo.* Per GC review — required for any EU institutional sale. D7 carried.
14. *Mandatory vs conditional forensic checks per domain.* Per curator review (§4 missing-check policy needs the split). Carried to v02 — interim D5 ships with current asymmetry; mandatory list authored alongside Seaforth turn study.
15. *Bracelet/crown/service-replacement taxonomy.* `EXPECTED_PERIOD_REPLACEMENT` credit class added in §12.5 revision. Per-domain inventory list authored before D5 — owner: HoI.

### §13.3 Acceptance criteria for v20 lock (D5)

- All five test cases in §12 produce the specified composite, CI, tier, and disclosure under the reference implementation.
- Curator queue triggers correctly on §9.1 conditions for §12.5 test case (S2 enqueue with material-inconsistency reason).
- Authority resolver round-trip for ULAN, VIAF, Wikidata, Rolex corpus, Omega corpus measured P95 < 1.5s.
- ALR feature flag toggled on/off changes Risk cap and tier classification consistent with §10.
- Disclosure copy reviewed by GC.

### §13.4 What this document is *not*

It is not a redesign of v10.1 or v20. The 30/30/25/15 weights, the v20 tier bands (80/60/40/Flagged-0–39), the Flagged-as-paid-deliverable model, the Withheld escalation route, and the v10.1 §6 liability paragraph are all LOCKED. Any change requires a new versioned PCS Methodology Brief. If during D3–D5 implementation an engineer believes a weight or threshold is wrong, the answer is: ship v01, log the empirical evidence, propose recalibration through a versioned brief.

---

## §14 — Refund automation and Stripe integration

The v20 commercial model collapses the v10.1 refund triggers from `output_state IN (unscored, flagged)` to `output_state IN (unscored, withheld)`. Flagged is paid; the customer paid to find out, the network found out, the answer ships with evidence.

### §14.1 Stripe trigger logic

```pseudocode
function onPCSReportFinalised(report):
    state = report.tier  # one of GOLD, SILVER, BRONZE, UNSCORED, FLAGGED, WITHHELD

    case state:
        when GOLD, SILVER, BRONZE, FLAGGED:
            # Charge stands. Report delivered. No Stripe action.
            stripe.confirmCharge(report.chargeId)
            deliver(report)

        when UNSCORED:
            stripe.refund(report.chargeId, reason = "unscored_insufficient_data")
            captureEmailForCoverageUpdate(report.requesterEmail, report.objectClass)
            sendUnscoredNotice(report.requesterEmail)

        when WITHHELD:
            stripe.refund(report.chargeId, reason = "withheld_legal_restriction")
            notifyRegistry(report.withheldEvent)  # per §9.5
            sendWithheldRoutingMessage(report.requesterEmail, report.curatorChannel)
            enqueueCuratorMediatedEngagement(report)
```

### §14.2 Refund-policy footer copy (across surfaces)

The same single-paragraph refund copy ships verbatim on the PCS PDF footer, the Stripe checkout disclosure, the /verify pull-quote on the marketing site, and the PCS ToS §3. Marketing copy v20 §verify carries the canonical wording:

> *We will not sell you an inconclusive answer.*
>
> If the report comes back **Unscored** — we have insufficient data to give you a confident answer — it is free. Full refund. No questions.
>
> A **Flagged** report is not a refund event. If our network finds evidence the object is counterfeit, stolen, or inconsistent with the manufacturer's record, that is the answer you paid for. We will deliver it with sources, and you will keep it.

Withheld is not surfaced on the marketing copy because the marketing v20 set is locked at five tiers. The Withheld disclosure copy lives in the PCS ToS §3 once GC confirms the framework.

### §14.3 Appeal rights

Every Flagged report ships with a 14-day appeal window (PCS ToS §8 once executed; LEG App. 1 §5). Appeal mechanics:

- Requester emails `appeals@veradis.ai` with the report ID and the basis for appeal.
- Curator-mediated review reopens the score against fresh evidence within 5 business days.
- A successful appeal produces a new PCSReport linked to the original via `priorReportId`, supersedes the Flagged finding, and writes to `pcs.appeals` (audit-grade).
- An unsuccessful appeal writes the same audit row with the curator's written rationale.

The appeal mechanism is the right tool for false-positive risk; the refund mechanism is not (per v20 amendment §8 GC note).

**Article 22 GDPR posture (W2 deliverable per LEG App. 1 §5).** The Flagged appeal channel is the human-review mechanism for the algorithmic decision under Article 22 GDPR. The appeal copy on the marketing site, the Flagged Evidence Bundle, and the PCS ToS §8 will be repositioned to make this Article 22 framing explicit. v01 ships the mechanism; the GDPR-specific copy lands in W2 alongside the ToS execution.

### §14.3a EU 14-day withdrawal disapplication (per LEG App. 1 §10)

Stripe checkout for EU/UK consumers ships with two mandatory unticked checkboxes, both required to advance to payment:

```
☐ I want to receive my PCS report immediately on payment.
☐ I understand I lose my right of withdrawal once the report is generated.
```

Both ticks write to `payment_intent.metadata` as `eu_withdrawal_disapplication: "ack"` plus a UTC ISO-8601 timestamp. The post-payment Stripe receipt and the delivered PCS PDF both repeat the acknowledgement language as durable-medium confirmation per Directive 2011/83/EU. EU dispute dossiers cite the metadata. UK consumers covered under post-Brexit equivalents. Swiss consumers fall outside the withdrawal regime; the checkboxes still ship for uniformity and audit clarity.

Implementation lives in the `apps/verify` checkout flow; the two `metadata` fields are required by the Stripe webhook receiver under `apps/verify/api/v1/*` before capture.

### §14.3b Discretionary refund channel (per LEG App. 1 §11)

A separate refund path exists for customer-service complaints that are neither Unscored nor Withheld nor Flagged-appeal cases. Channel: `support@veradis.ai`. SLA: 2 business days first response; 5 business days GC review for refunds > USD 100.

```pseudocode
function processDiscretionaryRefund(report, complaint, officer):
    if report.tier == FLAGGED:
        return reject(reason = "flagged_uses_appeal_channel_not_support")
    if complaint.amount <= 500:
        authority = officer  # founder until headcount
    elif complaint.amount <= 2000:
        authority = "gc"
    else:
        authority = "founder_plus_gc"
    refund = stripe.refund(report.chargeId, reason = "discretionary_factual_error")
    emit "pcs.discretionary_refund_events" with {
        reportId, complaintText, officerNote, gcReviewNote,
        authorityLevel = authority, amount = refund.amount, stripeRefundId = refund.id }
    return refund
```

**Hard rule (from LEG App. 1 §11).** Discretionary refunds are **not** available for Flagged findings. Flagged customers must use the 14-day appeal channel (§14.3). The reason: refunding Flagged via support undoes the v20 §9 commercial-model principle and creates a perverse refund-to-bypass-evidence pattern. Monthly review against Flagged appeal volume detects channel-gaming.

### §14.3c Stripe dispute / chargeback response (per LEG App. 1 §3, §4)

When Stripe notifies a dispute, the curator queue receives an `S1` task carrying the Stripe `dispute_id`, the `PCSReport`, and the Stripe reason code. GC reviews within 4 business hours (internal target 24h response submission; issuer deadline 7–21d is the contractual deadline). The response posture matrix lives in LEG App. 1 §3 and is consumed read-only by the orchestrator:

- `product_not_received` → contest with `pcs.score_events` delivery audit
- `product_unacceptable` → contest with §6 paragraph + tier disclosure + Evidence Bundle (Flagged) or gap-disclosure (Bronze)
- `fraudulent` → contest with Stripe Radar signals + IP/device fingerprint + report-access logs
- `credit_not_processed` for Unscored/Withheld → accept-and-concede + flag `dup-recovery-attempt` in Attio (3 flags in 12 months blocks the email)
- `general` → contest by default; GC case-by-case

Dossier-assembly automation lives in the curator queue; GC sign-off before submission. See LEG App. 1 §4 for the dossier checklist.

### §14.3d Entity-transition cohort split (per LEG App. 1 §6, App. 3 §7)

On SARL formation (Vaud, July 2026): new transactions originate against SARL, with Vaud/Swiss law + Lausanne forum. **In-flight transactions complete under the BC INC. counterparty** with BC law + Vancouver forum. No unilateral novation. The Stripe account, the Verify ToS, and the NDA terms all follow the cohort-split rule. A `/verify` site notice two weeks before flip-over puts new customers on actual notice of the SARL counterparty.

Engineering implication: the Stripe webhook receiver routes refund/capture/void against the correct entity for the in-flight transaction by reading the originating entity from `payment_intent.metadata.counterparty_entity` (BC_INC vs SARL). Set at checkout; immutable for the transaction lifecycle.

### §14.3e Data residency (per LEG App. 1 §12, App. 3 §13)

EU/Swiss-origin Verify traffic processes in Supabase `eu-central-1` (Frankfurt). Geo-route by Stripe billing-country at checkout: EU/UK/CH → Frankfurt instance; ROW → primary instance. If Frankfurt provisioning is not feasible by D5, geo-fence EU/UK/CH off `/verify` at checkout until residency is correct. SCCs (EU 2021 modular, module two) on file with Supabase and every US-hosted sub-processor. DPA tracker owned by GC.

### §14.4 Revenue share to source institutions (SSOT moat 3)

Every paid PCS query emits one `pcs.revenue_share_events` row per contributing institution, with the revenue allocation per SSOT v10 §9 (60–80% back to institutions; Founding 51 permanent 80%).

```pseudocode
function emitRevenueShare(report, charge):
    contributors = identifyContributingInstitutions(report)
    # An institution contributes when one or more authority resolutions or
    # corpus records bearing its sourceId materially affected a quadrant score.
    for inst in contributors:
        sharePct = institutionSharePercent(inst)  # 80% Founding 51; 60–80% otherwise
        emit "pcs.revenue_share_events" with {
            reportId, chargeId, institutionId = inst.id,
            sharePct, allocationAmount = charge.amount * sharePct * inst.weight,
            contributionWeight = inst.weight,        # sums to 1.0 across contributors
            currency, scoredAt }
```

Payout reconciliation runs monthly via Stripe Connect (institutional connected accounts) and writes to `pcs.payouts`. The revenue-share commitment is a contractual term per Enrich SOW Annex B, not a marketing claim.

---

## §15 — Marketing site alignment (Visual Direction v20)

The marketing site copy v20 and visual direction v20 are LOCKED. This algorithm spec ships the implementation that the marketing site renders. Three alignment points worth flagging explicitly:

1. **Five-tier thumbnail set on `/verify`.** Visual Direction v20 §3 /verify specifies the Raymond Weil Don Giovanni sample PCS rendered at Gold / Silver / Bronze / Unscored / Flagged. v01 of this spec lands those five states at the v20 bands above. Heritage Intelligence delivers the five renderings by D3 Tuesday (per visual brief production schedule).

2. **Withheld is a sixth state, not in the marketing thumbnails.** v20 §7 proposes Withheld pending GC confirmation. If GC confirms, the marketing site moves to a six-thumbnail set in a v21 visual brief revision. v01 of this algorithm spec ships the Withheld routing live but with the `WITHHELD_SOURCES` list empty — Withheld cannot fire at D5 launch. This is a deliberate choice to keep marketing and product in sync until GC unblocks.

3. **Refund pull-quote alignment.** The /verify refund pull-quote ("We will not sell you an inconclusive answer") is the customer-facing version of §14.2. The algorithm enforces it: the only score-related refund trigger is Unscored. Flagged is paid. Withheld is refunded for a different reason (legal restriction), not score insufficiency, and routes elsewhere.

4. **Sample-PCS production owner.** Heritage Intelligence (Brent, until the team is hired post-anchor) owns the five Raymond Weil Don Giovanni renders, per Visual Direction v20 §3 /verify and §7 production schedule, delivery D3 Tuesday. The renders read against this spec — if the spec changes between D3 and D5 lock, the renders refresh.

---

*End. PCS Algorithm Specification v21 LOCKED · supersedes v20 · closes audit RED flags R1, R9 + R3 follow-up (apps-tree rename per Reconciliation Report §3.1 disposition (a)) · founder-signed production lock at D5 (Fri 15 May 2026). Companion to PCS Methodology Brief v21, PCS Build Plan v21, Marketing Copy v21, and the Verify Legal Appendices v20.*
