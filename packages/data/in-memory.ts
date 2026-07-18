// InMemoryRepository — the store behind every test and the seeded fixture run.
// No external I/O; deterministic when given a fixed clock + id source.

import { randomUUID } from "node:crypto";
import type {
  Report,
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
import {
  DuplicateOrderError,
} from "./repository";
import type {
  Repository,
  RepoEnv,
  Order,
  NewOrder,
  EmailRecord,
  NewEmailRecord,
  NewReport,
  NewReportVersion,
  NewEvidenceItem,
  NewCheckResult,
  NewSourceCitation,
  NewCorrection,
  NewCuratorAction,
  NewCategoryProfileRow,
  NewCorpusDocument,
  NewCorpusChunk,
} from "./repository";

const defaultEnv: RepoEnv = {
  now: () => new Date().toISOString(),
  id: () => randomUUID(),
};

export class InMemoryRepository implements Repository {
  private reports = new Map<string, Report>();
  private versions: ReportVersion[] = [];
  private evidence: EvidenceItem[] = [];
  private checks: CheckResult[] = [];
  private citations: SourceCitation[] = [];
  private corrections: Correction[] = [];
  private curatorActions: CuratorAction[] = [];
  private profiles: CategoryProfileRow[] = [];
  private corpusDocs: CorpusDocument[] = [];
  private corpusChunks: CorpusChunk[] = [];
  private orders = new Map<string, Order>();
  private emails: EmailRecord[] = [];

  constructor(private env: RepoEnv = defaultEnv) {}

  async createOrder(input: NewOrder): Promise<Order> {
    if (this.orders.has(input.id)) throw new DuplicateOrderError(input.id); // atomic claim (F-5a)
    const order: Order = {
      id: input.id,
      tallySubmissionId: input.tallySubmissionId,
      email: input.email,
      ownerName: input.ownerName,
      category: input.category,
      sku: input.sku,
      createdAt: this.env.now(),
      productionState: input.productionState ?? "producing",
      attempts: input.attempts ?? 0,
      claimedAt: input.claimedAt ?? null,
      lastError: null,
      deliveryAttempts: input.deliveryAttempts ?? 0,
    };
    this.orders.set(order.id, order);
    return { ...order };
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const o = this.orders.get(orderId);
    return o ? { ...o } : null;
  }

  async updateOrder(
    orderId: string,
    patch: Partial<Pick<Order, "productionState" | "attempts" | "claimedAt" | "lastError" | "deliveryAttempts">>,
  ): Promise<Order> {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`order ${orderId} not found`);
    Object.assign(o, patch);
    return { ...o };
  }

  async reclaimStaleOrder(
    orderId: string,
    expected: { claimedAt: string | null; attempts: number },
    newClaimedAt: string,
  ): Promise<Order | null> {
    // Synchronous check-and-set — atomic w.r.t. async interleavings (R-3).
    const o = this.orders.get(orderId);
    if (
      !o ||
      o.productionState !== "producing" ||
      o.claimedAt !== expected.claimedAt ||
      o.attempts !== expected.attempts
    ) {
      return null;
    }
    o.claimedAt = newClaimedAt;
    o.attempts = expected.attempts + 1;
    return { ...o };
  }

  async getOrderByTallySubmission(submissionId: string): Promise<Order | null> {
    for (const o of this.orders.values()) {
      if (o.tallySubmissionId === submissionId) return o;
    }
    return null;
  }

  async recordEmail(input: NewEmailRecord): Promise<EmailRecord> {
    const rec: EmailRecord = { ...input, id: this.env.id(), sentAt: this.env.now() };
    this.emails.push(rec);
    return rec;
  }

  async listEmails(orderId: string): Promise<EmailRecord[]> {
    return this.emails.filter((e) => e.orderId === orderId);
  }

  async createReport(input: NewReport): Promise<Report> {
    const report: Report = {
      id: this.env.id(),
      orderId: input.orderId,
      objectId: input.objectId,
      category: input.category,
      status: input.status ?? "created",
      currentVersion: 0,
      createdAt: this.env.now(),
    };
    this.reports.set(report.id, report);
    return { ...report };
  }

  async getReport(id: string): Promise<Report | null> {
    const r = this.reports.get(id);
    return r ? { ...r } : null;
  }

  async getReportByOrderId(orderId: string): Promise<Report | null> {
    for (const r of this.reports.values()) {
      if (r.orderId === orderId) return { ...r };
    }
    return null;
  }

  async listReportsByStatus(status: Report["status"], limit: number): Promise<Report[]> {
    const out: Report[] = [];
    for (const r of this.reports.values()) {
      if (r.status === status) out.push({ ...r });
      if (out.length >= limit) break;
    }
    return out;
  }

  async updateReport(
    id: string,
    patch: Partial<Pick<Report, "status" | "currentVersion" | "objectId" | "category">>,
  ): Promise<Report> {
    const r = this.reports.get(id);
    if (!r) throw new Error(`report ${id} not found`);
    const next = { ...r, ...patch };
    this.reports.set(id, next);
    return { ...next };
  }

  async listReports(): Promise<Report[]> {
    return [...this.reports.values()].map((r) => ({ ...r }));
  }

  async addReportVersion(input: NewReportVersion): Promise<ReportVersion> {
    const version: ReportVersion = { ...input, id: this.env.id(), createdAt: this.env.now() };
    this.versions.push(version);
    return { ...version };
  }

  async getReportVersions(reportId: string): Promise<ReportVersion[]> {
    return this.versions.filter((v) => v.reportId === reportId).sort((a, b) => a.v - b.v).map((v) => ({ ...v }));
  }

  async getLatestVersion(reportId: string): Promise<ReportVersion | null> {
    const all = await this.getReportVersions(reportId);
    return all.length ? all[all.length - 1] : null;
  }

  async addEvidence(input: NewEvidenceItem): Promise<EvidenceItem> {
    const e: EvidenceItem = { ...input, id: this.env.id() };
    this.evidence.push(e);
    return { ...e };
  }

  async updateEvidence(
    id: string,
    patch: Partial<Pick<EvidenceItem, "c2paState" | "exifTs" | "slot">>,
  ): Promise<EvidenceItem> {
    const e = this.evidence.find((x) => x.id === id);
    if (!e) throw new Error(`evidence ${id} not found`);
    Object.assign(e, patch);
    return { ...e };
  }

  async listEvidence(reportId: string): Promise<EvidenceItem[]> {
    return this.evidence.filter((e) => e.reportId === reportId).map((e) => ({ ...e }));
  }

  async addCheck(input: NewCheckResult): Promise<CheckResult> {
    const c: CheckResult = { ...input, id: this.env.id() };
    this.checks.push(c);
    return { ...c };
  }

  async listChecks(reportId: string): Promise<CheckResult[]> {
    return this.checks.filter((c) => c.reportId === reportId).map((c) => ({ ...c }));
  }

  async addCitation(input: NewSourceCitation): Promise<SourceCitation> {
    const s: SourceCitation = { ...input, id: this.env.id() };
    this.citations.push(s);
    return { ...s };
  }

  async listCitations(reportId: string): Promise<SourceCitation[]> {
    return this.citations.filter((s) => s.reportId === reportId).map((s) => ({ ...s }));
  }

  async addCorrection(input: NewCorrection): Promise<Correction> {
    const c: Correction = { ...input, id: this.env.id() };
    this.corrections.push(c);
    return { ...c };
  }

  async listCorrections(reportId: string): Promise<Correction[]> {
    return this.corrections.filter((c) => c.reportId === reportId).map((c) => ({ ...c }));
  }

  async addCuratorAction(input: NewCuratorAction): Promise<CuratorAction> {
    const a: CuratorAction = {
      ...input,
      id: this.env.id(),
      signedAt: this.env.now(),
      immutable: true,
    };
    this.curatorActions.push(a);
    return { ...a };
  }

  async listCuratorActions(reportId: string): Promise<CuratorAction[]> {
    return this.curatorActions.filter((a) => a.reportId === reportId).map((a) => ({ ...a }));
  }

  async upsertProfile(input: NewCategoryProfileRow): Promise<CategoryProfileRow> {
    const existing = this.profiles.find(
      (p) => p.category === input.category && p.version === input.version,
    );
    if (existing) {
      existing.json = input.json;
      return { ...existing };
    }
    const p: CategoryProfileRow = { ...input, id: this.env.id() };
    this.profiles.push(p);
    return { ...p };
  }

  async getProfile(category: Category, version?: number): Promise<CategoryProfileRow | null> {
    const forCat = this.profiles.filter((p) => p.category === category);
    if (!forCat.length) return null;
    if (version !== undefined) {
      const match = forCat.find((p) => p.version === version);
      return match ? { ...match } : null;
    }
    // latest version
    const latest = forCat.reduce((a, b) => (b.version > a.version ? b : a));
    return { ...latest };
  }

  async addCorpusDocument(input: NewCorpusDocument): Promise<CorpusDocument> {
    const d: CorpusDocument = { ...input, id: this.env.id() };
    this.corpusDocs.push(d);
    return { ...d };
  }

  async addCorpusChunk(input: NewCorpusChunk): Promise<CorpusChunk> {
    const c: CorpusChunk = { ...input, id: this.env.id() };
    this.corpusChunks.push(c);
    return { ...c };
  }

  async listCorpusChunks(category: Category): Promise<CorpusChunk[]> {
    const docIds = new Set(this.corpusDocs.filter((d) => d.category === category).map((d) => d.id));
    return this.corpusChunks.filter((c) => docIds.has(c.corpusDocumentId)).map((c) => ({ ...c }));
  }
}
