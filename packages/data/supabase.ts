// SupabaseRepository — the live persistence layer on the dedicated
// veradis-copilot Supabase project (schema supabase/migrations/0001 + 0002),
// spoken over PostgREST with the service-role key. TypeScript camelCase maps
// to snake_case columns here and nowhere else. Selected by getRepository()
// when copilot creds are present; InMemoryRepository stays the fallback.
//
// NOTE: orders + email_log arrive with migration 0002 (authored, applied via
// the Studio SQL editor like 0001 — never the monorepo migration chain).

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
  ReportSnapshot,
  CategoryProfile,
} from "@/packages/pcs-types";
import { InMemoryRepository } from "./in-memory";
import { DuplicateOrderError } from "./repository";
import type {
  Repository,
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

type Row = Record<string, unknown>;

/** PostgREST error with the HTTP status attached (409 = unique violation). */
export class RestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "RestError";
  }
}

const s = (v: unknown): string => String(v);
const n = (v: unknown): number | null => (v == null ? null : Number(v));

// ── row ↔ domain mapping ────────────────────────────────────────────────────

const mapReport = (r: Row): Report => ({
  id: s(r.id),
  orderId: s(r.order_id),
  objectId: s(r.object_id),
  category: s(r.category) as Category,
  status: s(r.status) as Report["status"],
  currentVersion: Number(r.current_version),
  createdAt: s(r.created_at),
});

const mapVersion = (r: Row): ReportVersion => ({
  id: s(r.id),
  reportId: s(r.report_id),
  v: Number(r.v),
  snapshotJson: r.snapshot_jsonb as ReportSnapshot,
  snapshotSha256: s(r.snapshot_sha256),
  supersedesSha256: r.supersedes_sha256 == null ? null : s(r.supersedes_sha256),
  tier: (r.tier ?? null) as ReportVersion["tier"],
  composite: n(r.composite),
  ciLo: n(r.ci_lo),
  ciHi: n(r.ci_hi),
  pdfPath: r.pdf_path == null ? null : s(r.pdf_path),
  createdAt: s(r.created_at),
});

const mapEvidence = (r: Row): EvidenceItem => ({
  id: s(r.id),
  reportId: s(r.report_id),
  slot: s(r.slot),
  storagePath: s(r.storage_path),
  sha256: s(r.sha256),
  exifTs: r.exif_ts == null ? null : s(r.exif_ts),
  c2paState: s(r.c2pa_state) as EvidenceItem["c2paState"],
  kind: s(r.kind) as EvidenceItem["kind"],
});

const mapCheck = (r: Row): CheckResult => ({
  id: s(r.id),
  reportId: s(r.report_id),
  quadrant: s(r.quadrant) as CheckResult["quadrant"],
  key: s(r.key),
  result: s(r.result) as CheckResult["result"],
  authorityState: s(r.authority_state) as CheckResult["authorityState"],
  sourceId: r.source_id == null ? null : s(r.source_id),
  note: r.note == null ? null : s(r.note),
});

const mapCitation = (r: Row): SourceCitation => ({
  id: s(r.id),
  reportId: s(r.report_id),
  name: s(r.name),
  url: r.url == null ? null : s(r.url),
  retrievalState: s(r.retrieval_state) as SourceCitation["retrievalState"],
  tier: Number(r.tier) as SourceCitation["tier"],
});

const mapCorrection = (r: Row): Correction => ({
  id: s(r.id),
  reportId: s(r.report_id),
  claimed: s(r.claimed),
  evidence: s(r.evidence),
  correctedValue: s(r.corrected_value),
  kindnessNote: s(r.kindness_note),
});

const mapCuratorAction = (r: Row): CuratorAction => ({
  id: s(r.id),
  reportId: s(r.report_id),
  curator: s(r.curator),
  action: s(r.action) as CuratorAction["action"],
  credentialClass: s(r.credential_class) as CuratorAction["credentialClass"],
  signedAt: s(r.signed_at),
  immutable: true,
});

const mapProfile = (r: Row): CategoryProfileRow => ({
  id: s(r.id),
  category: s(r.category) as Category,
  version: Number(r.version),
  json: r.jsonb as CategoryProfile,
});

const mapCorpusDoc = (r: Row): CorpusDocument => ({
  id: s(r.id),
  category: s(r.category) as Category,
  source: s(r.source),
  url: r.url == null ? null : s(r.url),
  licence: r.licence == null ? null : s(r.licence),
  fetchedAt: s(r.fetched_at),
  sha256: s(r.sha256),
});

