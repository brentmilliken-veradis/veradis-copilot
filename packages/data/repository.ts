// Repository — the persistence boundary. All pipeline stages talk to this
// interface, never to a concrete store. `InMemoryRepository` backs tests and the
// seeded fixture run; `SupabaseRepository` (behind DATA_BACKEND=supabase) is
// authored in E-later but stays dormant until the live veradis-copilot project
// is provisioned (BUILD-KICKOFF §8).

import type {
  Report,
  ReportStatus,
  ReportVersion,
  EvidenceItem,
  CheckResult,
  SourceCitation,
  Correction,
  CuratorAction,
  CategoryProfileRow,
  CorpusDocument,
  CorpusChunk,
  Category,
} from "@/packages/pcs-types";

export type NewReport = {
  orderId: string;
  objectId: string;
  category: Category;
  status?: ReportStatus;
};

export type NewReportVersion = Omit<ReportVersion, "id" | "createdAt">;
export type NewEvidenceItem = Omit<EvidenceItem, "id">;
export type NewCheckResult = Omit<CheckResult, "id">;
export type NewSourceCitation = Omit<SourceCitation, "id">;
export type NewCorrection = Omit<Correction, "id">;
export type NewCuratorAction = Omit<CuratorAction, "id" | "signedAt" | "immutable">;
export type NewCategoryProfileRow = Omit<CategoryProfileRow, "id">;
export type NewCorpusDocument = Omit<CorpusDocument, "id">;
export type NewCorpusChunk = Omit<CorpusChunk, "id">;

export interface Repository {
  // reports
  createReport(input: NewReport): Promise<Report>;
  getReport(id: string): Promise<Report | null>;
  /** Bounded lookup by order id (F-6) — the poller's delivery-retry path must
   *  not scan the table (PostgREST silently caps list responses at 1000). */
  getReportByOrderId(orderId: string): Promise<Report | null>;
  updateReport(
    id: string,
    patch: Partial<Pick<Report, "status" | "currentVersion" | "objectId" | "category">>,
  ): Promise<Report>;
  listReports(): Promise<Report[]>;

  // versions (hash-chained)
  addReportVersion(input: NewReportVersion): Promise<ReportVersion>;
  getReportVersions(reportId: string): Promise<ReportVersion[]>;
  getLatestVersion(reportId: string): Promise<ReportVersion | null>;

  // evidence
  addEvidence(input: NewEvidenceItem): Promise<EvidenceItem>;
  updateEvidence(
    id: string,
    patch: Partial<Pick<EvidenceItem, "c2paState" | "exifTs" | "slot">>,
  ): Promise<EvidenceItem>;
  listEvidence(reportId: string): Promise<EvidenceItem[]>;

  // checks
  addCheck(input: NewCheckResult): Promise<CheckResult>;
  listChecks(reportId: string): Promise<CheckResult[]>;

  // citations
  addCitation(input: NewSourceCitation): Promise<SourceCitation>;
  listCitations(reportId: string): Promise<SourceCitation[]>;

  // corrections (the mislabel record)
  addCorrection(input: NewCorrection): Promise<Correction>;
  listCorrections(reportId: string): Promise<Correction[]>;

  // curator actions (immutable)
  addCuratorAction(input: NewCuratorAction): Promise<CuratorAction>;
  listCuratorActions(reportId: string): Promise<CuratorAction[]>;

  // profiles (versioned data)
  upsertProfile(input: NewCategoryProfileRow): Promise<CategoryProfileRow>;
  getProfile(category: Category, version?: number): Promise<CategoryProfileRow | null>;

  // corpus (pgvector, live-deferred)
  addCorpusDocument(input: NewCorpusDocument): Promise<CorpusDocument>;
  addCorpusChunk(input: NewCorpusChunk): Promise<CorpusChunk>;
  listCorpusChunks(category: Category): Promise<CorpusChunk[]>;

  // orders — tallySubmissionId is the dedupe key; the id PK is the atomic
  // claim (createOrder throws DuplicateOrderError on an existing id).
  createOrder(input: NewOrder): Promise<Order>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrderByTallySubmission(submissionId: string): Promise<Order | null>;
  updateOrder(
    orderId: string,
    patch: Partial<Pick<Order, "productionState" | "attempts" | "claimedAt" | "lastError">>,
  ): Promise<Order>;
  /** R-3: compare-and-swap reclaim of a stale 'producing' claim. Takes the row
   *  ONLY when productionState is still 'producing' AND (claimedAt, attempts)
   *  match the observed values — bumping attempts and stamping the new claim.
   *  Returns the reclaimed order, or null when another tick won the race. */
  reclaimStaleOrder(
    orderId: string,
    expected: { claimedAt: string | null; attempts: number },
    newClaimedAt: string,
  ): Promise<Order | null>;

  // outbound email log (EMAIL A/B/C audit trail)
  recordEmail(input: NewEmailRecord): Promise<EmailRecord>;
  listEmails(orderId: string): Promise<EmailRecord[]>;
}

/** A paid order — the commercial side of a report (Tally or store queue). */
export interface Order {
  id: string;
  tallySubmissionId: string;
  email: string;
  ownerName: string | null;
  category: Category;
  sku: "verify" | "appraise";
  createdAt: string;
  /** F-5a production lifecycle: the order row IS the poller's atomic claim.
   *  producing = claimed/in flight · produced = pipeline succeeded ·
   *  failed = terminal after max attempts (surfaced, never retried). */
  productionState: "producing" | "produced" | "failed";
  attempts: number;
  claimedAt: string | null;
  lastError: string | null;
}

export type NewOrder = Omit<Order, "createdAt" | "productionState" | "attempts" | "claimedAt" | "lastError"> & {
  productionState?: Order["productionState"];
  attempts?: number;
  claimedAt?: string | null;
};

/** createOrder on an existing id — the losing side of an atomic claim. */
export class DuplicateOrderError extends Error {
  constructor(orderId: string) {
    super(`order ${orderId} already exists`);
    this.name = "DuplicateOrderError";
  }
}

export type EmailKind = "received" | "curator_review" | "definitive";

export interface EmailRecord {
  id: string;
  orderId: string;
  reportId: string | null;
  kind: EmailKind;
  to: string;
  subject: string;
  providerId: string;
  sentAt: string;
}

export type NewEmailRecord = Omit<EmailRecord, "id" | "sentAt">;

/** Injectable clock + id source so tests are deterministic. */
export interface RepoEnv {
  now: () => string;
  id: () => string;
}
