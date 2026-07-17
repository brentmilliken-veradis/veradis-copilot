// App-level in-memory store. Until the live veradis-copilot Supabase project is
// provisioned (BUILD-KICKOFF §8), the running app is backed by InMemoryRepository
// seeded with the 2007-coin fixture as a provisional report, so the curator flow
// works end-to-end in `npm run dev` without a database. A global singleton keeps
// state across requests (and HMR) within the dev process.

import { InMemoryRepository } from "@/packages/data/in-memory";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";
import type { Repository } from "@/packages/data/repository";
import { getStorage, type Storage } from "@/packages/adapters/storage";
import { getEmailer, type Emailer } from "@/packages/adapters/email";
import { getVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { getNarrativeAdapter } from "@/packages/adapters/narrative";
import type { PipelineAdapters } from "@/packages/pipeline/run";

export interface AppStore {
  repo: Repository;
  storage: Storage;
  emailer: Emailer;
  adapters: PipelineAdapters;
  seededReportId: string;
}

function buildAdapters(storage: Storage): PipelineAdapters {
  return {
    // Live vision needs the storage to load image bytes for Claude image blocks.
    vision: getVisionAdapter({}, storage),
    sources: [pcgsAdapter(), numistaAdapter()],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
    narrative: getNarrativeAdapter(),
  };
}

async function seed(): Promise<AppStore> {
  const repo = new InMemoryRepository();
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
  const storage = getStorage(); // Supabase Storage with creds, else in-memory stub
  return { repo, storage, emailer: getEmailer(), adapters: buildAdapters(storage), seededReportId: report.id };
}

const g = globalThis as unknown as { __veradisStore?: Promise<AppStore> };

export function getStore(): Promise<AppStore> {
  return (g.__veradisStore ??= seed());
}
