// Enrich living-layer writer (R-3) — the engine half of the account-template's
// job-queue contract. Reads veradis-accounts `enrichment_jobs` (status=queued),
// marks each running, and writes findings into the living-layer tables in
// exactly the shapes api/admin-enrich.js uses: enrichment_events, object_links,
// collection_valuation, and the objects enrich columns. Honesty rules hold:
// - links are deterministic catalogue cross-references (shared maker), never
//   invented relations;
// - narratives are Claude prose from the owner's own catalogue entry (sourced
//   as such), never new facts — and never a number;
// - the collection valuation is only ever rolled up from DELIVERED appraisal
//   bands; with none, nothing is written (no invented value).

import type {
  AccountsJobRow,
  AccountsObjectRow,
  AccountsEventInsert,
  AccountsLinkInsert,
  AccountsObjectEnrichPatch,
  AccountsValuationUpsert,
} from "@/packages/adapters/accounts";
import type { NarrativeAdapter } from "@/packages/adapters/narrative";
import {
  processAccountsReport,
  type ReportPollerAccounts,
  type ReportPollerDeps,
} from "@/packages/pollers/reports";

export interface EnrichAccounts extends ReportPollerAccounts {
  listQueuedJobs(): Promise<AccountsJobRow[]>;
  updateJob(
    jobId: string,
    patch: { status: AccountsJobRow["status"]; started_at?: string; finished_at?: string; detail?: string },
  ): Promise<void>;
  /** Conditional queued→running claim; false = another tick owns it (F-5b). */
  claimJob(jobId: string, startedAt: string): Promise<boolean>;
  listObjects(userId: string): Promise<AccountsObjectRow[]>;
  listDeliveredAppraisals(userId: string): Promise<{ object_id: string; valuation: string | null }[]>;
  insertEvent(e: AccountsEventInsert): Promise<void>;
  insertLink(l: AccountsLinkInsert): Promise<void>;
  updateObjectEnrich(objectId: string, userId: string, patch: AccountsObjectEnrichPatch): Promise<void>;
  upsertValuation(v: AccountsValuationUpsert): Promise<void>;
}

export interface EnrichDeps extends ReportPollerDeps {
  accounts: EnrichAccounts;
}

/** Injectable clock (inherited from ReportPollerDeps.now) as ISO 8601. */
const nowIso = (deps: EnrichDeps): string => (deps.now ? deps.now() : new Date()).toISOString();

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** First plausible calendar year in the owner's free-text date ("c. 1927"). */
export function parseTimelineDate(year: string | null): string | null {
  const m = year?.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? `${m[1]}-01-01` : null;
}

/** Parse the delivery bridge's valuation band format: "CAD 100–200". */
export function parseValuationBand(v: string | null): { currency: string; lo: number; hi: number } | null {
  const m = v?.match(/^(\S+)\s+([\d.]+)\s*[–-]\s*([\d.]+)$/);
  if (!m) return null;
  const lo = Number(m[2]);
  const hi = Number(m[3]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || (lo === 0 && hi === 0)) return null;
  return { currency: m[1], lo, hi };
}

const normMaker = (m: string | null): string | null => {
  const v = m?.trim().toLowerCase();
  return v && v.length > 1 ? v : null;
};

// ── ops (each mirrors an admin-enrich.js op) ────────────────────────────────

/** Catalogue cross-reference: objects sharing a maker become graph edges. */
async function writeLinks(deps: EnrichDeps, userId: string, objects: AccountsObjectRow[], onlyFrom?: string): Promise<number> {
  const byMaker = new Map<string, AccountsObjectRow[]>();
  for (const o of objects) {
    const m = normMaker(o.maker);
    if (!m) continue;
    byMaker.set(m, [...(byMaker.get(m) ?? []), o]);
  }
  let written = 0;
  for (const group of byMaker.values()) {
    if (group.length < 2) continue;
    const [head, ...rest] = group;
    for (const other of rest) {
      const from = onlyFrom ? group.find((g) => g.id === onlyFrom) : head;
      if (!from || other.id === from.id) continue;
      if (onlyFrom && from.id !== onlyFrom) continue;
      await deps.accounts.insertLink({
        user_id: userId,
        from_object: from.id,
        to_object: other.id,
        relation: "same maker",
        source: "veradis engine — catalogue cross-reference",
        confidence: 0.6,
      });
      await deps.accounts.insertEvent({
        user_id: userId,
        object_id: from.id,
        type: "link_found",
        title: "Link found.",
        body: `“${from.title}” and “${other.title}” share a maker: ${from.maker}.`,
        action_url: `/object?id=${from.id}`,
      });
      await deps.accounts.updateObjectEnrich(from.id, userId, { enriched_state: "linked" });
      await deps.accounts.updateObjectEnrich(other.id, userId, { enriched_state: "linked" });
      written++;
    }
  }
  return written;
}

