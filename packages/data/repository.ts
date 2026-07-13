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
}

/** Injectable clock + id source so tests are deterministic. */
export interface RepoEnv {
  now: () => string;
  id: () => string;
}
