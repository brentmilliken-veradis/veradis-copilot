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
  fmvLo: number;
  fmvHi: number;
  sellLo?: number;
  sellHi?: number;
  insureValue?: number;
  comps: Comp[];
  factors: Factor[];
  actions: RankedAction[];
  marketInterest: "low" | "modest" | "warm" | "high";
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
  /** Populated on v≥2 to render the evidence-ladder delta panel. */
  delta?: DeltaRow[];
}