// pgvector columns come back from PostgREST as a "[0.1,0.2]" string.
const mapEmbedding = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed.map(Number) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapCorpusChunk = (r: Row): CorpusChunk => ({
  id: s(r.id),
  corpusDocumentId: s(r.corpus_document_id),
  text: s(r.text),
  embedding: mapEmbedding(r.embedding),
  metadataJson: (r.metadata_jsonb ?? {}) as Record<string, unknown>,
});

const mapOrder = (r: Row): Order => ({
  id: s(r.id),
  tallySubmissionId: s(r.tally_submission_id),
  email: s(r.email),
  ownerName: r.owner_name == null ? null : s(r.owner_name),
  category: s(r.category) as Category,
  sku: s(r.sku) as Order["sku"],
  createdAt: s(r.created_at),
  productionState: (r.production_state ?? "producing") as Order["productionState"],
  attempts: Number(r.attempts ?? 0),
  claimedAt: r.claimed_at == null ? null : s(r.claimed_at),
  lastError: r.last_error == null ? null : s(r.last_error),
});

const mapEmail = (r: Row): EmailRecord => ({
  id: s(r.id),
  orderId: s(r.order_id),
  reportId: r.report_id == null ? null : s(r.report_id),
  kind: s(r.kind) as EmailRecord["kind"],
  to: s(r.to),
  subject: s(r.subject),
  providerId: s(r.provider_id),
  sentAt: s(r.sent_at),
});

// ── repository ──────────────────────────────────────────────────────────────

export class SupabaseRepository implements Repository {
  constructor(
    private url: string, // https://<copilot-ref>.supabase.co
    private serviceKey: string,
  ) {}

