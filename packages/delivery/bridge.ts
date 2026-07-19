// Delivery bridge (E-D) — replaces the manual /api/admin-deliver-report flow in
// verify-store. On a provisional (auto) and again on the curator-confirmed
// definitive, render the canonical report, store it in the veradis-accounts
// report-files bucket, and write the collector's `reports` row:
// file_path + pcs_score (+ valuation) + status in_production → delivered.
// One direction only (ADR-002): this module writes NOTHING outside that row.
// The definitive pass re-uploads to the same path (upsert), so the collector's
// link simply starts serving the confirmed report.

import type { Report, ReportVersion } from "@/packages/pcs-types";
import type { VeradisAccountsClient } from "@/packages/adapters/accounts";
import { renderReport, type ReportImage } from "@/packages/report/render";
import { markStubbed } from "@/packages/adapters/stub-registry";

/** The slice of the accounts client the bridge needs (structural, so the
 *  poller tests can substitute a fake). */
export type DeliveryTarget = Pick<VeradisAccountsClient, "getReport" | "uploadReportFile" | "updateReport">;

export interface DeliveryResult {
  delivered: boolean;
  filePath?: string;
  reason?: string;
  /** Set when a refund-state report (unscored/withheld) resolved the accounts
   *  row to a terminal `refunded` state instead of delivering. */
  settled?: "refunded";
}

/** Only these copilot statuses are paid deliverables that belong on the
 *  collector's object. */
const DELIVERABLE = new Set(["provisional", "definitive", "flagged"]);

/** Unscored (indeterminate evidence) and withheld (curator refund) are NOT
 *  deliverables — they resolve the customer's row to a terminal `refunded` so
 *  it never sits in_production. The actual Stripe refund is the account-template's
 *  action (see the CoPilot ↔ Account interface contract). */
const REFUND_STATES = new Set(["unscored", "withheld"]);

export async function deliverReport(
  accounts: DeliveryTarget | null,
  report: Report, // report.orderId = veradis-accounts reports.id (E-C contract)
  version: ReportVersion,
  now: () => string = () => new Date().toISOString(),
  /** Object photos to inline into the report HTML (hero + evidence strip). Built
   *  at delivery from the owner's uploads; never stored in the snapshot. */
  opts: { images?: ReportImage[] } = {},
): Promise<DeliveryResult> {
  const isRefund = REFUND_STATES.has(report.status);
  if (!isRefund && !DELIVERABLE.has(report.status)) {
    return { delivered: false, reason: `status ${report.status} is not a deliverable` };
  }
  if (!accounts) {
    markStubbed(
      "delivery-bridge",
      "VERADIS_ACCOUNTS_URL + VERADIS_ACCOUNTS_SERVICE_ROLE_KEY",
      "report delivery to veradis-accounts",
    );
    return { delivered: false, reason: "accounts client not configured" };
  }

  // Not every copilot report is a store order (Tally orders have no accounts
  // row) — a missing row means "nothing to bridge", not an error.
  const row = await accounts.getReport(report.orderId);
  if (!row) return { delivered: false, reason: `no veradis-accounts reports row ${report.orderId}` };

  // A refund state settles the customer's row to a terminal `refunded` (no file,
  // no score) so it never sits in_production. CoPilot only signals the terminal
  // state — the account-template issues the Stripe refund against the row's
  // stripe_payment_intent.
  if (isRefund) {
    await accounts.updateReport(row.id, { status: "refunded" });
    return { delivered: false, settled: "refunded" };
  }

  const snapshot = version.snapshotJson;
  const html = renderReport(snapshot, { images: opts.images });
  const filePath = await accounts.uploadReportFile(row.user_id, row.id, html);

  // F-8: only a real expert-set band ever crosses the bridge — never 0–0,
  // never a partial band.
  const val = snapshot.valuation;
  const hasBand =
    val && val.fmvLo !== undefined && val.fmvHi !== undefined && !(val.fmvLo === 0 && val.fmvHi === 0);
  // R-4 (COORDINATE): a capped report (uncalibrated category / vision-only
  // re-route) must not put a bare confident number on the account card — the
  // structured pcs_score is withheld; the HTML file still carries the Flagged
  // verdict, composite/CI, and the 'not yet calibrated' line. If the
  // account-template prefers a cap flag alongside the number, that lands on
  // their schema — coordinate before changing this to anything but omission.
  const capped = snapshot.capReason !== undefined;
  // A1: a curator downgrade steps the tier below its composite band, so the
  // bare Math.round(composite) would badge the HIGHER, un-downgraded tier —
  // suppress it exactly like a capped score. The HTML file still carries the
  // sealed downgraded tier + curator note.
  const suppressScore = capped || snapshot.tierAdjusted === true;
  await accounts.updateReport(row.id, {
    status: "delivered",
    file_path: filePath,
    pcs_score: !suppressScore && version.composite != null ? Math.round(version.composite) : undefined,
    // Tier drives the account's colour chip. Always written (a capped report's
    // 'flagged' and a downgrade's lower tier are both honest); only the bare
    // NUMBER is suppressed above.
    tier: version.tier ?? undefined,
    // A2 (defense-in-depth): a capped report can never be confirmed and so
    // never carries an expert band — but cap-guard the valuation too, for
    // symmetry with the score, so a cap can never leak a bare number either way.
    valuation: !capped && hasBand ? `${val.currency} ${val.fmvLo}–${val.fmvHi}` : undefined,
    delivered_at: now(),
  });

  return { delivered: true, filePath };
}

/** Settle a paid accounts row to a terminal `refunded` — used when a report can
 *  NEVER be produced (a terminal production failure) so the row never sits in
 *  in_production forever. Idempotent; returns false when there is no client or no
 *  row. The Stripe refund is the account-template's action (contract C-3). */
export async function settleRefund(accounts: DeliveryTarget | null, reportId: string): Promise<boolean> {
  if (!accounts) return false;
  const row = await accounts.getReport(reportId);
  if (!row) return false;
  await accounts.updateReport(row.id, { status: "refunded" });
  return true;
}
