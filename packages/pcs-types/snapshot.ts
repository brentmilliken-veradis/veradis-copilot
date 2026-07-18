// ReportSnapshot — the immutable versioned payload stored in
// report_version.snapshot_jsonb, addressed by (objectId, snapshotTs). The
// deterministic scorer is pure over it and the renderer renders it verbatim, so
// re-issuing against the same snapshot is bit-identical. Canonical Report Spec
// v03 §3 defines the sections this must feed.

import type {
  Category,
  AuthorityState,
  CheckOutcome,
  C2paState,
  EvidenceKind,
  Quadrant,
  RetrievalState,
  SourceTier,
} from "./domain";
import type { PcsScore } from "./scoring";

export interface SnapshotObject {
  title: string;
  ownerFacingName: string;
  /** What the owner claimed at intake (the hypothesis). */
  declaredAttributes: Record<string, string>;
  /** What the engine derived + resolved (post mislabel-correction). */
  resolvedAttributes: Record<string, string>;
}

export interface SnapshotEvidence {
  slot: string;
  kind: EvidenceKind;
  sha256: string;
  c2paState: C2paState;
  label?: string;
}

export interface SnapshotCheck {
  quadrant: Quadrant;
  key: string;
  label: string;
  result: CheckOutcome;
  authorityState: AuthorityState;
  sourceName?: string;
  note?: string;
}

export interface SnapshotCitation {
  name: string;
  url?: string;
  retrievalState: RetrievalState;
  tier: SourceTier;
}

export interface SnapshotCorrection {
  claimed: string;
  evidence: string;
  correctedValue: string;
  kindnessNote: string;
}

export interface Comp {
  source: string;
  venue: string;
  date: string;
  result: string;
  basis: string;
  fx?: string;
}

export interface Factor {
  name: string;
  kind: "lift" | "hold" | "decide" | "info";
  effect?: string;
}

export interface RankedAction {
  rank: number;
  action: string;
  expectedBandEffect: string;
}

export interface Valuation {
  currency: string;
  /** FMV band. Two honest sources, never conflated:
   *   1. EXPERT-SET at curator confirm (F-8, D-3) — the authoritative band.
   *   2. An engine-drafted INDICATIVE estimate (`indicative: true`), shown only
   *      when the valuation adapter is active, clearly labelled a machine
   *      estimate, and NEVER fed to the score.
   *  With neither, a provisional Appraise omits both and renders
   *  "Indicative value — under expert review". */
  fmvLo?: number;
  fmvHi?: number;
  sellLo?: number;
  sellHi?: number;
  insureValue?: number;
  comps: Comp[];
  factors: Factor[];
  actions: RankedAction[];
  marketInterest: "low" | "modest" | "warm" | "high";
  /** True when fmvLo/fmvHi are an ENGINE indicative estimate, not an expert-set
   *  band — drives the "machine estimate, not a certified appraisal" labelling.
   *  An expert confirm sets a firm band and clears this flag. */
  indicative?: boolean;
  /** One-line cited basis for an indicative estimate (what it is grounded in). */
  basis?: string;
  /** Indicative confidence — never more than "moderate"; an engine estimate is
   *  explicitly not a certified valuation. */
  estimateConfidence?: "low" | "moderate";
}

export interface NarrativeSection {
  id: string;
  title: string;
  /** LLM-drafted prose. Never contains a computed number the scorer owns. */
  body: string;
}

/** One row of the delta panel — the evidence ladder vs the prior version. */
export interface DeltaRow {
  measure: string;
  from: string;
  to: string;
  note?: string;
}

export interface ReportSnapshot {
  reportId: string;
  objectId: string;
  /** Addressing key — with objectId, seeds the deterministic scorer. */
  snapshotTs: string;
  category: Category;
  v: number;
  methodVersion: "v21";
  meta: {
    effectiveDate: string;
    ownerLocale: string;
    currency: string;
    basis: string;
  };
  object: SnapshotObject;
  evidence: SnapshotEvidence[];
  checks: SnapshotCheck[];
  citations: SnapshotCitation[];
  corrections: SnapshotCorrection[];
  score: PcsScore;
  /** SHA-256 of this version's content (report_version.snapshot_sha256). Set when
   *  the version is persisted; the renderer displays it in the attestation. */
  snapshotSha256?: string;
  /** The prior version's content hash — the hash-chain link (gate ⑥). */
  supersedesSha256?: string;
  /** Appraise only. */
  valuation?: Valuation;
  narrative: NarrativeSection[];
  /** Watermark "Provisional — under expert review" until a curator confirms. */
  provisional: boolean;
  /** Set when the presented tier was capped (fix brief v03 F-1/F-2): the
   *  category is uncalibrated, or the category came from a vision-only
   *  re-route. A capped report can never be confirmed to definitive. Omitted
   *  entirely when uncapped so calibrated-category hashes are unchanged. */
  capReason?: "uncalibrated_category" | "vision_reroute";
  /** A1: set when a curator STEPPED DOWN the tier below the band its composite
   *  implies (confirm.ts, verb='downgraded'). The composite is left intact —
   *  so a bare `Math.round(composite)` would badge the HIGHER, un-downgraded
   *  tier on the account card. The delivery bridge suppresses that bare number
   *  the same way it suppresses a capped one (R-4); the HTML still carries the
   *  sealed downgraded tier + the curator note. Omitted unless a real
   *  step-down occurred, so non-downgraded hashes are unchanged. */
  tierAdjusted?: true;
  /** Populated on v≥2 to render the evidence-ladder delta panel. */
  delta?: DeltaRow[];
}