  private async rest(pathAndQuery: string, init: RequestInit = {}): Promise<Row[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        "content-type": "application/json",
        prefer: init.method && init.method !== "GET" ? "return=representation" : "",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      // F-12: log the upstream body server-side; the thrown message (which can
      // surface as per-row reason/detail) carries only the path + status.
      console.error(`repo:supabase ${init.method ?? "GET"} ${pathAndQuery} → ${res.status}: ${await res.text()}`);
      throw new RestError(`repo:supabase ${init.method ?? "GET"} ${pathAndQuery} failed (${res.status})`, res.status);
    }
    const text = await res.text();
    if (!text) return [];
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as Row[]) : [parsed as Row];
  }

  private async insert(table: string, row: Row): Promise<Row> {
    const rows = await this.rest(table, { method: "POST", body: JSON.stringify(row) });
    if (!rows.length) throw new Error(`repo:supabase insert into ${table} returned no row`);
    return rows[0];
  }

  // reports
  async createReport(input: NewReport): Promise<Report> {
    return mapReport(
      await this.insert("report", {
        order_id: input.orderId,
        object_id: input.objectId,
        category: input.category,
        status: input.status ?? "created",
      }),
    );
  }

  async getReport(id: string): Promise<Report | null> {
    const rows = await this.rest(`report?id=eq.${encodeURIComponent(id)}`);
    return rows.length ? mapReport(rows[0]) : null;
  }

  async getReportByOrderId(orderId: string): Promise<Report | null> {
    const rows = await this.rest(
      `report?order_id=eq.${encodeURIComponent(orderId)}&order=created_at.desc&limit=1`,
    );
    return rows.length ? mapReport(rows[0]) : null;
  }

  async updateReport(
    id: string,
    patch: Partial<Pick<Report, "status" | "currentVersion" | "objectId" | "category">>,
  ): Promise<Report> {
    const row: Row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.currentVersion !== undefined) row.current_version = patch.currentVersion;
    if (patch.objectId !== undefined) row.object_id = patch.objectId;
    if (patch.category !== undefined) row.category = patch.category;
    const rows = await this.rest(`report?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    if (!rows.length) throw new Error(`report ${id} not found`);
    return mapReport(rows[0]);
  }

  async listReports(): Promise<Report[]> {
    return (await this.rest("report?order=created_at.desc")).map(mapReport);
  }

  // versions
  async addReportVersion(input: NewReportVersion): Promise<ReportVersion> {
    return mapVersion(
      await this.insert("report_version", {
        report_id: input.reportId,
        v: input.v,
        snapshot_jsonb: input.snapshotJson,
        snapshot_sha256: input.snapshotSha256,
        supersedes_sha256: input.supersedesSha256,
        tier: input.tier,
        composite: input.composite,
        ci_lo: input.ciLo,
        ci_hi: input.ciHi,
        pdf_path: input.pdfPath,
      }),
    );
  }

  async getReportVersions(reportId: string): Promise<ReportVersion[]> {
    return (await this.rest(`report_version?report_id=eq.${encodeURIComponent(reportId)}&order=v.asc`)).map(mapVersion);
  }

  async getLatestVersion(reportId: string): Promise<ReportVersion | null> {
    const rows = await this.rest(`report_version?report_id=eq.${encodeURIComponent(reportId)}&order=v.desc&limit=1`);
    return rows.length ? mapVersion(rows[0]) : null;
  }

  // evidence
  async addEvidence(input: NewEvidenceItem): Promise<EvidenceItem> {
    return mapEvidence(
      await this.insert("evidence_item", {
        report_id: input.reportId,
        slot: input.slot,
        storage_path: input.storagePath,
        sha256: input.sha256,
        exif_ts: input.exifTs,
        c2pa_state: input.c2paState,
        kind: input.kind,
      }),
    );
  }

  async updateEvidence(
    id: string,
    patch: Partial<Pick<EvidenceItem, "c2paState" | "exifTs" | "slot">>,
  ): Promise<EvidenceItem> {
    const row: Row = {};
    if (patch.c2paState !== undefined) row.c2pa_state = patch.c2paState;
    if (patch.exifTs !== undefined) row.exif_ts = patch.exifTs;
    if (patch.slot !== undefined) row.slot = patch.slot;
    const rows = await this.rest(`evidence_item?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    if (!rows.length) throw new Error(`evidence ${id} not found`);
    return mapEvidence(rows[0]);
  }

  async listEvidence(reportId: string): Promise<EvidenceItem[]> {
    return (await this.rest(`evidence_item?report_id=eq.${encodeURIComponent(reportId)}`)).map(mapEvidence);
  }

  // checks
  async addCheck(input: NewCheckResult): Promise<CheckResult> {
    return mapCheck(
      await this.insert("check_result", {
        report_id: input.reportId,
        quadrant: input.quadrant,
        key: input.key,
        result: input.result,
        authority_state: input.authorityState,
        source_id: input.sourceId,
        note: input.note,
      }),
    );
  }

  async listChecks(reportId: string): Promise<CheckResult[]> {
    return (await this.rest(`check_result?report_id=eq.${encodeURIComponent(reportId)}`)).map(mapCheck);
  }

  // citations
  async addCitation(input: NewSourceCitation): Promise<SourceCitation> {
    return mapCitation(
      await this.insert("source_citation", {
        report_id: input.reportId,
        name: input.name,
        url: input.url,
        retrieval_state: input.retrievalState,
        tier: input.tier,
      }),
    );
  }

  async listCitations(reportId: string): Promise<SourceCitation[]> {
    return (await this.rest(`source_citation?report_id=eq.${encodeURIComponent(reportId)}`)).map(mapCitation);
  }

  // corrections
  async addCorrection(input: NewCorrection): Promise<Correction> {
    return mapCorrection(
      await this.insert("correction", {
        report_id: input.reportId,
        claimed: input.claimed,
        evidence: input.evidence,
        corrected_value: input.correctedValue,
        kindness_note: input.kindnessNote,
      }),
    );
  }

  async listCorrections(reportId: string): Promise<Correction[]> {
    return (await this.rest(`correction?report_id=eq.${encodeURIComponent(reportId)}`)).map(mapCorrection);
  }

  // curator actions
  async addCuratorAction(input: NewCuratorAction): Promise<CuratorAction> {
    return mapCuratorAction(
      await this.insert("curator_action", {
        report_id: input.reportId,
        curator: input.curator,
        action: input.action,
        credential_class: input.credentialClass,
      }),
    );
  }

  async listCuratorActions(reportId: string): Promise<CuratorAction[]> {
    return (await this.rest(`curator_action?report_id=eq.${encodeURIComponent(reportId)}`)).map(mapCuratorAction);
  }

  // profiles
  async upsertProfile(input: NewCategoryProfileRow): Promise<CategoryProfileRow> {
    const rows = await this.rest("category_profile?on_conflict=category,version", {
      method: "POST",
      headers: { prefer: "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify({ category: input.category, version: input.version, jsonb: input.json }),
    });
    if (!rows.length) throw new Error("repo:supabase upsert category_profile returned no row");
    return mapProfile(rows[0]);
  }

  async getProfile(category: Category, version?: number): Promise<CategoryProfileRow | null> {
    const filter =
      version !== undefined
        ? `category_profile?category=eq.${encodeURIComponent(category)}&version=eq.${version}`
        : `category_profile?category=eq.${encodeURIComponent(category)}&order=version.desc&limit=1`;
    const rows = await this.rest(filter);
    return rows.length ? mapProfile(rows[0]) : null;
  }

  // corpus
  async addCorpusDocument(input: NewCorpusDocument): Promise<CorpusDocument> {
    return mapCorpusDoc(
      await this.insert("corpus_document", {
        category: input.category,
        source: input.source,
        url: input.url,
        licence: input.licence,
        fetched_at: input.fetchedAt,
        sha256: input.sha256,
      }),
    );
  }

  async addCorpusChunk(input: NewCorpusChunk): Promise<CorpusChunk> {
    return mapCorpusChunk(
      await this.insert("corpus_chunk", {
        corpus_document_id: input.corpusDocumentId,
        text: input.text,
        embedding: input.embedding,
        metadata_jsonb: input.metadataJson,
      }),
    );
  }

  async listCorpusChunks(category: Category): Promise<CorpusChunk[]> {
    // Two-step: PostgREST embedded filters on FK need the resource embedding
    // syntax; keep it explicit and simple instead.
    const docs = await this.rest(`corpus_document?category=eq.${encodeURIComponent(category)}&select=id`);
    if (!docs.length) return [];
    const ids = docs.map((d) => s(d.id)).join(",");
    return (await this.rest(`corpus_chunk?corpus_document_id=in.(${ids})`)).map(mapCorpusChunk);
  }

  // orders (migrations 0002 + 0003)
  async createOrder(input: NewOrder): Promise<Order> {
    try {
      return mapOrder(
        await this.insert("orders", {
          id: input.id,
          tally_submission_id: input.tallySubmissionId,
          email: input.email,
          owner_name: input.ownerName,
          category: input.category,
          sku: input.sku,
          ...(input.productionState !== undefined ? { production_state: input.productionState } : {}),
          ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
          ...(input.claimedAt !== undefined ? { claimed_at: input.claimedAt } : {}),
        }),
      );
    } catch (e) {
      // PostgREST unique violation → the losing side of the atomic claim.
      if (e instanceof RestError && e.status === 409) throw new DuplicateOrderError(input.id);
      throw e;
    }
  }

  async updateOrder(
    orderId: string,
    patch: Partial<Pick<Order, "productionState" | "attempts" | "claimedAt" | "lastError">>,
  ): Promise<Order> {
    const row: Row = {};
    if (patch.productionState !== undefined) row.production_state = patch.productionState;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.claimedAt !== undefined) row.claimed_at = patch.claimedAt;
    if (patch.lastError !== undefined) row.last_error = patch.lastError;
    const rows = await this.rest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    if (!rows.length) throw new Error(`order ${orderId} not found`);
    return mapOrder(rows[0]);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const rows = await this.rest(`orders?id=eq.${encodeURIComponent(orderId)}`);
    return rows.length ? mapOrder(rows[0]) : null;
  }

  async reclaimStaleOrder(
    orderId: string,
    expected: { claimedAt: string | null; attempts: number },
    newClaimedAt: string,
  ): Promise<Order | null> {
    // R-3: conditional PATCH — the WHERE carries the expected claim state, so
    // exactly one concurrent tick gets a row back (compare-and-swap).
    const claimedFilter =
      expected.claimedAt === null
        ? "claimed_at=is.null"
        : `claimed_at=eq.${encodeURIComponent(expected.claimedAt)}`;
    const rows = await this.rest(
      `orders?id=eq.${encodeURIComponent(orderId)}&${claimedFilter}&attempts=eq.${expected.attempts}&production_state=eq.producing`,
      {
        method: "PATCH",
        body: JSON.stringify({ claimed_at: newClaimedAt, attempts: expected.attempts + 1 }),
      },
    );
    return rows.length ? mapOrder(rows[0]) : null;
  }

  async getOrderByTallySubmission(submissionId: string): Promise<Order | null> {
    const rows = await this.rest(`orders?tally_submission_id=eq.${encodeURIComponent(submissionId)}`);
    return rows.length ? mapOrder(rows[0]) : null;
  }

  // email log (migration 0002)
  async recordEmail(input: NewEmailRecord): Promise<EmailRecord> {
    return mapEmail(
      await this.insert("email_log", {
        order_id: input.orderId,
        report_id: input.reportId,
        kind: input.kind,
        to: input.to,
        subject: input.subject,
        provider_id: input.providerId,
      }),
    );
  }

  async listEmails(orderId: string): Promise<EmailRecord[]> {
    return (await this.rest(`email_log?order_id=eq.${encodeURIComponent(orderId)}&order=sent_at.asc`)).map(mapEmail);
  }
}

/** Data-layer factory (E-F). Copilot Supabase when creds are present (writes
 *  to the dedicated veradis-copilot project — NEVER operating-prod); InMemory
 *  otherwise, or when DATA_BACKEND=memory forces it (tests / local dev). */
export function getRepository(): Repository {
  if (process.env.DATA_BACKEND === "memory") return new InMemoryRepository();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? new SupabaseRepository(url, key) : new InMemoryRepository();
}
