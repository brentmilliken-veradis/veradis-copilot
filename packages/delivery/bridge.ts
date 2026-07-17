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

export interface DeliveryResult {
  delivered: boolean;
  filePath?: string;
  reason?: string;
}

/** Only these copilot statuses are paid deliverables that belong on the
 *  collector's object. Unscored/withheld are refunds — nothing is delivered. */
const DELIVERABLE = new Set(["provisional", "definitive", "flagged"]);

export async function deliverReport(
  accounts: VeradisAccountsClient | null,
  report: Report, // report.orderId = veradis-accounts reports.id (E-C contract)
  version: ReportVersion,
  now: () => string = () => new Date().toISOString(),
): Promise<DeliveryResult> {
  if (!DELIVERABLE.has(report.status)) {
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

  const snapshot = version.snapshotJson;
  const html = renderReport(snapshot);
  const filePath = await accounts.uploadReportFile(row.user_id, row.id, html);

  const val = snapshot.valuation;
  await accounts.updateReport(row.id, {
    status: "delivered",
    file_path: filePath,
    pcs_score: version.composite != null ? Math.round(version.composite) : undefined,
    valuation:
      val && (val.fmvLo || val.fmvHi) ? `${val.currency} ${val.fmvLo}–${val.fmvHi}` : undefined,
    delivered_at: now(),
  });

  return { delivered: true, filePath };
}
