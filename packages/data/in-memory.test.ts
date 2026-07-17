import { describe, it, expect } from "vitest";
import { InMemoryRepository } from "./in-memory";
import type { RepoEnv } from "./repository";
import type { ReportSnapshot } from "@/packages/pcs-types";

// Deterministic env: fixed clock, monotonic ids.
function testEnv(): RepoEnv {
  let n = 0;
  return { now: () => "2026-07-13T00:00:00.000Z", id: () => `id-${++n}` };
}

function stubSnapshot(reportId: string, v: number): ReportSnapshot {
  return {
    reportId,
    objectId: "obj-1",
    snapshotTs: "2026-07-13T00:00:00.000Z",
    category: "coins",
    v,
    methodVersion: "v21",
    meta: { effectiveDate: "2026-07-13", ownerLocale: "en-CA", currency: "CAD", basis: "FMV" },
    object: { title: "t", ownerFacingName: "t", declaredAttributes: {}, resolvedAttributes: {} },
    evidence: [],
    checks: [],
    citations: [],
    corrections: [],
    score: {
      composite: 80,
      ci: { point: 80, lo: 78, hi: 86 },
      tier: "silver",
      quadrants: [],
      seedHex: "deadbeef",
      isScoreable: true,
    },
    narrative: [],
    provisional: true,
  };
}

describe("InMemoryRepository", () => {
  it("creates a report with defaults", async () => {
    const repo = new InMemoryRepository(testEnv());
    const r = await repo.createReport({ orderId: "o1", objectId: "obj-1", category: "coins" });
    expect(r.id).toBe("id-1");
    expect(r.status).toBe("created");
    expect(r.currentVersion).toBe(0);
    expect(r.createdAt).toBe("2026-07-13T00:00:00.000Z");
  });

  it("updates report status", async () => {
    const repo = new InMemoryRepository(testEnv());
    const r = await repo.createReport({ orderId: "o1", objectId: "obj-1", category: "coins" });
    const updated = await repo.updateReport(r.id, { status: "paid" });
    expect(updated.status).toBe("paid");
    expect((await repo.getReport(r.id))?.status).toBe("paid");
  });

  it("orders report versions and returns the latest", async () => {
    const repo = new InMemoryRepository(testEnv());
    const r = await repo.createReport({ orderId: "o1", objectId: "obj-1", category: "coins" });
    await repo.addReportVersion({
      reportId: r.id, v: 1, snapshotJson: stubSnapshot(r.id, 1),
      snapshotSha256: "h1", supersedesSha256: null, tier: "bronze",
      composite: 50, ciLo: 45, ciHi: 58, pdfPath: null,
    });
    await repo.addReportVersion({
      reportId: r.id, v: 2, snapshotJson: stubSnapshot(r.id, 2),
      snapshotSha256: "h2", supersedesSha256: "h1", tier: "silver",
      composite: 70, ciLo: 62, ciHi: 78, pdfPath: null,
    });
    const versions = await repo.getReportVersions(r.id);
    expect(versions.map((v) => v.v)).toEqual([1, 2]);
    const latest = await repo.getLatestVersion(r.id);
    expect(latest?.v).toBe(2);
    expect(latest?.supersedesSha256).toBe("h1");
  });

  it("stamps curator actions immutable + signed", async () => {
    const repo = new InMemoryRepository(testEnv());
    const r = await repo.createReport({ orderId: "o1", objectId: "obj-1", category: "coins" });
    const a = await repo.addCuratorAction({
      reportId: r.id, curator: "Rod", action: "confirmed", credentialClass: "curator",
    });
    expect(a.immutable).toBe(true);
    expect(a.signedAt).toBe("2026-07-13T00:00:00.000Z");
    expect(await repo.listCuratorActions(r.id)).toHaveLength(1);
  });

  it("getReportByOrderId hit/miss (F-6)", async () => {
    const repo = new InMemoryRepository(testEnv());
    const r = await repo.createReport({ orderId: "acc-rep-1", objectId: "obj-1", category: "coins" });
    expect((await repo.getReportByOrderId("acc-rep-1"))?.id).toBe(r.id);
    expect(await repo.getReportByOrderId("nope")).toBeNull();
  });

  it("upserts a profile version and fetches latest", async () => {
    const repo = new InMemoryRepository(testEnv());
    await repo.upsertProfile({ category: "coins", version: 1, json: { category: "coins", version: 1, label: "c", identityKeys: [], captureSlots: [], redFlags: [], corpusSources: [], compKeys: [] } });
    await repo.upsertProfile({ category: "coins", version: 2, json: { category: "coins", version: 2, label: "c", identityKeys: [], captureSlots: [], redFlags: [], corpusSources: [], compKeys: [] } });
    expect((await repo.getProfile("coins"))?.version).toBe(2);
    expect((await repo.getProfile("coins", 1))?.version).toBe(1);
    expect(await repo.getProfile("watches")).toBeNull();
  });

  it("scopes corpus chunks by document category", async () => {
    const repo = new InMemoryRepository(testEnv());
    const doc = await repo.addCorpusDocument({ category: "coins", source: "PCGS", url: null, licence: null, fetchedAt: "2026-07-13T00:00:00.000Z", sha256: "d1" });
    await repo.addCorpusChunk({ corpusDocumentId: doc.id, text: "1936 dot cent", embedding: [], metadataJson: {} });
    expect(await repo.listCorpusChunks("coins")).toHaveLength(1);
    expect(await repo.listCorpusChunks("watches")).toHaveLength(0);
  });
});
