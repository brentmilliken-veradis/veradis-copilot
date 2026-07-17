// E-C/E-D — veradis-accounts client. All calls mocked (global fetch); the test
// asserts URLs, auth headers, and the one-directional write surface.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccountsClient, VeradisAccountsClient } from "./accounts";

const URL_BASE = "https://accounts-ref.supabase.co";
const KEY = "accounts-service-key";

describe("VeradisAccountsClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downloads an object photo with service auth", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(bytes).buffer as ArrayBuffer, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new VeradisAccountsClient(URL_BASE, KEY);
    const out = await client.downloadObjectPhoto("user-1/obv 1.jpg");

    expect(out).toEqual(bytes);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/storage/v1/object/object-photos/user-1/obv%201.jpg`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  });

  it("returns null for a missing photo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const client = new VeradisAccountsClient(URL_BASE, KEY);
    expect(await client.downloadObjectPhoto("user-1/missing.jpg")).toBeNull();
  });

  it("uploads a report file to report-files/<user>/<report>.html with upsert", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new VeradisAccountsClient(URL_BASE, KEY);
    const path = await client.uploadReportFile("user-1", "rep-1", "<html>report</html>");

    expect(path).toBe("user-1/rep-1.html");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/storage/v1/object/report-files/user-1/rep-1.html`);
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("text/html");
    expect(headers["x-upsert"]).toBe("true");
  });

  it("PATCHes the reports row via PostgREST", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new VeradisAccountsClient(URL_BASE, KEY);
    await client.updateReport("rep-1", {
      status: "delivered",
      file_path: "user-1/rep-1.html",
      pcs_score: 82,
      delivered_at: "2026-07-17T00:00:00.000Z",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_BASE}/rest/v1/reports?id=eq.rep-1`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toMatchObject({ status: "delivered", pcs_score: 82 });
  });

  it("throws on an HTTP error from the write path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const client = new VeradisAccountsClient(URL_BASE, KEY);
    await expect(client.updateReport("rep-1", { status: "delivered", file_path: "p", delivered_at: "t" })).rejects.toThrow(
      /accounts report update 403/,
    );
  });
});

describe("getAccountsClient factory", () => {
  const OLD = {
    VERADIS_ACCOUNTS_URL: process.env.VERADIS_ACCOUNTS_URL,
    VERADIS_ACCOUNTS_SERVICE_ROLE_KEY: process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(OLD)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns null without accounts env", () => {
    delete process.env.VERADIS_ACCOUNTS_URL;
    delete process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY;
    expect(getAccountsClient()).toBeNull();
  });

  it("returns the client with url + service key", () => {
    process.env.VERADIS_ACCOUNTS_URL = URL_BASE;
    process.env.VERADIS_ACCOUNTS_SERVICE_ROLE_KEY = KEY;
    expect(getAccountsClient()).toBeInstanceOf(VeradisAccountsClient);
  });
});
