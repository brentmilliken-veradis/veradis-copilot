// E-B — live Supabase Storage adapter. All Supabase calls are mocked (global
// fetch); no real network traffic in tests.

import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorage, StubStorage, SupabaseStorage } from "./storage";
import { sha256Hex } from "@/packages/util/hash";

const BYTES = new Uint8Array([1, 2, 3, 4]);

describe("SupabaseStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("put uploads to the bucket path with service auth + upsert and returns path/hash", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const storage = new SupabaseStorage("https://ref.supabase.co", "srv-key", "verify-uploads");
    const stored = await storage.put("rep-1/obverse/obv 1.jpg", BYTES);

    expect(stored).toEqual({ path: "verify-uploads/rep-1/obverse/obv 1.jpg", sha256: sha256Hex(BYTES), bytes: 4 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ref.supabase.co/storage/v1/object/verify-uploads/rep-1/obverse/obv%201.jpg");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer srv-key");
    expect(headers["x-upsert"]).toBe("true");
    expect(init.method).toBe("POST");
  });

  it("get downloads the object's bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(BYTES).buffer as ArrayBuffer, { status: 200 })),
    );
    const storage = new SupabaseStorage("https://ref.supabase.co", "srv-key");
    const out = await storage.get("verify-uploads/rep-1/obverse/obv.jpg");
    expect(out).toEqual(BYTES);
  });

  it("get returns null on a missing object (404/400)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })));
    const storage = new SupabaseStorage("https://ref.supabase.co", "srv-key");
    expect(await storage.get("verify-uploads/nope.jpg")).toBeNull();
  });

  it("put throws on an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const storage = new SupabaseStorage("https://ref.supabase.co", "srv-key");
    await expect(storage.put("k", BYTES)).rejects.toThrow(/storage:supabase put 403/);
  });
});

describe("getStorage factory", () => {
  const OLD = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(OLD)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns the stub without creds", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    expect(getStorage()).toBeInstanceOf(StubStorage);
  });

  it("returns Supabase storage with url + service key", () => {
    process.env.SUPABASE_URL = "https://ref.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "srv-key";
    expect(getStorage()).toBeInstanceOf(SupabaseStorage);
  });
});
