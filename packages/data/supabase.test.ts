// E-F — SupabaseRepository over PostgREST, with mocked fetch. Covers the
// snake_case mapping both ways, filters/ordering on the hot queries, the
// profile upsert, embedding-string parsing, and factory selection.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepository, SupabaseRepository } from "./supabase";
import { InMemoryRepository } from "./in-memory";

const URL_BASE = "https://copilot-ref.supabase.co";
const KEY = "copilot-service-key";

type Call = { url: string; init?: RequestInit };

function mockRest(handler: (url: string, init?: RequestInit) => unknown): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const out = handler(url, init);
      return new Response(JSON.stringify(out), { status: 200 });
    }),
  );
  return { calls };
}

const repo = () => new SupabaseRepository(URL_BASE, KEY);

const reportRow = {
  id: "11111111-1111-1111-1111-111111111111",
  order_id: "acc-rep-1",
  object_id: "obj-1",
  category: "coins",
  status: "created",
  current_version: 0,
  created_at: "2026-07-17T00:00:00Z",
};

describe("SupabaseRepository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("createReport POSTs snake_case and maps the returned row", async () => {
    const { calls } = mockRest(() => [reportRow]);
    const report = await repo().createReport({ orderId: "acc-rep-1", objectId: "obj-1", category: "coins" });

    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/report`);
    expect(calls[0].init?.method).toBe("POST");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers.prefer).toContain("return=representation");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      order_id: "acc-rep-1",
      object_id: "obj-1",
      category: "coins",
      status: "created",
    });
    expect(report).toMatchObject({ orderId: "acc-rep-1", objectId: "obj-1", status: "created", currentVersion: 0 });
  });

  it("updateReport PATCHes only the given fields with snake_case names", async () => {
    const { calls } = mockRest(() => [{ ...reportRow, status: "paid" }]);
    const out = await repo().updateReport(reportRow.id, { status: "paid", currentVersion: 1 });
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/report?id=eq.${reportRow.id}`);
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ status: "paid", current_version: 1 });
    expect(out.status).toBe("paid");
  });

  it("getLatestVersion orders by v desc limit 1 and maps snapshot_jsonb", async () => {
    const { calls } = mockRest(() => [
      {
        id: "v-1",
        report_id: "r-1",
        v: 2,
        snapshot_jsonb: { v: 2, provisional: false },
        snapshot_sha256: "abc",
        supersedes_sha256: "prev",
        tier: "gold",
        composite: "87.5",
        ci_lo: 80,
        ci_hi: 93,
        pdf_path: null,
        created_at: "2026-07-17T00:00:00Z",
      },
    ]);
    const v = await repo().getLatestVersion("r-1");
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/report_version?report_id=eq.r-1&order=v.desc&limit=1`);
    expect(v?.v).toBe(2);
    expect(v?.composite).toBe(87.5); // numeric arrives as a string from PostgREST
    expect(v?.snapshotJson).toEqual({ v: 2, provisional: false });
  });

  it("getReport returns null on an empty result", async () => {
    mockRest(() => []);
    expect(await repo().getReport("nope")).toBeNull();
  });

  it("getReportByOrderId is a bounded single-row query (F-6)", async () => {
    const { calls } = mockRest(() => [reportRow]);
    const hit = await repo().getReportByOrderId("acc-rep-1");
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/report?order_id=eq.acc-rep-1&order=created_at.desc&limit=1`);
    expect(hit?.orderId).toBe("acc-rep-1");
    vi.unstubAllGlobals();
    mockRest(() => []);
    expect(await repo().getReportByOrderId("missing")).toBeNull();
  });

  it("upsertProfile uses on_conflict merge-duplicates and the jsonb column", async () => {
    const { calls } = mockRest(() => [
      { id: "p-1", category: "art", version: 1, jsonb: { category: "art", version: 1 } },
    ]);
    const row = await repo().upsertProfile({ category: "art", version: 1, json: { category: "art", version: 1 } as never });
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/category_profile?on_conflict=category,version`);
    expect((calls[0].init?.headers as Record<string, string>).prefer).toContain("resolution=merge-duplicates");
    expect(row.category).toBe("art");
  });

  it("getOrderByTallySubmission filters on the dedupe key", async () => {
    const { calls } = mockRest(() => [
      {
        id: "acc-rep-1",
        tally_submission_id: "veradis:acc-rep-1",
        email: "c@example.com",
        owner_name: null,
        category: "coins",
        sku: "verify",
        created_at: "2026-07-17T00:00:00Z",
      },
    ]);
    const order = await repo().getOrderByTallySubmission("veradis:acc-rep-1");
    expect(calls[0].url).toBe(`${URL_BASE}/rest/v1/orders?tally_submission_id=eq.veradis%3Aacc-rep-1`);
    expect(order?.ownerName).toBeNull();
    expect(order?.sku).toBe("verify");
  });

  it("parses a pgvector embedding string back into number[]", async () => {
    // listCorpusChunks does two round-trips: docs by category, then chunks.
    const seq = [
      [{ id: "d-1" }],
      [{ id: "c-1", corpus_document_id: "d-1", text: "t", embedding: "[0.1,0.2]", metadata_jsonb: { source: "x" } }],
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(seq.shift()), { status: 200 })));
    const chunks = await repo().listCorpusChunks("coins");
    expect(chunks[0].embedding).toEqual([0.1, 0.2]);
    expect(chunks[0].metadataJson).toEqual({ source: "x" });
  });

  it("throws with context on an HTTP error — without the upstream body (F-12)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("SECRET-UPSTREAM-DETAIL", { status: 500 })));
    const err = await repo()
      .getReport("r-1")
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err!.message).toMatch(/repo:supabase GET report/);
    expect(err!.message).toContain("500");
    expect(err!.message).not.toContain("SECRET-UPSTREAM-DETAIL");
  });

  it("reclaimStaleOrder is a conditional PATCH carrying the expected claim state (R-3)", async () => {
    const { calls } = mockRest(() => [
      {
        id: "acc-rep-1", tally_submission_id: "veradis:acc-rep-1", email: "c@x.com", owner_name: null,
        category: "coins", sku: "verify", created_at: "2026-07-17T00:00:00Z",
        production_state: "producing", attempts: 2, claimed_at: "2026-07-17T12:20:00Z", last_error: null,
      },
    ]);
    const won = await repo().reclaimStaleOrder("acc-rep-1", { claimedAt: "2026-07-17T12:00:00Z", attempts: 1 }, "2026-07-17T12:20:00Z");
    expect(calls[0].url).toBe(
      `${URL_BASE}/rest/v1/orders?id=eq.acc-rep-1&claimed_at=eq.2026-07-17T12%3A00%3A00Z&attempts=eq.1&production_state=eq.producing`,
    );
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ claimed_at: "2026-07-17T12:20:00Z", attempts: 2 });
    expect(won?.attempts).toBe(2);

    vi.unstubAllGlobals();
    mockRest(() => []); // another tick already took it
    expect(await repo().reclaimStaleOrder("acc-rep-1", { claimedAt: null, attempts: 1 }, "t")).toBeNull();
  });

  it("createOrder maps a 409 unique violation to DuplicateOrderError (F-5a)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"23505"}', { status: 409 })));
    await expect(
      repo().createOrder({ id: "acc-rep-1", tallySubmissionId: "veradis:acc-rep-1", email: "c@x.com", ownerName: null, category: "coins", sku: "verify" }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("getRepository factory", () => {
  const OLD = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATA_BACKEND: process.env.DATA_BACKEND,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(OLD)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns InMemory without creds", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.DATA_BACKEND;
    expect(getRepository()).toBeInstanceOf(InMemoryRepository);
  });

  it("returns Supabase with creds", () => {
    process.env.SUPABASE_URL = URL_BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
    delete process.env.DATA_BACKEND;
    expect(getRepository()).toBeInstanceOf(SupabaseRepository);
  });

  it("DATA_BACKEND=memory forces InMemory even with creds", () => {
    process.env.SUPABASE_URL = URL_BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
    process.env.DATA_BACKEND = "memory";
    expect(getRepository()).toBeInstanceOf(InMemoryRepository);
  });
});
