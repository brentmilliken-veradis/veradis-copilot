// Provenance-description scoring (custody). The owner's free-text description
// (accounts objects.notes → declaredAttributes.notes) was collected but never
// scored. A described, corroborated ownership history IS custody documentation,
// so it should lift the Custody quadrant — a well-described single-owner, sealed,
// papered object earns a higher, more credible tier than a bare one.
//
// HONESTY (this is a CLAIM, not proof): recognised signals raise custody
// COVERAGE + document quality (the point estimate), but the credit is CAPPED so
// prose alone can never reach the top — Gold still needs corroboration (Tier-1,
// graph links, real papers). Only documented-EVIDENCE signals (receipt,
// certificate, a named ownership chain) add an n_eff trial that tightens the CI;
// narrative-only signals shift the estimate up while the interval stays honestly
// wide. Extraction is DETERMINISTIC (regex) so the score stays reproducible — the
// LLM never touches it.

export interface ProvenanceSignal {
  key: string;
  label: string;
  coverage: number;
  quality: number;
  /** An evidence signal counts as a custody trial (tightens the CI); a
   *  narrative-only signal only shifts the estimate. */
  evidence: boolean;
}

const SIGNALS: { key: string; label: string; pattern: RegExp; coverage: number; quality: number; evidence: boolean }[] = [
  { key: "single_owner", label: "Single / original owner", pattern: /\b(single|one|sole|original|first)[- ]?owner|owned from new|from new\b/i, coverage: 0.10, quality: 0.03, evidence: false },
  { key: "original_packaging", label: "Original packaging", pattern: /\b(original (packaging|box|case|pouch|presentation)|as[- ]issued|mint (packaging|case|casing)|presentation (box|case)|display case|red (box|case)|casing|in its (original )?(box|case))\b/i, coverage: 0.10, quality: 0.05, evidence: false },
  { key: "sealed", label: "Sealed / unopened", pattern: /\b(sealed|unopened|intact (foil|seal|shrink[- ]?wrap)|still (sealed|in the foil|shrink))\b/i, coverage: 0.08, quality: 0.05, evidence: false },
  { key: "receipt", label: "Purchase receipt / invoice", pattern: /\b(receipt|invoice|proof of purchase|bill of sale|purchase (record|documentation)|original paperwork)\b/i, coverage: 0.10, quality: 0.12, evidence: true },
  { key: "certificate", label: "Certificate / papers", pattern: /\b(certificate of authenticity|c\.?o\.?a\.?|certificate|warranty card|assay cert|gem(ological)? (report|cert)|papers|authenticity card)\b/i, coverage: 0.10, quality: 0.12, evidence: true },
  { key: "documented_chain", label: "Documented ownership chain", pattern: /\b(purchased from|acquired from|bought from|inherited|estate of|bequest|by descent|chain of ownership|previously owned|ex[- ]?collection|consigned by|provenance|gift(?:ed)? (?:from|to|by)|handed down|passed down|heirloom|family (?:piece|collection|heirloom))\b/i, coverage: 0.12, quality: 0.08, evidence: true },
  { key: "dated_history", label: "Dated history", pattern: /\b(in|since|from|circa|c\.)\s?(18|19|20)\d{2}\b/i, coverage: 0.06, quality: 0.03, evidence: false },
];

/** Caps: a PARTIAL description can lift custody but never max it — corroboration
 *  is still required for the top band. But a COMPLETE ownership record (single
 *  owner from new + documents) is not a fragment to cap: it is the whole custody
 *  story, and is scored as such below (see COMPLETE_* floors). */
const COVERAGE_CAP = 0.35;
const QUALITY_CAP = 0.2;

// Unbroken-ownership-from-new signal. A "single owner from new / held since new /
// bought new" history means the ownership TIMELINE is complete — there is no
// missing middle to hedge against. Coverage (timeline completeness) is therefore
// high; documentation quality still depends on the papers held (COA/receipt), so
// a from-new object with no documents earns full coverage but only modest quality.
const FROM_NEW =
  /\b(from new|since new|owned from new|held (?:from|since) new|bought (?:it )?new|purchased (?:it )?new|acquired (?:it )?new|first and only owner|sole owner from new|owned (?:it )?from new|from the mint)\b/i;

/** A complete timeline is full coverage (base 0.5 + 0.45 = 0.95). */
const COMPLETE_COVERAGE = 0.45;
/** Primary documentation (a serial-numbered COA / purchase receipt) on a complete
 *  timeline lifts quality to near-primary (base 0.7 + 0.25 = 0.95). */
