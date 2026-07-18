// Report poller (R-2) — the PULL trigger of the revised ADR-002. Reads the
// shared veradis-accounts `reports` queue (status='in_production'), builds the
// intake from the object's catalogue row + photos, runs the provisional
// pipeline, and lets the delivery bridge write the result back. Idempotent:
// the copilot order row (id = accounts reports.id) marks a produced report, so
// a re-poll only retries the missing half (production or delivery); a failed
// row stays in_production and is retried next tick.

import type { Category, Tier } from "@/packages/pcs-types";
import { ALL_CATEGORIES } from "@/packages/pcs-types";
import type {
  AccountsObjectRow,
  AccountsProfileRow,
  AccountsReportRow,
} from "@/packages/adapters/accounts";
import { DuplicateOrderError, type Order, type Repository } from "@/packages/data/repository";
import type { Storage } from "@/packages/adapters/storage";
import type { Emailer } from "@/packages/adapters/email";
import { normalizePhoto } from "@/packages/adapters/photos";
import { deliverReport, settleRefund, type DeliveryTarget } from "@/packages/delivery/bridge";
import { runProvisional, type PipelineAdapters } from "@/packages/pipeline/run";
import { toOrderIntake, type ParsedVeradisIntake } from "@/packages/intake/veradis";
import { categoryHasProfile } from "@/packages/profiles/loader";
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
  outcome: "delivered" | "produced_not_delivered" | "skipped" | "failed" | "refunded";
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

/** F-12: EMAIL B must never sink a row. Failure is logged; the R-5 sweep
 *  re-sends it on a later tick (the email_log is the dedupe). */
async function sendCuratorReviewSafely(
  deps: ReportPollerDeps,
  order: Order,
  reportId: string,
  tier: Tier,
): Promise<void> {
  try {
    await sendCuratorReview(deps.repo, deps.emailer, order, reportId, tier);
  } catch (e) {
    console.error(`report poller ${order.id}: curator review email failed (sweep will retry):`, e);
  }
}

/** How many provisional reports one sweep tick inspects (bounded — F-6). */
const CURATOR_EMAIL_SWEEP_LIMIT = 50;

/** R-5: queue-INDEPENDENT curator-email self-heal. A delivery that succeeded
 *  takes the accounts row out of in_production, so a lost EMAIL B can never be
 *  healed off that queue. Instead: any copilot report still provisional with
 *  no curator_review entry in the copilot email_log gets a resend; email_log
 *  is the dedupe, so a sent email is never sent twice. */
