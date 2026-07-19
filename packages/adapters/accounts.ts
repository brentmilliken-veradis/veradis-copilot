// veradis-accounts client — the ONLY surface this repo has onto the live
// verify.veradis.ai account store (Supabase project veradis-accounts). The
// revised ADR-002 PULL contract: the engine READS the shared queues (`reports`
// in_production, `enrichment_jobs` queued) plus the objects/profiles/photos it
// needs to fulfil them, and WRITES back `reports` rows and the living-layer
// tables (enrichment_events, object_links, threads, collection_valuation, the
// objects enrich columns) — mirroring the account-template's admin-enrich.js /
// admin-deliver-report.js shapes exactly. Nothing else, ever; the schema and
// the account app belong to the account-template session.

const OBJECT_PHOTOS_BUCKET = "object-photos"; // objects.photo_paths point here

/** F-12: upstream error bodies are logged server-side, never thrown — thrown
 *  messages become per-row `reason`/`detail` strings on the cron surface. */
async function failUpstream(label: string, res: Response): Promise<never> {
  console.error(`${label} ${res.status}: ${await res.text()}`);
  throw new Error(`${label} ${res.status}`);
}

const REPORT_FILES_BUCKET = "report-files"; // reports.file_path points here

/** The slice of a veradis-accounts `reports` row the bridge needs. */
export interface AccountsReportRow {
  id: string;
  user_id: string;
  object_id: string;
  type: string;
  status: string;
}

/** Patch applied to a veradis-accounts `reports` row. A delivery writes the
 *  rendered report + score; a refund state (unscored / withheld) writes only a
 *  terminal `refunded` status so the row never sits in_production forever. */
export type AccountsReportPatch =
  | {
      status: "delivered";
      file_path: string;
      pcs_score?: number;
      valuation?: string;
      /** Sealed tier (gold/silver/bronze/flagged) for the account's colour chip.
       *  Written even when pcs_score is suppressed (capped/downgraded): the tier
       *  itself is honest — a capped report is 'flagged', a downgrade is the
       *  lower sealed tier — so the chip never implies a confidence not sealed. */
      tier?: string;
      delivered_at: string;
    }
  | { status: "refunded" };

/** The slice of a veradis-accounts `objects` row the engine reads. */
export interface AccountsObjectRow {
  id: string;
  user_id: string;
  title: string;
  maker: string | null;
  year: string | null;
  category: string | null;
  notes: string | null;
  photo_paths: string[];
}

export interface AccountsProfileRow {
  id: string;
  email: string;
  full_name: string | null;
}

/** A queued enrichment job (accounts migration 0003). */
export interface AccountsJobRow {
  id: string;
  user_id: string;
  object_id: string | null;
  kind: "first_pass" | "reverify" | "relink" | "revalue" | "narrative";
  status: "queued" | "running" | "done" | "failed";
  detail: string | null;
}

/** enrichment_events insert shape (types per accounts migration 0002).
 *
 *  F-9 CONTRACT (verified against the account app, collections.html feedItem:
 *  both title and body render through esc() as text): event `title`/`body`
 *  are PLAIN TEXT. The engine deliberately does NOT HTML-escape them —
 *  escaping into a text field double-encodes. If the account-template ever
 *  renders the feed as HTML, escaping must move here — raise it with them
 *  before any such change. */
export interface AccountsEventInsert {
  user_id: string;
  object_id?: string | null;
  type:
    | "welcome"
    | "link_found"
    | "evidence_corroborated"
    | "date_corrected"
    | "reverify_due"
    | "reverify_started"
    | "value_changed"
    | "narrative_added"
    | "thread_opened"
    | "thread_resolved";
  title?: string | null;
  body?: string | null;
  action_url?: string | null;
}

export interface AccountsLinkInsert {
  user_id: string;
  from_object: string;
  to_object?: string | null;
  external_ref?: string | null;
  relation?: string | null;
  source?: string | null;
  confidence?: number | null;
}

export interface AccountsThreadInsert {
  user_id: string;
  object_id?: string | null;
  question: string;
  evidence_needed?: string | null;
  status: "open" | "resolved";
  resolved_at?: string | null;
}

export interface AccountsValuationUpsert {
  user_id: string;
  low: number | null;
  high: number | null;
  currency: string;
  basis: "full" | "partial";
  updated_at: string;
}

