// R-2 — report poller. A fake accounts surface records every write; the copilot
// side runs the real pipeline on InMemoryRepository with stub adapters.

import { beforeEach, describe, expect, it } from "vitest";
import {
  declaredAttributesFor,
  mapAccountsCategory,
  pollReports,
  processAccountsReport,
  type ReportPollerAccounts,
  type ReportPollerDeps,
} from "./reports";
import type {
  AccountsObjectRow,
  AccountsProfileRow,
  AccountsReportPatch,
  AccountsReportRow,
} from "@/packages/adapters/accounts";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { StubEmailer } from "@/packages/adapters/email";
import { StubVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

class FakeAccounts implements ReportPollerAccounts {
  queue: AccountsReportRow[] = [];
  objects = new Map<string, AccountsObjectRow>();
  profiles = new Map<string, AccountsProfileRow>();
  photos = new Map<string, Uint8Array>();
  uploads: { userId: string; reportId: string; html: string }[] = [];
  patches: { reportId: string; patch: AccountsReportPatch }[] = [];

  async listInProductionReports(objectId?: string): Promise<AccountsReportRow[]> {
    return this.queue.filter((r) => r.status === "in_production" && (!objectId || r.object_id === objectId));
  }
  async getObject(id: string): Promise<AccountsObjectRow | null> {
    return this.objects.get(id) ?? null;
  }
  async getProfile(id: string): Promise<AccountsProfileRow | null> {
    return this.profiles.get(id) ?? null;
  }
  async downloadObjectPhoto(path: string): Promise<Uint8Array | null> {
    return this.photos.get(path) ?? null;
  }
  async getReport(reportId: string) {
    const row = this.queue.find((r) => r.id === reportId);
    return row ? { id: row.id, user_id: row.user_id, object_id: row.object_id, type: row.type, status: row.status } : null;
  }
  async uploadReportFile(userId: string, reportId: string, html: string): Promise<string> {
    this.uploads.push({ userId, reportId, html });
    return `${userId}/${reportId}.html`;
  }
  async updateReport(reportId: string, patch: AccountsReportPatch): Promise<void> {
    this.patches.push({ reportId, patch });
    const row = this.queue.find((r) => r.id === reportId);
    if (row) row.status = patch.status;
  }
}

function deps(accounts: FakeAccounts): ReportPollerDeps {
  return {
    accounts,
    repo: new InMemoryRepository(),
    storage: new StubStorage(),
    emailer: new StubEmailer(),
    adapters: {
      vision: new StubVisionAdapter(),
      sources: [pcgsAdapter(), numistaAdapter()],
      embedder: new StubEmbeddingAdapter(),
      graph: new StubGraphAdapter(),
      sanctions: new StubSanctionsAdapter(),
      narrative: new StubNarrativeAdapter(),
    },
  };
}

function seedPainting(accounts: FakeAccounts): void {
  accounts.queue.push({ id: "rep-1", user_id: "user-1", object_id: "obj-1", type: "verify", status: "in_production" });
  accounts.objects.set("obj-1", {
    id: "obj-1",
    user_id: "user-1",
    title: "Fishboats, Rivers Inlet",
    maker: "E. J. Hughes",
    year: "1946",
    category: "Painting",
    notes: null,
    photo_paths: ["user-1/front.jpg", "user-1/verso.jpg"],
  });
  accounts.profiles.set("user-1", { id: "user-1", email: "collector@example.com", full_name: "Alex Collector" });
  accounts.photos.set("user-1/front.jpg", JPEG);
  accounts.photos.set("user-1/verso.jpg", JPEG);
}

describe("mapAccountsCategory", () => {
  it("maps exact, synonym, and unknown categories", () => {
    expect(mapAccountsCategory("coins")).toBe("coins");
    expect(mapAccountsCategory("Painting")).toBe("art");
    expect(mapAccountsCategory("Porcelain figure")).toBe("fine-china");
    expect(mapAccountsCategory("Wristwatch")).toBe("watches");
    expect(mapAccountsCategory("Furniture")).toBeNull();
    expect(mapAccountsCategory(null)).toBeNull();
  });
});

describe("declaredAttributesFor", () => {
  it("aliases maker/year onto the profile vocabulary", () => {
    const obj = { maker: "E. J. Hughes", year: "1946", title: "T", notes: null } as AccountsObjectRow;
    expect(declaredAttributesFor("art", obj)).toMatchObject({ artist: "E. J. Hughes", year: "1946" });
    expect(declaredAttributesFor("fine-china", { ...obj, maker: "KPM" })).toMatchObject({
      manufactory: "KPM",
      date_range: "1946",
    });
    expect(declaredAttributesFor("watches", { ...obj, maker: "Omega" })).toMatchObject({ brand: "Omega" });
  });
});

describe("pollReports", () => {
  beforeEach(() => resetStubRegistry());

  it("Cleanup 2: a throwing curator-email sweep does not sink the tick", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    // The sweep reads listReportsByStatus — make it throw AFTER the row side
    // effects have committed; pollReports must still return its summary.
    d.repo.listReportsByStatus = async () => {
      throw new Error("status query exploded");
    };

    const summary = await pollReports(d);

    expect(summary).toMatchObject({ polled: 1, delivered: 1, failed: 0, curatorEmailsResent: 0 });
    expect(accounts.patches[0].patch.status).toBe("delivered"); // row work still committed
  });

  it("drains a painting order end-to-end: provisional produced, delivered, EMAIL B", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);

    const summary = await pollReports(d);

    expect(summary).toMatchObject({ polled: 1, delivered: 1, failed: 0, skipped: 0 });
    expect(summary.results[0].outcome).toBe("delivered");

    // Write-back landed on the collector's row.
    expect(accounts.uploads[0].reportId).toBe("rep-1");
    expect(accounts.uploads[0].html).toContain("Provenance Confidence Score");
    const paintingPatch = accounts.patches[0].patch;
    expect(paintingPatch.status).toBe("delivered");
    // R-4: a painting is an uncalibrated (capped) category — the structured
    // pcs_score is withheld; the delivered HTML carries the capped verdict.
    if (paintingPatch.status === "delivered") expect(paintingPatch.pcs_score).toBeUndefined();
    expect(accounts.uploads[0].html).toContain("This category is not yet calibrated");

    // Copilot side: order (id = accounts report id) + provisional report + EMAIL B.
    const order = await d.repo.getOrder("rep-1");
    expect(order?.category).toBe("art");
    const report = (await d.repo.listReports()).find((r) => r.orderId === "rep-1");
    expect(report?.status).toBe("provisional");
    const emails = await d.repo.listEmails("rep-1");
    expect(emails.map((e) => e.kind)).toContain("curator_review");
  });

  it("is idempotent: a produced-but-undelivered row only retries delivery", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    await pollReports(d);

    // Simulate the accounts row never leaving in_production (write-back lost).
    accounts.queue[0].status = "in_production";
    const uploadsBefore = accounts.uploads.length;
    const reportsBefore = (await d.repo.listReports()).length;

    const second = await pollReports(d);

    expect(second.results[0].outcome).toBe("delivered");
    expect(second.results[0].reason).toBe("delivery retried");
    expect(accounts.uploads.length).toBe(uploadsBefore + 1); // re-delivered
    expect((await d.repo.listReports()).length).toBe(reportsBefore); // NOT re-produced
  });

  it("skips unmapped categories and isolates per-row failures", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    // row with an unmappable category
    accounts.queue.push({ id: "rep-2", user_id: "user-1", object_id: "obj-2", type: "verify", status: "in_production" });
    accounts.objects.set("obj-2", {
      id: "obj-2", user_id: "user-1", title: "Armoire", maker: null, year: null,
      category: "Furniture", notes: null, photo_paths: ["user-1/a.jpg"],
    });
    // row whose object is missing entirely
    accounts.queue.push({ id: "rep-3", user_id: "user-1", object_id: "obj-gone", type: "appraise", status: "in_production" });

    const summary = await pollReports(deps(accounts));

    expect(summary.polled).toBe(3);
    expect(summary.delivered).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(1);
    const byId = Object.fromEntries(summary.results.map((r) => [r.reportId, r]));
    expect(byId["rep-2"].reason).toMatch(/unmapped category/);
    expect(byId["rep-3"].reason).toMatch(/not found/);
  });

  it("R-5: delivery succeeds + curator email throws → the SWEEP re-sends exactly once", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    let emailBroken = true;
    d.emailer = {
      send: async (msg) => {
        if (emailBroken) throw new Error("resend down");
        return { providerId: `ok-${msg.subject}` };
      },
    };

    // Tick 1: delivery succeeds (row leaves in_production), email lost.
    const first = await pollReports(d);
    expect(first.results[0].outcome).toBe("delivered");
    expect(accounts.queue[0].status).toBe("delivered"); // gone from the queue — the old retry could never fire
    expect((await d.repo.listEmails("rep-1")).some((e) => e.kind === "curator_review")).toBe(false);

    // Tick 2: queue is EMPTY; the email_log-driven sweep re-sends.
    emailBroken = false;
    const second = await pollReports(d);
    expect(second.polled).toBe(0);
    expect(second.curatorEmailsResent).toBe(1);
    expect((await d.repo.listEmails("rep-1")).filter((e) => e.kind === "curator_review")).toHaveLength(1);

    // Tick 3: dedupe on email_log — never sent twice.
    const third = await pollReports(d);
    expect(third.curatorEmailsResent).toBe(0);
    expect((await d.repo.listEmails("rep-1")).filter((e) => e.kind === "curator_review")).toHaveLength(1);
  });

  it("F-5a: two concurrent ticks over one row — one claims + delivers, one skips, one pipeline run", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    const row = accounts.queue[0];

    const [r1, r2] = await Promise.all([
      processAccountsReport(d, { ...row }),
      processAccountsReport(d, { ...row }),
    ]);

    const outcomes = [r1.outcome, r2.outcome].sort();
    expect(outcomes).toEqual(["delivered", "skipped"]);
    expect([r1, r2].find((r) => r.outcome === "skipped")?.reason).toBe("claimed by another tick");
    // Exactly one production: one copilot report, one upload, one write-back.
    expect((await d.repo.listReports()).filter((r) => r.orderId === "rep-1")).toHaveLength(1);
    expect(accounts.uploads).toHaveLength(1);
    expect(accounts.patches).toHaveLength(1);
  });

  it("F-5a: a throwing pipeline records the attempt and is NOT re-burnt next tick", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    d.adapters.vision = {
      name: "vision:boom",
      analyze: async () => {
        throw new Error("vision exploded");
      },
    };

    const first = await pollReports(d);
    expect(first.results[0]).toMatchObject({ outcome: "failed", reason: "vision exploded" });
    const order = await d.repo.getOrder("rep-1");
    expect(order?.productionState).toBe("producing");
    expect(order?.attempts).toBe(1);
    expect(order?.lastError).toBe("vision exploded");

    // Immediate next tick: the fresh claim blocks a second paid pipeline run.
    const reportsBefore = (await d.repo.listReports()).length;
    const second = await pollReports(d);
    expect(second.results[0]).toMatchObject({ outcome: "skipped", reason: "claimed by another tick" });
    expect((await d.repo.listReports()).length).toBe(reportsBefore);
  });

  it("F-5a: a stale 'producing' claim is reclaimed; attempts exhaust to terminal failed", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    d.adapters.vision = {
      name: "vision:boom",
      analyze: async () => {
        throw new Error("still broken");
      },
    };

    const t0 = Date.parse("2026-07-17T12:00:00Z");
    d.now = () => new Date(t0);
    await pollReports(d); // attempt 1 fails

    d.now = () => new Date(t0 + 16 * 60 * 1000); // past the staleness window
    const second = await pollReports(d); // reclaim → attempt 2 fails
    expect(second.results[0].outcome).toBe("failed");
    expect((await d.repo.getOrder("rep-1"))?.attempts).toBe(2);

    d.now = () => new Date(t0 + 32 * 60 * 1000);
    const third = await pollReports(d); // attempt 3 fails → terminal
    expect(third.results[0].outcome).toBe("failed");
    const order = await d.repo.getOrder("rep-1");
    expect(order?.attempts).toBe(3);
    expect(order?.productionState).toBe("failed");

    // And from then on the row is surfaced, not retried.
    d.now = () => new Date(t0 + 48 * 60 * 1000);
    const fourth = await pollReports(d);
    expect(fourth.results[0].outcome).toBe("skipped");
    expect(fourth.results[0].reason).toMatch(/failed previously/);
  });

  it("R-3: two concurrent ticks over the same STALE claim — exactly one re-runs production", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    const d = deps(accounts);
    const t0 = Date.parse("2026-07-17T12:00:00Z");

    // A crashed tick left a stale 'producing' claim, no report produced.
    await d.repo.createOrder({
      id: "rep-1",
      tallySubmissionId: "veradis:rep-1",
      email: "collector@example.com",
      ownerName: "Alex Collector",
      category: "art",
      sku: "verify",
      productionState: "producing",
      attempts: 1,
      claimedAt: new Date(t0).toISOString(),
    });

    d.now = () => new Date(t0 + 20 * 60 * 1000); // past the staleness window
    const row = accounts.queue[0];
    const [r1, r2] = await Promise.all([
      processAccountsReport(d, { ...row }),
      processAccountsReport(d, { ...row }),
    ]);

    expect([r1.outcome, r2.outcome].sort()).toEqual(["delivered", "skipped"]);
    expect([r1, r2].find((r) => r.outcome === "skipped")?.reason).toBe("claimed by another tick");
    // One pipeline run, one upload, one write-back — no double paid run.
    expect((await d.repo.listReports()).filter((r) => r.orderId === "rep-1")).toHaveLength(1);
    expect(accounts.uploads).toHaveLength(1);
    expect((await d.repo.getOrder("rep-1"))?.attempts).toBe(2);
  });

  it("F-4: a report row pointing at another tenant's object is never produced or delivered", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    accounts.objects.set("obj-1", { ...accounts.objects.get("obj-1")!, user_id: "someone-else" });

    const d = deps(accounts);
    const summary = await pollReports(d);

    expect(summary.results[0]).toMatchObject({ outcome: "failed", reason: "object/owner mismatch" });
    expect(accounts.uploads).toHaveLength(0);
    expect(accounts.patches).toHaveLength(0);
    expect(await d.repo.getOrder("rep-1")).toBeNull(); // nothing produced either
  });

  it("fails (and leaves the row) when no photos are downloadable", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts);
    accounts.photos.clear();
    const summary = await pollReports(deps(accounts));
    expect(summary.results[0]).toMatchObject({ outcome: "failed", reason: "no photos downloadable" });
    expect(accounts.patches).toHaveLength(0);
    expect(accounts.queue[0].status).toBe("in_production");
  });

  it("R-8: a produced refund-state report (unscored) settles the accounts row to `refunded`", async () => {
    const accounts = new FakeAccounts();
    seedPainting(accounts); // provides the in_production accounts row rep-1
    const d = deps(accounts);

    // A prior tick produced an UNSCORED report (thin evidence) but never
    // settled the accounts row — it must not sit in_production forever.
    await d.repo.createOrder({
      id: "rep-1",
      tallySubmissionId: "veradis:rep-1",
      email: "collector@example.com",
      ownerName: "Alex Collector",
      category: "medals",
      sku: "verify",
      productionState: "produced",
      attempts: 1,
      claimedAt: "2026-07-17T12:00:00Z",
    });
    const report = await d.repo.createReport({ orderId: "rep-1", objectId: "obj-1", category: "medals" });
    await d.repo.updateReport(report.id, { status: "unscored", currentVersion: 1 });
    const snap = buildCoin2007(1, { provisional: true });
    await d.repo.addReportVersion({
      reportId: report.id,
      v: 1,
      snapshotJson: snap,
      snapshotSha256: snap.snapshotSha256 ?? "sha",
      supersedesSha256: null,
      tier: "unscored",
      composite: 49,
      ciLo: 35,
      ciHi: 64,
      pdfPath: null,
    });

    const summary = await pollReports(d);

    expect(summary.results[0].outcome).toBe("refunded");
    expect(summary.refunded).toBe(1);
    expect(accounts.patches.at(-1)?.patch.status).toBe("refunded");
    expect(accounts.queue[0].status).toBe("refunded"); // no longer in_production
    expect(accounts.uploads).toHaveLength(0); // no report file for a refund
  });
});