export async function sweepCuratorEmails(deps: ReportPollerDeps): Promise<number> {
  const provisional = await deps.repo.listReportsByStatus("provisional", CURATOR_EMAIL_SWEEP_LIMIT);
  let resent = 0;
  for (const report of provisional) {
    try {
      const emails = await deps.repo.listEmails(report.orderId);
      if (emails.some((e) => e.kind === "curator_review")) continue;
      const order = await deps.repo.getOrder(report.orderId);
      if (!order) continue; // e.g. the dev-seeded fixture report
      const version = await deps.repo.getLatestVersion(report.id);
      await sendCuratorReview(deps.repo, deps.emailer, order, report.id, version?.tier ?? "bronze");
      resent++;
    } catch (e) {
      console.error(`curator email sweep: resend failed for report ${report.id} (will retry next tick):`, e);
    }
  }
  return resent;
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
/** B4: delivery (accounts write-back) retries on an already-produced order
 *  before we give up. Production is capped by MAX_PRODUCTION_ATTEMPTS; delivery
 *  had no cap, so a permanently-failing write-back retried every tick forever. */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** B4: a produced report whose delivery keeps failing (accounts unreachable or
 *  rejecting the write) must not retry on every tick indefinitely. Bump
 *  orders.delivery_attempts; at the cap, give up — mark the order failed, settle
 *  the paid row to `refunded` (never leave it in_production), and escalate. */
async function boundDeliveryRetry(
  deps: ReportPollerDeps,
  row: AccountsReportRow,
  order: Order,
  tier: string | undefined,
  reason: string,
): Promise<ProcessedReport> {
  const deliveryAttempts = (order.deliveryAttempts ?? 0) + 1;
  if (deliveryAttempts >= MAX_DELIVERY_ATTEMPTS) {
    await deps.repo.updateOrder(row.id, {
      productionState: "failed",
      deliveryAttempts,
      lastError: `delivery unrecoverable after ${deliveryAttempts} attempts: ${reason}`,
    });
    // Never leave the paid row in_production — settle it to refunded (B1/B2).
    await settleRefund(deps.accounts, row.id);
    console.error(`report poller ${row.id}: delivery gave up after ${deliveryAttempts} attempts (${reason}) — settled refunded`);
    return { reportId: row.id, outcome: "refunded", tier, reason: `delivery unrecoverable: ${reason}` };
  }
  await deps.repo.updateOrder(row.id, { deliveryAttempts });
  return {
    reportId: row.id,
    outcome: "produced_not_delivered",
    tier,
    reason: `delivery retry ${deliveryAttempts}/${MAX_DELIVERY_ATTEMPTS}: ${reason}`,
  };
}

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
        // (Curator-email recovery lives in sweepCuratorEmails — R-5. This
        // branch only fires while the accounts row is still in_production, so
        // it could never heal an email lost AFTER a successful delivery.)
        let redo;
        try {
          redo = await deliverReport(deps.accounts, copilotReport, version);
        } catch (e) {
          // B4: delivery THREW (accounts unreachable / rejected the PATCH) —
          // the common unbounded-retry vector. Bound it rather than re-raising
          // to a per-tick failure that never gives up.
          return boundDeliveryRetry(deps, row, existingOrder, version.tier ?? undefined, (e as Error).message);
        }
        if (redo.settled === "refunded") {
          // A produced refund-state report (e.g. unscored) that never settled
          // last tick now resolves the accounts row to `refunded`.
          return { reportId: row.id, outcome: "refunded", tier: version.tier ?? undefined, reason: "settled: refunded" };
        }
        if (redo.delivered) {
          return { reportId: row.id, outcome: "delivered", tier: version.tier ?? undefined, reason: "delivery retried" };
        }
        // B4: produced, delivery returned not-delivered (e.g. the accounts row
        // vanished) — bound the retries the same way.
        return boundDeliveryRetry(deps, row, existingOrder, version.tier ?? undefined, redo.reason ?? "not delivered");
      }
      case "failed":
        // Terminal — never re-burnt. Settle the paid row to `refunded` (idempotent;
        // recovers a settlement that failed on the terminal tick) so it can never
        // sit in_production forever.
        await settleRefund(deps.accounts, row.id);
        return { reportId: row.id, outcome: "refunded", reason: `production failed previously: ${existingOrder.lastError ?? "see logs"}` };
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
          // Terminal: settle the paid row to `refunded` so it never sits in_production.
          await settleRefund(deps.accounts, row.id);
          return { reportId: row.id, outcome: "refunded", reason: "max production attempts exhausted" };
        }
        // Crash recovery: reclaim the stale row via compare-and-swap (R-3) —
        // exactly one concurrent tick wins; the loser skips without a second
        // paid pipeline run.
        const won = await deps.repo.reclaimStaleOrder(
          row.id,
          { claimedAt: existingOrder.claimedAt, attempts: existingOrder.attempts },
          now().toISOString(),
        );
        if (!won) return { reportId: row.id, outcome: "skipped", reason: "claimed by another tick" };
        reclaimed = true;
        break;
      }
    }
  }

  // Cheap reads BEFORE the claim — a row that can never produce is settled
  // without consuming an order row / attempt. B2: a paid row that can never be
  // fulfilled is refunded (never left in_production). The one exception is a
  // cross-tenant mismatch (F-4): a data-integrity anomaly to investigate, NOT an
  // auto-refund.
  const obj = await deps.accounts.getObject(row.object_id);
  if (!obj) {
    await settleRefund(deps.accounts, row.id);
    return { reportId: row.id, outcome: "refunded", reason: `object ${row.object_id} not found` };
  }
  // F-4: never produce/deliver across tenants — the report row's user must own
  // the object it points at. Surfaced as a failure, never auto-refunded.
  if (obj.user_id !== row.user_id) {
    return { reportId: row.id, outcome: "failed", reason: "object/owner mismatch" };
  }

  // A category we cannot serve (unmapped, or mapped to a type with no profile yet
  // such as cards/silver) can never produce a report → refund at pre-claim, before
  // burning any paid pipeline attempts.
  const category = mapAccountsCategory(obj.category);
  if (!category || !categoryHasProfile(category)) {
    await settleRefund(deps.accounts, row.id);
    return {
      reportId: row.id,
      outcome: "refunded",
      reason: category ? `no profile for category "${category}"` : `unmapped category "${obj.category}"`,
    };
  }

  const profile = await deps.accounts.getProfile(row.user_id);
  if (!profile?.email) {
    await settleRefund(deps.accounts, row.id);
    return { reportId: row.id, outcome: "refunded", reason: "collector profile/email not found" };
  }

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
    if (terminal) {
      // Permanent failure (e.g. no profile for the category, adapter down, no
      // downloadable photos): settle the paid row to `refunded` so it never sits
      // in_production forever (B1). Non-terminal failures stay for retry.
      await settleRefund(deps.accounts, row.id);
      return { reportId: row.id, outcome: "refunded", reason: `production failed terminally: ${message}` };
    }
    return { reportId: row.id, outcome: "failed", reason: message };
  }
  await deps.repo.updateOrder(row.id, { productionState: "produced", lastError: null });

  const delivery = await deliverReport(deps.accounts, result.report, result.version);

  // A refund state (unscored / withheld) is settled to `refunded` on the
  // accounts row — terminal, no deliverable, no curator email.
  if (delivery.settled === "refunded") {
    return { reportId: row.id, outcome: "refunded", tier: result.score.tier, reason: `settled: ${result.report.status}` };
  }

  if (result.report.status === "provisional") {
    await sendCuratorReviewSafely(deps, order, result.report.id, result.score.tier); // EMAIL B
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
  refunded: number;
  skipped: number;
  failed: number;
  /** R-5: curator-review emails re-sent by the queue-independent sweep. */
  curatorEmailsResent: number;
  results: ProcessedReport[];
}

/** One cron tick: drain the in_production queue (failures isolated per row),
 *  then run the curator-email sweep (R-5). */
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
  // Cleanup 2: the sweep must never sink a tick — row side effects above have
  // already committed. A sweep-level failure (e.g. listReportsByStatus throws)
  // is logged and swallowed; the tick still returns its summary.
  let curatorEmailsResent = 0;
  try {
    curatorEmailsResent = await sweepCuratorEmails(deps);
  } catch (e) {
    console.error("report poller: curator-email sweep failed (tick continues):", e);
  }
  return {
    polled: rows.length,
    delivered: results.filter((r) => r.outcome === "delivered").length,
    refunded: results.filter((r) => r.outcome === "refunded").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    curatorEmailsResent,
    results,
  };
}
