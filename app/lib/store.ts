// App-level in-memory store. Until the live veradis-copilot Supabase project is
// provisioned (BUILD-KICKOFF §8), the running app is backed by InMemoryRepository
// seeded with the 2007-coin fixture as a provisional report, so the curator flow
// works end-to-end in `npm run dev` without a database. A global singleton keeps
// state across requests (and HMR) within the dev process.

import { InMemoryRepository } from "@/packages/data/in-memory";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";
import type { Repository } from "@/packages/data/repository";

export interface AppStore {
  repo: Repository;
  seededReportId: string;
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
  return { repo, seededReportId: report.id };
}

const g = globalThis as unknown as { __veradisStore?: Promise<AppStore> };

export function getStore(): Promise<AppStore> {
  return (g.__veradisStore ??= seed());
}
