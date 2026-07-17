// veradis-accounts client — the ONLY surface this repo has onto the live
// verify.veradis.ai account store (Supabase project veradis-accounts). Strictly
// one-directional per ADR-002: read object photos in (intake, E-C) and write
// finished reports back onto the collector's `reports` row (delivery, E-D).
// Never touches any other table; never used for copilot persistence.

const OBJECT_PHOTOS_BUCKET = "object-photos"; // objects.photo_paths point here
const REPORT_FILES_BUCKET = "report-files"; // reports.file_path points here

/** The slice of a veradis-accounts `reports` row the bridge needs. */
export interface AccountsReportRow {
  id: string;
  user_id: string;
  object_id: string;
  type: string;
  status: string;
}

/** Patch applied to a veradis-accounts `reports` row on delivery. */
export interface AccountsReportPatch {
  status: "delivered";
  file_path: string;
  pcs_score?: number;
  valuation?: string;
  delivered_at: string;
}

function encodePath(key: string): string {
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

  /** Download an object photo by its `photo_paths` entry (service-role read). */
  async downloadObjectPhoto(path: string): Promise<Uint8Array | null> {
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/storage/v1/object/${OBJECT_PHOTOS_BUCKET}/${encodePath(path)}`,
      { headers: this.headers() },
    );
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new Error(`accounts photo download ${res.status} ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Read the `reports` row the bridge is about to write (path needs user_id). */
  async getReport(reportId: string): Promise<AccountsReportRow | null> {
    const res = await fetch(
      `${this.url.replace(/\/$/, "")}/rest/v1/reports?id=eq.${encodeURIComponent(reportId)}&select=id,user_id,object_id,type,status`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`accounts report read ${res.status} ${await res.text()}`);
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
        headers: { ...this.headers(), "content-type": "text/html", "x-upsert": "true" },
        body: html,
      },
    );
    if (!res.ok) throw new Error(`accounts report upload ${res.status} ${await res.text()}`);
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
    if (!res.ok) throw new Error(`accounts report update ${res.status} ${await res.text()}`);
  }
}

/** Factory — the client exists only when the accounts env is present. */
export function getAccountsClient(): VeradisAccountsClient | null {
  const url = process.env.VERADIS_ACCOUNTS_URL;
  const key = process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY;
  return url && key ? new VeradisAccountsClient(url, key) : null;
}
