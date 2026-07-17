// GET /api/v1/cron/enrich — the Enrich living-layer tick (R-3, revised
// ADR-002). Vercel Cron drains veradis-accounts `enrichment_jobs`
// (status='queued'): first_pass / reverify / relink / revalue / narrative,
// each written back in the admin-enrich.js shapes. Guarded by CRON_SECRET.
// Without the accounts env the tick is a no-op, not an error.

import { getStore } from "@/app/lib/store";
import { checkCronAuth } from "@/app/lib/cron-auth";
import { getAccountsClient } from "@/packages/adapters/accounts";
import { runEnrichmentJobs } from "@/packages/enrich/living";

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
  const summary = await runEnrichmentJobs({ accounts, repo, storage, emailer, adapters });
  return Response.json({ ok: true, ...summary });
}