/** Sourced narrative from the owner's own catalogue entry — prose only. */
async function writeNarrative(deps: EnrichDeps, userId: string, obj: AccountsObjectRow): Promise<void> {
  const narrative: NarrativeAdapter = deps.adapters.narrative;
  const attrs: Record<string, string> = {};
  if (obj.maker?.trim()) attrs.maker = obj.maker.trim();
  if (obj.year?.trim()) attrs.year = obj.year.trim();
  if (obj.category?.trim()) attrs.category = obj.category.trim();
  if (obj.notes?.trim()) attrs.notes = obj.notes.trim();

  const sections = await narrative.draft({
    title: obj.title,
    category: obj.category ?? "object",
    resolvedAttributes: attrs,
    tier: "bronze", // tone only — the record is the owner's declaration
    corrections: [],
  });
  const html = sections.map((sec) => `<p>${esc(sec.body)}</p>`).join("");

  await deps.accounts.updateObjectEnrich(obj.id, userId, {
    narrative_html: html,
    narrative_sources: ["Owner catalogue entry"],
    timeline_date: parseTimelineDate(obj.year),
  });
  await deps.accounts.insertEvent({
    user_id: userId,
    object_id: obj.id,
    type: "narrative_added",
    title: "Story added.",
    body: `A sourced narrative is now on ${obj.title}.`,
    action_url: `/object?id=${obj.id}`,
  });
}

/** Roll delivered appraisal bands up into collection_valuation. Returns what
 *  was written, or null when there is nothing honest to write. */
async function writeValuation(
  deps: EnrichDeps,
  userId: string,
  objects: AccountsObjectRow[],
): Promise<AccountsValuationUpsert | null> {
  const appraisals = await deps.accounts.listDeliveredAppraisals(userId);
  const bands = appraisals
    .map((a) => ({ objectId: a.object_id, band: parseValuationBand(a.valuation) }))
    .filter((a): a is { objectId: string; band: NonNullable<ReturnType<typeof parseValuationBand>> } => !!a.band);
  if (!bands.length) return null; // no appraised values → no invented number

  const appraisedObjects = new Set(bands.map((b) => b.objectId));
  const v: AccountsValuationUpsert = {
    user_id: userId,
    low: bands.reduce((a, b) => a + b.band.lo, 0),
    high: bands.reduce((a, b) => a + b.band.hi, 0),
    currency: bands[0].band.currency,
    basis: objects.length > 0 && objects.every((o) => appraisedObjects.has(o.id)) ? "full" : "partial",
    updated_at: nowIso(deps),
  };
  await deps.accounts.upsertValuation(v);
  await deps.accounts.insertEvent({
    user_id: userId,
    type: "value_changed",
    title: "Value updated.",
    body: "Your indicative collection value has been refreshed.",
    action_url: "/collections",
  });
  return v;
}

// ── per-kind handlers ───────────────────────────────────────────────────────

async function handleFirstPass(deps: EnrichDeps, job: AccountsJobRow): Promise<string> {
  const objects = await deps.accounts.listObjects(job.user_id);
  if (!objects.length) return "no objects in the collection — nothing to enrich";
  const links = await writeLinks(deps, job.user_id, objects);
  for (const obj of objects) await writeNarrative(deps, job.user_id, obj);
  const valuation = await writeValuation(deps, job.user_id, objects);
  return [
    `${links} link(s)`,
    `${objects.length} narrative(s)`,
    valuation ? `valuation ${valuation.currency} ${valuation.low}–${valuation.high} (${valuation.basis})` : "no appraised values yet — valuation not written",
  ].join(" · ");
}

