// GET /api/v1/cron/corpus — the Vercel Cron BATCH that refreshes the Coins corpus
// (BUILD-KICKOFF §2: corpus ingest runs on Cron, never in a user request path).
// Guarded by CRON_SECRET when set (Vercel Cron sends it as a Bearer token).

import { getStore } from "@/app/lib/store";
import { checkCronAuth } from "@/app/lib/cron-auth";
import { ingestCorpus } from "@/packages/corpus/ingest";
import { COIN_CORPUS } from "@/packages/corpus/sources";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";

export const dynamic = "force-dynamic";
// Nightly corpus embed/refresh can be long; give it headroom over the default.
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = checkCronAuth(request); // F-3: fails closed without CRON_SECRET
  if (denied) return denied;
  const { repo } = await getStore();
  const result = await ingestCorpus(repo, new StubEmbeddingAdapter(), COIN_CORPUS);
  return Response.json({ ok: true, ...result });
}
