// GET /api/v1/cron/reports — the report poller tick (R-2, revised ADR-002).
// Vercel Cron drains the shared veradis-accounts `reports` queue
// (status='in_production'): produce a provisional via the engine, deliver it
// back onto the collector's row. Guarded by CRON_SECRET (Vercel sends it as a
// Bearer token). Without the accounts env the tick is a no-op, not an error.

import { getStore } from "@/app/lib/store";
import { checkCronAuth } from "@/app/lib/cron-auth";
import { getAccountsClient } from "@/packages/adapters/accounts";
import { pollReports } from "@/packages/pollers/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = checkCronAuth(request); // F-3: fails closed without CRON_SECRET
  if (denied) return denied;

  const accounts = getAccountsClient();
  if (!accounts) {
    return Response.json({ ok: true, stubbed: true, note: "VERADIS_ACCOUNTS_URL / service key not set" });
  }

  const { repo, storage, emailer, adapters } = await getStore();
  const summary = await pollReports({ accounts, repo, storage, emailer, adapters });
  return Response.json({ ok: true, ...summary });
}
