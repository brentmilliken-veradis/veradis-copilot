// E-D — delivery bridge. Uses the real VeradisAccountsClient with mocked fetch
// so the whole read → render → upload → PATCH round-trip is exercised.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverReport } from "./bridge";
import { VeradisAccountsClient } from "@/packages/adapters/accounts";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";
import { listStubbed, resetStubRegistry } from "@/packages/adapters/stub-registry";
import type { Report, ReportVersion } from "@/packages/pcs-types";

const ACCOUNTS_URL = "https://accounts-ref.supabase.co";
const NOW = "2026-07-17T12:00:00.000Z";

function copilotReport(status: Report["status"] = "provisional"): Report {
  return {
    id: "cop-rep-1",
    orderId: "acc-rep-1", // = veradis-accounts reports.id
    objectId: "acc-obj-1",
    category: "coins",
    status,
    currentVersion: 1,
    createdAt: NOW,
  };
}

function version(): ReportVersion {
  const snap = buildCoin2007(1, { provisional: true });
  return {
    id: "ver-1",
    reportId: "cop-rep-1",
    v: 1,
    snapshotJson: snap,
    snapshotSha256: snap.snapshotSha256 ?? "sha",
    supersedesSha256: null,
    tier: snap.score.tier,
    composite: snap.score.composite,
    ciLo: snap.score.ci.lo,
    ciHi: snap.score.ci.hi,
    pdfPath: null,
    createdAt: NOW,
  };
}

const accountsRow = { id: "acc-rep-1", user_id: "user-1", object_id: "acc-obj-1", type: "verify", status: "in_production" };

describe("deliverReport", () => {
  beforeEach(() => resetStubRegistry());
  afterEach(() => vi.unstubAllGlobals());

  it("renders, uploads, and PATCHes the accounts row on the happy path", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/rest/v1/reports?") && (!init || !init.method)) {
          return new Response(JSON.stringify([accountsRow]), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const client = new VeradisAccountsClient(ACCOUNTS_URL, "key");
    const out = await deliverReport(client, copilotReport(), version(), () => NOW);

    expect(out).toEqual({ delivered: true, filePath: "user-1/acc-rep-1.html" });
    expect(calls).toHaveLength(3);
    // 1 — row read
    expect(calls[0].url).toContain("/rest/v1/reports?id=eq.acc-rep-1");
    // 2 — rendered HTML upload to the collector's path
    expect(calls[1].url).toBe(`${ACCOUNTS_URL}/storage/v1/object/report-files/user-1/acc-rep-1.html`);
    const html = calls[1].init?.body as string;
    expect(html).toContain("Provenance Confidence Score");
    // 3 — the write-back patch
    expect(calls[2].init?.method).toBe("PATCH");
    const patch = JSON.parse(calls[2].init?.body as string);
    expect(patch.status).toBe("delivered");
    expect(patch.file_path).toBe("user-1/acc-rep-1.html");
    expect(patch.delivered_at).toBe(NOW);
    expect(typeof patch.pcs_score).toBe("number");
  });

  it("R-4: a capped report's delivery patch carries NO bare pcs_score (uncapped unchanged)", async () => {
    const patches: { patch: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/rest/v1/reports?") && init?.method === "PATCH") {
          patches.push({ patch: JSON.parse(init.body as string) });
        }
        if (url.includes("/rest/v1/reports?") && (!init || !init.method)) {
          return new Response(JSON.stringify([accountsRow]), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const client = new VeradisAccountsClient(ACCOUNTS_URL, "key");

    // Capped snapshot (uncalibrated category) → no structured score crosses.
    const cappedVersion = version();
    cappedVersion.snapshotJson = { ...cappedVersion.snapshotJson, capReason: "uncalibrated_category" };
    const cappedOut = await deliverReport(client, copilotReport(), cappedVersion, () => NOW);
    expect(cappedOut.delivered).toBe(true);
    expect(patches[0].patch.pcs_score).toBeUndefined();
    expect(patches[0].patch.status).toBe("delivered"); // file still delivers

    // Uncapped → pcs_score as today.
    await deliverReport(client, copilotReport(), version(), () => NOW);
    expect(typeof patches[1].patch.pcs_score).toBe("number");
  });

  it("does nothing without an accounts client (stub-flagged)", async () => {
    const out = await deliverReport(null, copilotReport(), version());
    expect(out.delivered).toBe(false);
    expect(listStubbed().map((s) => s.adapter)).toContain("delivery-bridge");
  });

  it("skips when the accounts row does not exist (e.g. a Tally order)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const out = await deliverReport(new VeradisAccountsClient(ACCOUNTS_URL, "key"), copilotReport(), version());
    expect(out.delivered).toBe(false);
    expect(out.reason).toMatch(/no veradis-accounts reports row/);
  });

  it("refuses to deliver a refund state (unscored/withheld)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await deliverReport(new VeradisAccountsClient(ACCOUNTS_URL, "key"), copilotReport("unscored"), version());
    expect(out.delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers the definitive over the same path (upsert replaces the file)", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes("/rest/v1/reports?") && (!init || !init.method)) {
          return new Response(JSON.stringify([{ ...accountsRow, status: "delivered" }]), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const out = await deliverReport(new VeradisAccountsClient(ACCOUNTS_URL, "key"), copilotReport("definitive"), version(), () => NOW);
    expect(out).toEqual({ delivered: true, filePath: "user-1/acc-rep-1.html" });
    expect((calls[1].init?.headers as Record<string, string>)["x-upsert"]).toBe("true");
  });
});
