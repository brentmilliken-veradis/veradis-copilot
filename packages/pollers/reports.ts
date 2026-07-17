// Report poller (R-2) — the PULL trigger of the revised ADR-002. Reads the
// shared veradis-accounts `reports` queue (status='in_production'), builds the
// intake from the object's catalogue row + photos, runs the provisional
// pipeline, and lets the delivery bridge write the result back. Idempotent:
// the copilot order row (id = accounts reports.id) marks a produced report, so
// a re-poll only retries the missing half (production or delivery); a failed
// row stays in_production and is retried next tick.

import type { Category } from "@/packages/pcs-types";
import { ALL_CATEGORIES } from "@/packages/pcs-types";
import type {
  AccountsObjectRow,
  AccountsProfileRow,
  AccountsReportRow,
} from "@/packages/adapters/accounts";
import { DuplicateOrderError, type Repository } from "@/packages/data/repository";
import type { Storage } from "@/packages/adapters/storage";
import type { Emailer } from "@/packages/adapters/email";
import { normalizePhoto } from "@/packages/adapters/photos";
import { deliverReport, type DeliveryTarget } from "@/packages/delivery/bridge";
import { runProvisional, type PipelineAdapters } from "@/packages/pipeline/run";
import { toOrderIntake, type ParsedVeradisIntake } from "@/packages/intake/veradis";
import type { PhotoInput } from "@/packages/intake/types";
import { sendCuratorReview } from "@/packages/notify/emails";

export interface ReportPollerAccounts extends DeliveryTarget {
  listInProductionReports(objectId?: string): Promise<AccountsReportRow[]>;
  getObject(objectId: string): Promise<AccountsObjectRow | null>;
  getProfile(userId: string): Promise<AccountsProfileRow | null>;
  downloadObjectPhoto(path: string): Promise<Uint8Array | null>;
}

export interface ReportPollerDeps {
  accounts: ReportPollerAccounts;
  repo: Repository;
  storage: Storage;
  adapters: PipelineAdapters;
  emailer: Emailer;
  /** Injectable clock (staleness window tests). */
  now?: () => Date;
}

export interface ProcessedReport {
  reportId: string;
  outcome: "delivered" | "produced_not_delivered" | "skipped" | "failed";
  tier?: string;
  reason?: string;
}

/** Map the account app's free-text object category onto a copilot Category.
 *  Null = no profile can serve it; the row is left for a human. */
export function mapAccountsCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if ((ALL_CATEGORIES as readonly string[]).includes(v)) return v as Category;
  if (/coin|banknote|numis/.test(v)) return "coins";
  if (/medal|milit/.test(v)) return "medals";
  if (/watch|horolog/.test(v)) return "watches";
  if (/card/.test(v)) return "cards";
  if (/silver|flatware/.test(v)) return "silver";
  if (/paint|art|drawing|print|sculpt|canvas/.test(v)) return "art";
  if (/china|porcelain|ceramic|pottery/.test(v)) return "fine-china";
  return null;
}

/** The owner's catalogue row becomes the declared-attribute hypothesis. Maker
 *  and year are aliased onto the profile's identity vocabulary where they map
 *  cleanly; vision derives the rest from the photos. */
export function declaredAttributesFor(category: Category, obj: AccountsObjectRow): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (obj.title?.trim()) attrs.title = obj.title.trim();
  const maker = obj.maker?.trim();
  const year = obj.year?.trim();
  if (maker) {
    attrs.maker = maker;
    if (category === "art") attrs.artist = maker;
    if (category === "fine-china") attrs.manufactory = maker;
    if (category === "watches") attrs.brand = maker;
  }
  if (year) {
    attrs.year = year;
    if (category === "fine-china") attrs.date_range = year;
  }
  if (obj.notes?.trim()) attrs.notes = obj.notes.trim();
  return attrs;
}

