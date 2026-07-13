import { describe, it, expect } from "vitest";
import { confirmReport } from "./confirm";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";
import type { ReportSnapshot } from "@/packages/pcs-types";

async function seedProvisional(repo: InMemoryRepository, snap: ReportSnapshot) {
  const report = await repo.createReport({ orderId: "o", objectId: snap.objectId, category: "coins" });
  await repo.updateReport(report.id, { status: "provisional", currentVersion: snap.v });
  const version = await repo.addReportVersion({
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
  return { reportId: report.id, version };
}

describe("confirmReport (E7)", () => {
  it("confirm → definitive, hash-chained, with an immutable signed action", async () => {
    const repo = new InMemoryRepository();
    const provisional = buildCoin2007(1, { provisional: true });
    const { reportId, version } = await seedProvisional(repo, provisional);

    const res = await confirmReport(repo, { reportId, curator: "Rod Bell-Irving", credentialClass: "curator", verb: "confirmed" });

    // report is now definitive
    expect(res.report.status).toBe("definitive");
    expect(res.report.currentVersion).toBe(version.v + 1);

    // new definitive version, no longer provisional, chained onto the provisional
    expect(res.version).not.toBeNull();
    expect(res.version!.snapshotJson.provisional).toBe(false);
    expect(res.version!.v).toBe(version.v + 1);
    expect(res.version!.supersedesSha256).toBe(version.snapshotSha256);
    expect(res.version!.snapshotSha256).not.toBe(version.snapshotSha256); // content changed

    // immutable, signed, credentialed
    expect(res.action.immutable).toBe(true);
    expect(res.action.action).toBe("confirmed");
    expect(res.action.credentialClass).toBe("curator");
    expect(res.action.signedAt).toBeTruthy();
    expect(await repo.listCuratorActions(reportId)).toHaveLength(1);
  });

  it("refuses to confirm a report that is not provisional", async () => {
    const repo = new InMemoryRepository();
    const { reportId } = await seedProvisional(repo, buildCoin2007(1, { provisional: true }));
    await confirmReport(repo, { reportId, curator: "c", credentialClass: "curator", verb: "confirmed" });
    // now definitive — a second confirm must throw
    await expect(confirmReport(repo, { reportId, curator: "c", credentialClass: "curator", verb: "confirmed" })).rejects.toThrow(/not provisional/);
  });

  it("withhold routes to the refund path with no deliverable", async () => {
    const repo = new InMemoryRepository();
    const { reportId } = await seedProvisional(repo, buildCoin2007(1, { provisional: true }));
    const res = await confirmReport(repo, { reportId, curator: "c", credentialClass: "senior_curator", verb: "withheld" });
    expect(res.report.status).toBe("withheld");
    expect(res.version).toBeNull();
  });

  it("a curator may downgrade the tier (never inflate)", async () => {
    const repo = new InMemoryRepository();
    const gold = buildCoin2007(2, { provisional: true }); // Gold
    expect(gold.score.tier).toBe("gold");
    const { reportId } = await seedProvisional(repo, gold);
    const res = await confirmReport(repo, { reportId, curator: "c", credentialClass: "external_expert", verb: "downgraded", downgradeTo: "silver" });
    expect(res.report.status).toBe("definitive");
    expect(res.version!.tier).toBe("silver");
    expect(res.version!.snapshotJson.score.tier).toBe("silver");
  });
});