const PRIMARY_DOC_QUALITY = 0.25;

// A claim that is DENIED must not be credited — "No original packaging",
// "without papers", "no box". Scope the negation to the clause (back to the
// previous comma/period) so a negator in a different clause ("no scratches,
// original box") doesn't wrongly cancel the signal. Bias is conservative: an
// occasional over-negation (missing a real signal) beats crediting a denied one.
const NEGATION = /\b(no|not|without|missing|lost|lack(?:s|ing)?|absent|never|none|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t)\b/i;

function negatedBefore(notes: string, index: number): boolean {
  const clauseStart =
    Math.max(
      notes.lastIndexOf(".", index - 1),
      notes.lastIndexOf(",", index - 1),
      notes.lastIndexOf(";", index - 1),
      notes.lastIndexOf("(", index - 1),
    ) + 1;
  return NEGATION.test(notes.slice(clauseStart, index));
}

export interface ProvenanceCustody {
  coverage: number;
  quality: number;
  /** Extra custody trials (Scenario-B n_eff). For a partial description, only
   *  documented-evidence signals count; for a COMPLETE timeline the coherent
   *  whole is corroborating, so every signal (plus the completeness itself)
   *  counts — a complete record earns a tighter interval, not just a shifted one. */
  events: number;
  signals: ProvenanceSignal[];
  /** Unbroken ownership from new — makes the stolen-property register moot (Risk). */
  firstOwnerFromNew: boolean;
  /** From-new (or a fully-documented chain) WITH corroborating documents — the
   *  ownership record is complete, so custody coverage/quality/trials are not capped. */
  completeTimeline: boolean;
}

/** Derive a custody contribution from the owner's provenance description. Empty
 *  / absent notes → a zero contribution (existing behaviour unchanged). */
export function deriveProvenanceCustody(
  notes: string | undefined | null,
  opts: { suppressComplete?: boolean } = {},
): ProvenanceCustody {
  const empty: ProvenanceCustody = { coverage: 0, quality: 0, events: 0, signals: [], firstOwnerFromNew: false, completeTimeline: false };
  if (!notes || !notes.trim()) return empty;
  const found: ProvenanceSignal[] = [];
  for (const s of SIGNALS) {
    const m = s.pattern.exec(notes);
    if (!m) continue;
    if (negatedBefore(notes, m.index)) continue; // e.g. "No original packaging"
    found.push({ key: s.key, label: s.label, coverage: s.coverage, quality: s.quality, evidence: s.evidence });
  }
  const fnMatch = FROM_NEW.exec(notes);
  const firstOwnerFromNew = !!fnMatch && !negatedBefore(notes, fnMatch.index);
  if (!found.length && !firstOwnerFromNew) return empty;

  // Documents that corroborate a from-new claim. Full custody credit is earned
  // only when the complete-timeline claim is BACKED by documents — an undocumented
  // "owned from new" is a bare claim and stays capped like any other prose.
  const hasPrimaryDoc = found.some((s) => s.key === "certificate" || s.key === "receipt");
  const hasCorroboratingDoc = hasPrimaryDoc || found.some((s) => s.key === "original_packaging" || s.key === "documented_chain");
  // suppressComplete: a caller (enrich, on a MATERIAL red flag) can veto the
  // complete-timeline lift — a polished provenance story must never launder a
  // materially-inconsistent (likely-fake) object up the tiers.
  const completeTimeline = !opts.suppressComplete && firstOwnerFromNew && hasCorroboratingDoc;

  let coverage = Math.min(COVERAGE_CAP, found.reduce((a, s) => a + s.coverage, 0));
  let quality = Math.min(QUALITY_CAP, found.reduce((a, s) => a + s.quality, 0));
  if (completeTimeline) {
    // The ownership record is COMPLETE, not a fragment: full coverage, and
    // near-primary quality when a serial-numbered COA / receipt backs it.
    coverage = Math.max(coverage, COMPLETE_COVERAGE);
    if (hasPrimaryDoc) quality = Math.max(quality, PRIMARY_DOC_QUALITY);
  }
  // Trials: a complete, coherent record corroborates itself — every signal counts,
  // plus the completeness. A partial description only earns trials from hard
  // evidence (receipt / papers / named chain).
  const events = completeTimeline ? found.length + 1 : found.filter((s) => s.evidence).length;
  return { coverage, quality, events, signals: found, firstOwnerFromNew, completeTimeline };
}
