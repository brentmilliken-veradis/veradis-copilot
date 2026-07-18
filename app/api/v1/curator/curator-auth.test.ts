// R-1 — the curator route fails closed. Deny paths must produce ZERO side
// effects: no curator_action, no email, no delivery write (spy-verified via
// the in-memory store singleton + a throwing fetch stub).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getStore } from "@/app/lib/store";

const OLD = {
  CURATOR_AUTH_SECRET: process.env.CURATOR_AUTH_SECRET,
  VERADIS_ACCOUNTS_URL: process.env.VERADIS_ACCOUNTS_URL,
  VERADIS_ACCOUNTS_SERVICE_ROLE_KEY: process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY,
};

function req(body: unknown, auth?: string): Request {
  return new Request("http://localhost/api/v1/curator", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

describe("R-1 — curator route auth fails closed", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Fresh seeded store per test — a confirming test seals the fixture to
    // definitive, so isolation must reset the memoised singleton.
    (globalThis as { __veradisStore?: unknown }).__veradisStore = undefined;
    fetchSpy = vi.fn(async () => {
      throw new Error("network must not be touched on a denied curator call");
    });
    vi.stubGlobal("fetch", fetchSpy);
    delete process.env.VERADIS_ACCOUNTS_URL;
    delete process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(OLD)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("no CURATOR_AUTH_SECRET → 500, zero side effects", async () => {
    delete process.env.CURATOR_AUTH_SECRET;
    const { repo, seededReportId } = await getStore();

    const res = await POST(req({ reportId: seededReportId, verb: "confirmed" }, "Bearer anything"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "curator auth secret not configured" });
    expect(await repo.listCuratorActions(seededReportId)).toHaveLength(0);
    expect(await repo.listEmails("seed-order")).toHaveLength(0);
    expect((await repo.getReport(seededReportId))?.status).toBe("provisional"); // not sealed
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wrong or missing bearer → 401, zero side effects", async () => {
    process.env.CURATOR_AUTH_SECRET = "cur-secret";
    const { repo, seededReportId } = await getStore();

    expect((await POST(req({ reportId: seededReportId, verb: "confirmed" }, "Bearer wrong"))).status).toBe(401);
    expect((await POST(req({ reportId: seededReportId, verb: "confirmed" }))).status).toBe(401);

    expect(await repo.listCuratorActions(seededReportId)).toHaveLength(0);
    expect((await repo.getReport(seededReportId))?.status).toBe("provisional");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("valid bearer → confirms, audit row carries the auth context", async () => {
    process.env.CURATOR_AUTH_SECRET = "cur-secret";
    const { repo, seededReportId } = await getStore();

    const res = await POST(req({ reportId: seededReportId, verb: "confirmed", curator: "Brent" }, "Bearer cur-secret"));

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { report: { status: string } };
    expect(payload.report.status).toBe("definitive");
    const actions = await repo.listCuratorActions(seededReportId);
    expect(actions).toHaveLength(1);
    expect(actions[0].curator).toBe("Brent (auth: curator-shared-secret)");
    expect(actions[0].credentialClass).toBe("curator"); // server-side default
  });

  it("FLAG-A: resolves the accounts reports.id (= orderId) to the copilot report", async () => {
    process.env.CURATOR_AUTH_SECRET = "cur-secret";
    const { repo, seededReportId } = await getStore();

    // Per contract C-1 the account-template sends the ACCOUNTS reports.id — in
    // the in-memory seed that is the order id "seed-order", NOT the (internal)
    // copilot report.id. The route must resolve it to the right report.
    const res = await POST(req({ reportId: "seed-order", verb: "confirmed", curator: "Brent" }, "Bearer cur-secret"));

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { report: { id: string; status: string } };
    expect(payload.report.status).toBe("definitive");
    expect(payload.report.id).toBe(seededReportId); // resolved to the seeded report
    expect(await repo.listCuratorActions(seededReportId)).toHaveLength(1);
  });

  it("FLAG-A: an id that matches neither orderId nor report.id → 404, no side effects", async () => {
    process.env.CURATOR_AUTH_SECRET = "cur-secret";
    const { repo, seededReportId } = await getStore();

    const res = await POST(req({ reportId: "no-such-id", verb: "confirmed" }, "Bearer cur-secret"));

    expect(res.status).toBe(404);
    expect(await repo.listCuratorActions(seededReportId)).toHaveLength(0);
    expect((await repo.getReport(seededReportId))?.status).toBe("provisional"); // untouched
  });
});