/** The `objects` enrich columns (accounts migration 0002) — the ONLY object
 *  fields the engine may write. */
export interface AccountsObjectEnrichPatch {
  narrative_html?: string;
  narrative_sources?: string[];
  timeline_date?: string | null;
  enriched_state?: "linked" | "corroborated" | "flagged" | "reverify_due" | null;
}

/** F-7: encodeURIComponent leaves '.' and '..' intact, so a hostile
 *  photo_paths entry like 'a/../../b' would escape the bucket. Reject any
 *  path with an empty/dot segment, a leading slash, or a backslash. */
export function assertSafeStoragePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new Error("unsafe storage path rejected");
  }
  for (const segment of path.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("unsafe storage path rejected");
    }
  }
}

function encodePath(key: string): string {
  assertSafeStoragePath(key);
  return key.split("/").map(encodeURIComponent).join("/");
}

export class VeradisAccountsClient {
  constructor(
    private url: string, // e.g. https://<accounts-ref>.supabase.co
    private serviceKey: string,
  ) {}

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }

  /** PostgREST round-trip; returns rows (writes use return=minimal → []). */
  private async rest(pathAndQuery: string, init: RequestInit = {}): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`, {
      ...init,
      headers: {
        ...this.headers(),
        "content-type": "application/json",
        ...(init.method && init.method !== "GET" ? { prefer: "return=minimal" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) await failUpstream(`accounts ${init.method ?? "GET"} ${pathAndQuery} →`, res);
    const text = await res.text();
    if (!text) return [];
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
  }

  // ── queue + context reads (PULL contract) ─────────────────────────────────

  /** Paid orders awaiting production — the report poller's work list. */
  async listInProductionReports(objectId?: string): Promise<AccountsReportRow[]> {
    const filter = objectId ? `&object_id=eq.${encodeURIComponent(objectId)}` : "";
    return (await this.rest(
      `reports?status=eq.in_production${filter}&select=id,user_id,object_id,type,status&order=created_at.asc`,
    )) as unknown as AccountsReportRow[];
  }

  async getObject(objectId: string): Promise<AccountsObjectRow | null> {
    const rows = (await this.rest(
      `objects?id=eq.${encodeURIComponent(objectId)}&select=id,user_id,title,maker,year,category,notes,photo_paths`,
    )) as unknown as AccountsObjectRow[];
    return rows[0] ?? null;
  }

  async listObjects(userId: string): Promise<AccountsObjectRow[]> {
    return (await this.rest(
      `objects?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,title,maker,year,category,notes,photo_paths&order=created_at.asc`,
    )) as unknown as AccountsObjectRow[];
  }

  async getProfile(userId: string): Promise<AccountsProfileRow | null> {
    const rows = (await this.rest(
      `profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,full_name`,
    )) as unknown as AccountsProfileRow[];
    return rows[0] ?? null;
  }

  async listQueuedJobs(): Promise<AccountsJobRow[]> {
    return (await this.rest(
      `enrichment_jobs?status=eq.queued&select=id,user_id,object_id,kind,status,detail&order=created_at.asc`,
    )) as unknown as AccountsJobRow[];
  }

  /** Delivered appraisals feed the rolled-up collection valuation. */
  async listDeliveredAppraisals(userId: string): Promise<{ object_id: string; valuation: string | null }[]> {
    return (await this.rest(
      `reports?user_id=eq.${encodeURIComponent(userId)}&type=eq.appraise&status=eq.delivered&select=object_id,valuation`,
    )) as unknown as { object_id: string; valuation: string | null }[];
  }

  // ── living-layer writes (mirror admin-enrich.js) ──────────────────────────

  async updateJob(
    jobId: string,
    patch: { status: AccountsJobRow["status"]; started_at?: string; finished_at?: string; detail?: string },
  ): Promise<void> {
    await this.rest(`enrichment_jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  /** F-5b (COORDINATE) — conditional claim: queued → running only when still
   *  queued. Returns false when another tick already owns the job. Uses only
   *  the existing enrichment_jobs columns/status values. */
  async claimJob(jobId: string, startedAt: string): Promise<boolean> {
    const rows = await this.rest(
      `enrichment_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.queued`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ status: "running", started_at: startedAt }),
      },
    );
    return rows.length > 0;
  }

  /** B3 (COORDINATE) — self-heal enrichment jobs stranded `running` by a crash
   *  between claimJob (queued→running) and the terminal updateJob. Mirrors the
   *  report poller's STALE_CLAIM_MS reclaim: any `running` job whose claim
   *  (started_at) predates the cutoff is atomically flipped back to `queued` so
   *  the next listQueuedJobs pass re-runs it. Race-safe — the conditional
   *  filter (status=running AND started_at<cutoff) means only the first tick's
   *  UPDATE matches; a concurrent tick re-evaluates against `queued` and
   *  touches nothing. Uses only existing enrichment_jobs columns. Returns the
   *  reclaimed rows (for logging). */
  async reclaimStaleRunningJobs(cutoffIso: string): Promise<AccountsJobRow[]> {
    return (await this.rest(
      `enrichment_jobs?status=eq.running&started_at=lt.${encodeURIComponent(cutoffIso)}&select=id,user_id,object_id,kind,status,detail`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          status: "queued",
          started_at: null,
          detail: "auto-requeued: running claim went stale",
        }),
      },
    )) as unknown as AccountsJobRow[];
  }

  async insertEvent(e: AccountsEventInsert): Promise<void> {
    await this.rest("enrichment_events", { method: "POST", body: JSON.stringify(e) });
  }

  async insertLink(l: AccountsLinkInsert): Promise<void> {
    await this.rest("object_links", { method: "POST", body: JSON.stringify(l) });
  }

  async insertThread(t: AccountsThreadInsert): Promise<void> {
    await this.rest("threads", { method: "POST", body: JSON.stringify(t) });
  }

  async upsertValuation(v: AccountsValuationUpsert): Promise<void> {
    await this.rest("collection_valuation?on_conflict=user_id", {
      method: "POST",
      headers: { prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(v),
    });
  }

  /** Write the enrich columns on an object — scoped by user_id as well, the
   *  same double filter admin-enrich uses. */
  async updateObjectEnrich(objectId: string, userId: string, patch: AccountsObjectEnrichPatch): Promise<void> {
    await this.rest(
      `objects?id=eq.${encodeURIComponent(objectId)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
  }

  /** Download an object photo by its `photo_paths` entry (service-role read). */
  async downloadObjectPhoto(path: string): Promise<Uint8Array | null> {
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/storage/v1/object/${OBJECT_PHOTOS_BUCKET}/${encodePath(path)}`,
      { headers: this.headers() },
    );
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) await failUpstream("accounts photo download", res);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Read the `reports` row the bridge is about to write (path needs user_id). */
  async getReport(reportId: string): Promise<AccountsReportRow | null> {
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/rest/v1/reports?id=eq.${encodeURIComponent(reportId)}&select=id,user_id,object_id,type,status`,
      { headers: this.headers() },
    );
    if (!res.ok) await failUpstream("accounts report read", res);
    const rows = (await res.json()) as AccountsReportRow[];
    return rows[0] ?? null;
  }

  /** Store a rendered report file; returns the `reports.file_path` value. */
  async uploadReportFile(userId: string, reportId: string, html: string): Promise<string> {
    const path = `${userId}/${reportId}.html`; // matches the store's RLS layout
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/storage/v1/object/${REPORT_FILES_BUCKET}/${encodePath(path)}`,
      {
        method: "POST",
        headers: { ...this.headers(), "content-type": "text/html; charset=utf-8", "x-upsert": "true" },
        body: html,
      },
    );
    if (!res.ok) await failUpstream("accounts report upload", res);
    return path;
  }

  /** Write the delivery back onto the collector's `reports` row (PostgREST). */
  async updateReport(reportId: string, patch: AccountsReportPatch): Promise<void> {
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/rest/v1/reports?id=eq.${encodeURIComponent(reportId)}`,
      {
        method: "PATCH",
        headers: { ...this.headers(), "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) await failUpstream("accounts report update", res);
  }
}

/** Factory — the client exists only when the accounts env is present. */
export function getAccountsClient(): VeradisAccountsClient | null {
  const url = process.env.VERADIS_ACCOUNTS_URL;
  const key = process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY;
  return url && key ? new VeradisAccountsClient(url, key) : null;
}