async function handleReverify(deps: EnrichDeps, job: AccountsJobRow): Promise<string> {
  if (!job.object_id) throw new Error("reverify job has no object_id");
  // F-4: the job's object must belong to the job's user.
  const owned = await deps.accounts.getObject(job.object_id);
  if (!owned || owned.user_id !== job.user_id) throw new Error("object/owner mismatch — nothing re-verified");
  // The reverify endpoint pre-inserted the in_production reports row; run it
  // through the same producer the report poller uses (dedupe included).
  // F-4: only rows owned by the job's user are eligible.
  const rows = (await deps.accounts.listInProductionReports(job.object_id)).filter(
    (r) => r.user_id === job.user_id,
  );
  if (!rows.length) throw new Error("no in_production reports row for this object — nothing to re-verify");
  const outcomes: string[] = [];
  for (const row of rows) {
    const res = await processAccountsReport(deps, row);
    if (res.outcome === "failed") throw new Error(`report ${row.id}: ${res.reason}`);
    outcomes.push(`${row.id}: ${res.outcome}${res.tier ? ` (${res.tier})` : ""}`);
    if (res.outcome === "delivered") {
      const obj = await deps.accounts.getObject(job.object_id);
      await deps.accounts.insertEvent({
        user_id: job.user_id,
        object_id: job.object_id,
        type: "value_changed",
        title: "Re-verify complete.",
        body: `A fresh result is on ${obj?.title ?? "your object"} — every source named, as before.`,
        action_url: `/object?id=${job.object_id}`,
      });
    }
  }
  return outcomes.join(" · ");
}

async function handleRelink(deps: EnrichDeps, job: AccountsJobRow): Promise<string> {
  const objects = await deps.accounts.listObjects(job.user_id);
  const links = await writeLinks(deps, job.user_id, objects, job.object_id ?? undefined);
  return `${links} link(s)`;
}

async function handleRevalue(deps: EnrichDeps, job: AccountsJobRow): Promise<string> {
  const objects = await deps.accounts.listObjects(job.user_id);
  const valuation = await writeValuation(deps, job.user_id, objects);
  return valuation
    ? `valuation ${valuation.currency} ${valuation.low}–${valuation.high} (${valuation.basis})`
    : "no appraised values yet — nothing written";
}

async function handleNarrative(deps: EnrichDeps, job: AccountsJobRow): Promise<string> {
  if (!job.object_id) throw new Error("narrative job has no object_id");
  const obj = await deps.accounts.getObject(job.object_id);
  if (!obj) throw new Error(`object ${job.object_id} not found`);
  // F-4: never write another tenant's object.
  if (obj.user_id !== job.user_id) throw new Error("object/owner mismatch — nothing written");
  await writeNarrative(deps, job.user_id, obj);
  return `narrative written for “${obj.title}”`;
}

const HANDLERS: Record<AccountsJobRow["kind"], (deps: EnrichDeps, job: AccountsJobRow) => Promise<string>> = {
  first_pass: handleFirstPass,
  reverify: handleReverify,
  relink: handleRelink,
  revalue: handleRevalue,
  narrative: handleNarrative,
};

export interface EnrichSummary {
  polled: number;
  done: number;
  failed: number;
  skipped: number;
  results: { jobId: string; kind: string; status: "done" | "failed" | "skipped"; detail: string }[];
}

/** One cron tick: queued → (atomic claim) running → done | failed+detail. */
export async function runEnrichmentJobs(deps: EnrichDeps): Promise<EnrichSummary> {
  const now = () => nowIso(deps);
  const jobs = await deps.accounts.listQueuedJobs();
  const results: EnrichSummary["results"] = [];
  for (const job of jobs) {
    // F-5b: conditional claim — a concurrent tick that lost the PATCH race skips.
    const claimed = await deps.accounts.claimJob(job.id, now());
    if (!claimed) {
      results.push({ jobId: job.id, kind: job.kind, status: "skipped", detail: "claimed by another tick" });
      continue;
    }
    try {
      const detail = await HANDLERS[job.kind](deps, job);
      await deps.accounts.updateJob(job.id, { status: "done", finished_at: now(), detail });
      results.push({ jobId: job.id, kind: job.kind, status: "done", detail });
    } catch (e) {
      const detail = (e as Error).message;
      console.error(`enrich writer: job ${job.id} (${job.kind}) failed:`, e);
      await deps.accounts.updateJob(job.id, { status: "failed", finished_at: now(), detail });
      results.push({ jobId: job.id, kind: job.kind, status: "failed", detail });
    }
  }
  return {
    polled: jobs.length,
    done: results.filter((r) => r.status === "done").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  };
}
