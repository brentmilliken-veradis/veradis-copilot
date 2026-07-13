// GET /api/v1/cron/corpus — the Vercel Cron BATCH that refreshes the Coins corpus
// (BUILD-KICKOFF §2: corpus ingest runs on Cron, never in a user request path).
// Guarded by CRON_SECRET when set (Vercel Cron sends it as a Bearer token).

import { getStore } from "@/app/lib/store";
import { ingestCorpus } from "@/packages/corpus/ingest";
import { COIN_CORPUS } from "@/packages/corpus/sources";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const { repo } = await getStore();
  const result = await ingestCorpus(repo, new StubEmbeddingAdapter(), COIN_CORPUS);
  return Response.json({ ok: true, ...result });
}