async function downloadPhotos(deps: ReportPollerDeps, obj: AccountsObjectRow): Promise<PhotoInput[]> {
  const photos: PhotoInput[] = [];
  for (const path of obj.photo_paths ?? []) {
    try {
      const bytes = await deps.accounts.downloadObjectPhoto(path); // throws on an unsafe path (F-7)
      if (!bytes) {
        console.warn(`report poller: photo missing in accounts storage: ${path}`);
        continue;
      }
      photos.push(await normalizePhoto(path.split("/").pop() ?? "photo.jpg", bytes));
    } catch (e) {
      console.warn(`report poller: photo skipped (${(e as Error).message}): ${path}`);
    }
  }
  return photos;
}

/** F-5a: production attempts before a row is marked terminally failed. */
export const MAX_PRODUCTION_ATTEMPTS = 3;
/** F-5a: a 'producing' claim older than this is presumed crashed → reclaim. */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/** Produce + deliver one queued accounts report. Also used by the enrich
 *  writer's `reverify` job (the reverify endpoint pre-inserts the row).
 *  F-5a: the copilot orders.id PK is the ATOMIC CLAIM — claim first, produce
 *  after; a throwing pipeline is retried at most MAX_PRODUCTION_ATTEMPTS
 *  times (via the staleness window), then surfaced as failed. */
