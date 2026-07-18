// Domain types for the PCS / Appraise co-pilot.
// These mirror the P0 data model (docs/…P0-Build-Plan_v01.md §2) and the
// Canonical Report Spec v03 vocabularies. TypeScript uses camelCase; the
// SQL migration uses snake_case columns and the (deferred) Supabase
// repository maps between them.

/** The category profiles. Coins is calibrated; watches, medals, art, fine-china,
 *  silver and jewellery ship as provisional SCAFFOLDS — they run provisional/
 *  flagged until real Tier-1 sources + calibration land (P2). `cards` maps but
 *  has no profile yet (routes to refund until one is built). */
export type Category = "coins" | "cards" | "medals" | "watches" | "silver" | "jewellery" | "luxury" | "art" | "fine-china";

/** Runtime list of every category — for validating untrusted category strings
 *  (webhook payloads, vision output) against the union. Keep in sync. */
export const ALL_CATEGORIES: readonly Category[] = [
  "coins",
  "cards",
  "medals",
  "watches",
  "silver",
  "jewellery",
  "luxury",
  "art",
  "fine-china",
];

/** The four PCS quadrants (Method v21 §2). Weights 30/30/25/15. */
export type Quadrant = "identity" | "custody" | "material" | "risk";

/** Output tiers (Method v21 §8). Unscored/Withheld are non-band states gated
 *  before score-band mapping; both are refunded. Flagged is a paid deliverable. */
export type Tier = "gold" | "silver" | "bronze" | "unscored" | "flagged" | "withheld";

/** Per-check authority state (check_result.authority_state). Tier-1 API =
 *  `resolved` (can close a check); Tier 2–3 corpus = `corpus` (corroborates);
 *  user claim / Tier-4 = `declared`; absent = `missing`. */
export type AuthorityState = "resolved" | "declared" | "missing" | "corpus";

/** Source retrieval state (source_citation.retrieval_state). */
export type RetrievalState =
  | "retrieved"
  | "pending"
  | "not_digitised"
  | "access_restricted";

/** Corpus tier of a cited source (source_citation.tier). 1 = ground truth,
 *  2–3 = corroboration, 4 = cite-only (never ingested as fact). */
export type SourceTier = 1 | 2 | 3 | 4;

/** Check outcome states rendered in the checks table (Report Spec v03 §3, §10). */
export type CheckOutcome =
  | "match"
  | "consistent"
  | "observed"
  | "corrected"
  | "reinterpreted"
  | "flagged"
  | "gap_held_open";

/** Evidence kind. */
export type EvidenceKind = "photo" | "doc" | "linked";

/** C2PA content-credential state at ingest (gate ④). */
export type C2paState = "present" | "absent" | "invalid" | "unchecked";

/** Job / report lifecycle (ADR-001 state model). created → paid → provisional
 *  → definitive, plus terminal unscored / flagged / withheld. */
export type ReportStatus =
  | "created"
  | "paid"
  | "provisional"
  | "definitive"
  | "unscored"
  | "flagged"
  | "withheld";

/** Curator action verbs (E7). The critic and curator may only hold the line or
 *  step down — never inflate. */
export type CuratorVerb = "confirmed" | "downgraded" | "withheld";

/** Curator credential class — Grade 2 path for high-value objects (gate ⑨). */
export type CredentialClass = "curator" | "senior_curator" | "external_expert";

// ── DB-row records (one per P0 table) ──────────────────────────────────────

export interface Report {
  id: string;
  orderId: string; // → live verify_orders
  objectId: string;
  category: Category;
  status: ReportStatus;
  currentVersion: number;
  createdAt: string; // ISO 8601
}

export interface ReportVersion {
  id: string;
  reportId: string;
  v: number;
  snapshotJson: ReportSnapshot;
  snapshotSha256: string;
  supersedesSha256: string | null; // hash-chain link to the prior version
  tier: Tier | null;
  composite: number | null;
  ciLo: number | null;
  ciHi: number | null;
  pdfPath: string | null;
  createdAt: string;
}

export interface EvidenceItem {
  id: string;
  reportId: string;
  slot: string; // profile slot id (e.g. "obverse", "mintmark_macro")
  storagePath: string;
  sha256: string;
  exifTs: string | null;
  c2paState: C2paState;
  kind: EvidenceKind;
}

export interface CheckResult {
  id: string;
  reportId: string;
  quadrant: Quadrant;
  key: string; // attribute / check key (e.g. "mint_mark", "hallmark")
  result: CheckOutcome;
  authorityState: AuthorityState;
  sourceId: string | null; // → SourceCitation.id
  note: string | null;
}

export interface SourceCitation {
  id: string;
  reportId: string;
  name: string;
  url: string | null;
  retrievalState: RetrievalState;
  tier: SourceTier;
}

/** The mislabel record (E3). First-class, kindness register. */
export interface Correction {
  id: string;
  reportId: string;
  claimed: string;
  evidence: string;
  correctedValue: string;
  kindnessNote: string;
}

export interface CuratorAction {
  id: string;
  reportId: string;
  curator: string;
  action: CuratorVerb;
  credentialClass: CredentialClass;
  signedAt: string;
  immutable: true;
}

export interface CategoryProfileRow {
  id: string;
  category: Category;
  version: number;
  json: CategoryProfile;
}

export interface CorpusDocument {
  id: string;
  category: Category;
  source: string;
  url: string | null;
  licence: string | null;
  fetchedAt: string;
  sha256: string;
}

export interface CorpusChunk {
  id: string;
  corpusDocumentId: string;
  text: string;
  embedding: number[]; // pgvector column (deferred to live infra)
  metadataJson: Record<string, unknown>;
}

// Forward references resolved in profiles.ts / snapshot.ts
import type { CategoryProfile } from "./profiles";
import type { ReportSnapshot } from "./snapshot";
export type { CategoryProfile } from "./profiles";
export type { ReportSnapshot } from "./snapshot";
