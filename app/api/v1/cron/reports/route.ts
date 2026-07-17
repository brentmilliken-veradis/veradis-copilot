// GET /api/v1/cron/reports — the report poller tick (R-2, revised ADR-002).
// Vercel Cron drains the shared veradis-accounts `reports` queue
// (status='in_production'): produce a provisional via the engine, deliver it
// back onto the collector's row. Guarded by CRON_SECRET (Vercel sends it as a
// Bearer token). Without the accounts env the tick is a no-op, not an error.

import { getStore } from "@/app/lib/store";
import { getAccountsClient } from "@/packages/adapters/accounts";
import { pollReports } from "@/packages/pollers/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const accounts = getAccountsClient();
  if (!accounts) {
    return Response.json({ ok: true, stubbed: true, note: "VERADIS_ACCOUNTS_URL / service key not set" });
  }

  const { repo, storage, emailer, adapters } = await getStore();
  const summary = await pollReports({ accounts, repo, storage, emailer, adapters });
  return Response.json({ ok: true, ...summary });
}
