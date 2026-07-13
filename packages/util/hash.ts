// Shared hashing. SHA-256 backs evidence integrity (E2), the scorer seed (E5),
// and the report_version hash chain (E6). One implementation, used everywhere.

import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deterministic canonical JSON — object keys sorted recursively — so hashing a
 *  snapshot is stable across runs regardless of key insertion order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Hash of the canonical JSON form of a value. */
export function sha256OfJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
