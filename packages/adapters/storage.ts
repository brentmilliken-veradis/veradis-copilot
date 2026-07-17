// Storage adapter — where intake photos land. Production is Supabase Storage
// in the dedicated veradis-copilot project (bucket `verify-uploads` by default);
// without creds, StubStorage keeps bytes in memory and content-addresses them
// (tests / dev). Selection happens in getStorage().

import { sha256Hex } from "@/packages/util/hash";
import { markStubbed } from "./stub-registry";

export interface StoredObject {
  path: string;
  sha256: string;
  bytes: number;
}

export interface Storage {
  /** Store bytes under `key`; returns the storage path + content hash. */
  put(key: string, bytes: Uint8Array): Promise<StoredObject>;
  get(path: string): Promise<Uint8Array | null>;
}

/** In-memory, content-addressed. `path` is `stub://<key>`. Deterministic. */
export class StubStorage implements Storage {
  private blobs = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    markStubbed("storage:stub", "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY", "evidence photo storage");
    const path = `stub://${key}`;
    this.blobs.set(path, bytes);
    return { path, sha256: sha256Hex(bytes), bytes: bytes.byteLength };
  }

  async get(path: string): Promise<Uint8Array | null> {
    return this.blobs.get(path) ?? null;
  }
}

// ---- Live adapter: Supabase Storage (copilot project) via the Storage REST API. ----

const DEFAULT_BUCKET = "verify-uploads";

/** F-12: upstream error bodies are logged server-side, never thrown — thrown
 *  messages become per-row `reason`/`detail` strings on the cron surface. */
async function failUpstream(label: string, res: Response): Promise<never> {
  console.error(`${label} ${res.status}: ${await res.text()}`);
  throw new Error(`${label} ${res.status}`);
}


/** F-7: reject traversal before encoding — encodeURIComponent keeps '..'. */
function assertSafeStoragePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new Error("unsafe storage path rejected");
  }
  for (const segment of path.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("unsafe storage path rejected");
    }
  }
}

/** URL-encode each path segment, keeping the `/` separators. */
function encodePath(key: string): string {
  assertSafeStoragePath(key);
  return key.split("/").map(encodeURIComponent).join("/");
}

export class SupabaseStorage implements Storage {
  constructor(
    private url: string, // e.g. https://<ref>.supabase.co
    private serviceKey: string,
    private bucket: string = process.env.SUPABASE_STORAGE_BUCKET ?? DEFAULT_BUCKET,
  ) {}

  private objectUrl(bucketAndKey: string): string {
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${encodePath(bucketAndKey)}`;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }

  async put(key: string, bytes: Uint8Array): Promise<StoredObject> {
    const path = `${this.bucket}/${key}`;
    const res = await fetch(this.objectUrl(path), {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/octet-stream",
        "x-upsert": "true", // webhook retries re-put the same key — idempotent
      },
      body: new Uint8Array(bytes), // fresh view keeps fetch body typing happy
    });
    if (!res.ok) await failUpstream("storage:supabase put", res);
    return { path, sha256: sha256Hex(bytes), bytes: bytes.byteLength };
  }

  async get(path: string): Promise<Uint8Array | null> {
    const res = await fetch(this.objectUrl(path), { headers: this.headers() });
    if (res.status === 400 || res.status === 404) return null; // Supabase reports missing keys as 400/404
    if (!res.ok) await failUpstream("storage:supabase get", res);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Factory — live Supabase Storage when copilot creds are present, else the stub. */
export function getStorage(): Storage {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  return url && key ? new SupabaseStorage(url, key) : new StubStorage();
}
