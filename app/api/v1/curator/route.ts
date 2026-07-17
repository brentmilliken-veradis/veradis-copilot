// POST /api/v1/curator — a curator confirms / downgrades / withholds a report.
// Calls the tested confirmReport domain logic against the app store.

import { getStore } from "@/app/lib/store";
import { confirmReport } from "@/packages/curator/confirm";
import { sendDefinitive } from "@/packages/notify/emails";
import { getAccountsClient } from "@/packages/adapters/accounts";
import { deliverReport, type DeliveryResult } from "@/packages/delivery/bridge";
import type { CredentialClass, CuratorVerb, Tier } from "@/packages/pcs-types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
  try {
    const res = await confirmReport(repo, {
      reportId: body.reportId,
      curator: body.curator ?? "Curator",
      credentialClass: body.credentialClass ?? "curator",
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
