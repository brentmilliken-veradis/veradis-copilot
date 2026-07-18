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
import { renderReport } from "@/packages/report/render";
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
  const html = renderReport(snapshot);
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
  await accounts.updateReport(row.id, {
    status: "delivered",
    file_path: filePath,
    pcs_score: !capped && version.composite != null ? Math.round(version.composite) : undefined,
    valuation: hasBand ? `${val.currency} ${val.fmvLo}–${val.fmvHi}` : undefined,
    delivered_at: now(),
  });

  return { delivered: true, filePath };
}
