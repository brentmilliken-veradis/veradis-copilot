// Storage adapter — where intake photos land. Production is Supabase Storage
// (`verify-uploads`); until the live project exists (BUILD-KICKOFF §8) intake
// uses StubStorage, which keeps bytes in memory and content-addresses them.

import { sha256Hex } from "@/packages/util/hash";

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
    const path = `stub://${key}`;
    this.blobs.set(path, bytes);
    return { path, sha256: sha256Hex(bytes), bytes: bytes.byteLength };
  }

  async get(path: string): Promise<Uint8Array | null> {
    return this.blobs.get(path) ?? null;
  }
}
