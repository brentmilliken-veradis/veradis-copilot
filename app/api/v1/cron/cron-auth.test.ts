// F-3 — cron auth fails closed on every poller route. On the 500/401 paths no
// work happens: fetch is stubbed to a spy that must never fire.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as reportsGET } from "./reports/route";
import { GET as enrichGET } from "./enrich/route";

const ROUTES: [string, (req: Request) => Promise<Response>][] = [
  ["reports", reportsGET],
  ["enrich", enrichGET],
];

const OLD = {
  CRON_SECRET: process.env.CRON_SECRET,
  VERADIS_ACCOUNTS_URL: process.env.VERADIS_ACCOUNTS_URL,
  VERADIS_ACCOUNTS_SERVICE_ROLE_KEY: process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY,
};

function req(auth?: string): Request {
  return new Request("http://localhost/api/v1/cron/x", { headers: auth ? { authorization: auth } : {} });
}

describe("F-3 — cron auth fails closed", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Any network call on a denied path is a test failure.
    fetchSpy = vi.fn(async () => {
      throw new Error("fetch must not be called on a denied cron tick");
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

  for (const [name, GET] of ROUTES) {
    it(`${name}: no CRON_SECRET → 500, zero work`, async () => {
      delete process.env.CRON_SECRET;
      const res = await GET(req("Bearer anything"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "cron secret not configured" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it(`${name}: wrong bearer → 401, zero work`, async () => {
      process.env.CRON_SECRET = "s3cret";
      expect((await GET(req("Bearer wrong"))).status).toBe(401);
      expect((await GET(req())).status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it(`${name}: correct bearer → runs (no-op without accounts env)`, async () => {
      process.env.CRON_SECRET = "s3cret";
      const res = await GET(req("Bearer s3cret"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, stubbed: true });
    });
  }
});
