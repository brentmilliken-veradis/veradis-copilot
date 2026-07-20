// App-level store (E-F data-layer flip). With copilot Supabase creds present
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY → project veradis-copilot,
// lpfmaaeuojextcqhsivs), the app runs on SupabaseRepository + Supabase Storage.
// Without creds it falls back to InMemoryRepository seeded with the 2007-coin
// fixture, so the curator flow works end-to-end in `npm run dev` without a
// database. A global singleton keeps state across requests (and HMR).

import { InMemoryRepository } from "@/packages/data/in-memory";
import { getRepository } from "@/packages/data/supabase";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";
import type { Repository } from "@/packages/data/repository";
import { getStorage, type Storage } from "@/packages/adapters/storage";
import { getEmailer, type Emailer } from "@/packages/adapters/email";
import { getVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, getNumistaAdapter, getWatchArchiveAdapter, getArtArchiveAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { getNarrativeAdapter } from "@/packages/adapters/narrative";
import { getValuationAdapter } from "@/packages/adapters/valuation";
import type { PipelineAdapters } from "@/packages/pipeline/run";

export interface AppStore {
  repo: Repository;
  storage: Storage;
  emailer: Emailer;
  adapters: PipelineAdapters;
  /** Fixture report id when running on the in-memory fallback; "" when live. */
  seededReportId: string;
}

function buildAdapters(storage: Storage): PipelineAdapters {
  return {
    // Live vision needs the storage to load image bytes for Claude image blocks.
    vision: getVisionAdapter({}, storage),
    // Tier-1 identity ground truth per category, real when its key is set, else stub:
    // coins → Numista; watches → reference resolver; fine art → artist/work resolver.
    sources: [pcgsAdapter(), getNumistaAdapter(), getWatchArchiveAdapter(), getArtArchiveAdapter()],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
    narrative: getNarrativeAdapter(),
    // Indicative valuation (F-8 mode) — Claude when VALUATION_API_KEY/ANTHROPIC_API_KEY
    // is set, else the stub (no engine band; "under expert review").
    valuation: getValuationAdapter(),
  };
}

/** Dev-only fixture so the curator flow has something to review in-memory.
 *  Never runs against the live database. */
async function seedFixture(repo: Repository): Promise<string> {
  const snap = buildCoin2007(1, { provisional: true });
  const report = await repo.createReport({ orderId: "seed-order", objectId: snap.objectId, category: "coins" });
  await repo.updateReport(report.id, { status: "provisional", currentVersion: snap.v });
  await repo.addReportVersion({
    reportId: report.id,
    v: snap.v,
    snapshotJson: snap,
    snapshotSha256: snap.snapshotSha256!,
    supersedesSha256: snap.supersedesSha256 ?? null,
    tier: snap.score.tier,
    composite: snap.score.composite,
    ciLo: snap.score.ci.lo,
    ciHi: snap.score.ci.hi,
    pdfPath: null,
  });
  return report.id;
}

async function init(): Promise<AppStore> {
  const repo = getRepository(); // SupabaseRepository with creds, else InMemory
  const storage = getStorage(); // Supabase Storage with creds, else in-memory stub
  const seededReportId = repo instanceof InMemoryRepository ? await seedFixture(repo) : "";
  return { repo, storage, emailer: getEmailer(), adapters: buildAdapters(storage), seededReportId };
}

const g = globalThis as unknown as { __veradisStore?: Promise<AppStore> };

export function getStore(): Promise<AppStore> {
  return (g.__veradisStore ??= init());
}