export async function processAccountsReport(
  deps: ReportPollerDeps,
  row: AccountsReportRow,
): Promise<ProcessedReport> {
  const now = deps.now ?? (() => new Date());
  const existingOrder = await deps.repo.getOrder(row.id);
  let reclaimed = false;

  if (existingOrder) {
    switch (existingOrder.productionState) {
      case "produced": {
        // Production done — retry only the delivery half (crash between
        // produce and write-back), plus the curator email if it was lost (F-12).
        const copilotReport = await deps.repo.getReportByOrderId(row.id); // F-6: bounded lookup
        const version = copilotReport ? await deps.repo.getLatestVersion(copilotReport.id) : null;
        if (!copilotReport || !version) {
          return { reportId: row.id, outcome: "failed", reason: "order exists but no copilot report/version" };
        }
        const redo = await deliverReport(deps.accounts, copilotReport, version);
        return redo.delivered
          ? { reportId: row.id, outcome: "delivered", tier: version.tier ?? undefined, reason: "delivery retried" }
          : { reportId: row.id, outcome: "skipped", reason: `already produced; ${redo.reason}` };
      }
      case "failed":
        // Terminal — surfaced to the curator, never silently re-burnt.
        return { reportId: row.id, outcome: "skipped", reason: `failed previously: ${existingOrder.lastError ?? "see logs"}` };
      case "producing": {
        const claimedAtMs = existingOrder.claimedAt ? Date.parse(existingOrder.claimedAt) : 0;
        if (now().getTime() - claimedAtMs < STALE_CLAIM_MS) {
          return { reportId: row.id, outcome: "skipped", reason: "claimed by another tick" };
        }
        if (existingOrder.attempts >= MAX_PRODUCTION_ATTEMPTS) {
          await deps.repo.updateOrder(row.id, {
            productionState: "failed",
            lastError: existingOrder.lastError ?? "max production attempts exhausted",
          });
          return { reportId: row.id, outcome: "failed", reason: "max production attempts exhausted" };
        }
        // Crash recovery: reclaim the stale row and try again.
        await deps.repo.updateOrder(row.id, { claimedAt: now().toISOString(), attempts: existingOrder.attempts + 1 });
        reclaimed = true;
        break;
      }
    }
  }

  // Cheap reads BEFORE the claim — a row that can never produce is rejected
  // without consuming an order row / attempt.
  const obj = await deps.accounts.getObject(row.object_id);
  if (!obj) return { reportId: row.id, outcome: "failed", reason: `object ${row.object_id} not found` };
  // F-4: never produce/deliver across tenants — the report row's user must own
  // the object it points at.
  if (obj.user_id !== row.user_id) {
    return { reportId: row.id, outcome: "failed", reason: "object/owner mismatch" };
  }

  const category = mapAccountsCategory(obj.category);
  if (!category) {
    return { reportId: row.id, outcome: "skipped", reason: `unmapped category "${obj.category}"` };
  }

  const profile = await deps.accounts.getProfile(row.user_id);
  if (!profile?.email) return { reportId: row.id, outcome: "failed", reason: "collector profile/email not found" };

  const parsed: ParsedVeradisIntake = {
    reportId: row.id,
    objectId: obj.id,
    userId: row.user_id,
    email: profile.email,
    ownerName: profile.full_name,
    category,
    sku: row.type === "appraise" ? "appraise" : "verify",
    title: obj.title || null,
    declaredAttributes: declaredAttributesFor(category, obj),
    photoPaths: obj.photo_paths ?? [],
  };

  // The claim: first tick to insert the order owns production.
  if (!reclaimed) {
    try {
      await deps.repo.createOrder({
        id: parsed.reportId,
        tallySubmissionId: `veradis:${parsed.reportId}`,
        email: parsed.email,
        ownerName: parsed.ownerName,
        category: parsed.category,
        sku: parsed.sku,
        productionState: "producing",
        attempts: 1,
        claimedAt: now().toISOString(),
      });
    } catch (e) {
      if (e instanceof DuplicateOrderError) {
        return { reportId: row.id, outcome: "skipped", reason: "claimed by another tick" };
      }
      throw e;
    }
  }
  const order = (await deps.repo.getOrder(row.id))!;

  // Production. A throw records the attempt; retry happens after the
  // staleness window, up to MAX_PRODUCTION_ATTEMPTS.
  let result;
  try {
    const photos = await downloadPhotos(deps, obj);
    if (!photos.length) throw new Error("no photos downloadable");
    result = await runProvisional(deps.repo, deps.storage, deps.adapters, toOrderIntake(parsed, photos));
  } catch (e) {
    const message = (e as Error).message;
    const terminal = order.attempts >= MAX_PRODUCTION_ATTEMPTS;
    await deps.repo.updateOrder(row.id, {
      ...(terminal ? { productionState: "failed" as const } : {}),
      lastError: message,
    });
    console.error(`report poller ${row.id}: production attempt ${order.attempts} failed:`, e);
    return { reportId: row.id, outcome: "failed", reason: message };
  }
  await deps.repo.updateOrder(row.id, { productionState: "produced", lastError: null });

  const delivery = await deliverReport(deps.accounts, result.report, result.version);

  if (result.report.status === "provisional") {
    await sendCuratorReview(deps.repo, deps.emailer, order, result.report.id, result.score.tier); // EMAIL B
  }

  if (!delivery.delivered) {
    console.warn(`report poller ${row.id}: produced but not delivered — ${delivery.reason}`);
    return { reportId: row.id, outcome: "produced_not_delivered", tier: result.score.tier, reason: delivery.reason };
  }
  return { reportId: row.id, outcome: "delivered", tier: result.score.tier };
}

export interface PollSummary {
  polled: number;
  delivered: number;
  skipped: number;
  failed: number;
  results: ProcessedReport[];
}

/** One cron tick: drain the in_production queue, isolating failures per row. */
export async function pollReports(deps: ReportPollerDeps): Promise<PollSummary> {
  const rows = await deps.accounts.listInProductionReports();
  const results: ProcessedReport[] = [];
  for (const row of rows) {
    try {
      results.push(await processAccountsReport(deps, row));
    } catch (e) {
      console.error(`report poller: ${row.id} failed:`, e);
      results.push({ reportId: row.id, outcome: "failed", reason: (e as Error).message });
    }
  }
  return {
    polled: rows.length,
    delivered: results.filter((r) => r.outcome === "delivered").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };
}
