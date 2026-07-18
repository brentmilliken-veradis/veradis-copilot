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

/** Caps: description alone can lift custody but never max it — corroboration
 *  (Tier-1 / graph links / real papers) is still required for the top band. */
const COVERAGE_CAP = 0.35;
const QUALITY_CAP = 0.2;

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
  /** Extra custody trials (Scenario-B n_eff) from documented-evidence signals. */
  events: number;
  signals: ProvenanceSignal[];
}

/** Derive a custody contribution from the owner's provenance description. Empty
 *  / absent notes → a zero contribution (existing behaviour unchanged). */
export function deriveProvenanceCustody(notes: string | undefined | null): ProvenanceCustody {
  const empty: ProvenanceCustody = { coverage: 0, quality: 0, events: 0, signals: [] };
  if (!notes || !notes.trim()) return empty;
  const found: ProvenanceSignal[] = [];
  for (const s of SIGNALS) {
    const m = s.pattern.exec(notes);
    if (!m) continue;
    if (negatedBefore(notes, m.index)) continue; // e.g. "No original packaging"
    found.push({ key: s.key, label: s.label, coverage: s.coverage, quality: s.quality, evidence: s.evidence });
  }
  if (!found.length) return empty;
  const coverage = Math.min(COVERAGE_CAP, found.reduce((a, s) => a + s.coverage, 0));
  const quality = Math.min(QUALITY_CAP, found.reduce((a, s) => a + s.quality, 0));
  const events = found.filter((s) => s.evidence).length;
  return { coverage, quality, events, signals: found };
}
