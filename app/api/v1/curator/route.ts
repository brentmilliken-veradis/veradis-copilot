// POST /api/v1/curator — a curator confirms / downgrades / withholds a report.
// Calls the tested confirmReport domain logic against the app store.
//
// R-1 (fix brief v04): FAIL-CLOSED auth. This route seals reports definitive,
// sets the expert valuation band, writes into the customer's account via the
// service role, and emails the customer — it must never be publicly callable.
// Auth model: server-to-server shared secret (CURATOR_AUTH_SECRET) held by the
// account-template admin backend; the identity it forwards is trusted
// TRANSITIVELY and recorded with its auth context. Once there is more than one
// human curator, the identity MUST come from an authenticated per-user session
// (Supabase admin JWT), not a body field a caller could spoof.

import { getStore } from "@/app/lib/store";
import { checkCuratorAuth } from "@/app/lib/cron-auth";
import { confirmReport } from "@/packages/curator/confirm";
import { sendDefinitive } from "@/packages/notify/emails";
import { getAccountsClient } from "@/packages/adapters/accounts";
import { deliverReport, type DeliveryResult } from "@/packages/delivery/bridge";
import type { CredentialClass, CuratorVerb, Tier } from "@/packages/pcs-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = checkCuratorAuth(request); // R-1: fails closed, before ANY work
  if (denied) return denied;

  let body: {
    reportId?: string;
    curator?: string;
    credentialClass?: CredentialClass;
    verb?: CuratorVerb;
    downgradeTo?: Tier;
    /** F-8: expert-set Appraise band (band-entry UI lives in the account-template admin flow). */
    valuationBand?: { currency: string; lo: number; hi: number };
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.reportId || !body.verb) {
    return Response.json({ error: "reportId and verb are required" }, { status: 400 });
  }

  const { repo, emailer } = await getStore();

  // FLAG-A: the account-template admin backend addresses a report by the
  // ACCOUNTS reports.id (= copilot report.orderId), per interface contract C-1
  // ("reportId": "<accounts reports.id>"). Resolve that to the copilot report;
  // fall back to the copilot report.id so an in-copilot admin surface — which
  // holds the internal id — also works. Either id resolves to one report
  // (both are UUIDs; a cross-match is not possible in practice).
  const target =
    (await repo.getReportByOrderId(body.reportId)) ?? (await repo.getReport(body.reportId));
  if (!target) {
    return Response.json({ error: `report ${body.reportId} not found` }, { status: 404 });
  }

  try {
    const res = await confirmReport(repo, {
      // R-1: the caller authenticated with the shared secret; the forwarded
      // identity is trusted transitively and stamped with its auth context.
      // credentialClass is defaulted SERVER-side — never taken as authority.
      curator: `${body.curator ?? "Curator"} (auth: curator-shared-secret)`,
      credentialClass: body.credentialClass ?? "curator",
      reportId: target.id, // the copilot report.id confirmReport expects
      verb: body.verb,
      downgradeTo: body.downgradeTo,
      valuationBand: body.valuationBand,
    });
    // E-D — a confirmed definitive replaces the provisional on the collector's
    // object (same file path, upsert). Bridge failure must not sink the
    // confirmation itself; it is reported so the curator can replay.
    let delivery: DeliveryResult | null = null;
    if (res.report.status === "definitive" && res.version) {
      try {
        delivery = await deliverReport(getAccountsClient(), res.report, res.version);
      } catch (e) {
        delivery = { delivered: false, reason: (e as Error).message };
      }
      if (!delivery.delivered) {
        console.warn(`curator confirm ${res.report.id}: not delivered to accounts — ${delivery.reason}`);
      }
    }

    // EMAIL C — the report is definitive; tell the customer, with the link.
    if (res.report.status === "definitive") {
      const order = await repo.getOrder(res.report.orderId);
      if (order) await sendDefinitive(repo, emailer, order, res.report.id);
    }
    return Response.json({
      report: res.report,
      action: res.action,
      version: res.version ? { v: res.version.v, tier: res.version.tier } : null,
      delivery,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
