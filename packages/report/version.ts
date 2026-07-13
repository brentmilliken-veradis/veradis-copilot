// Report-version hashing + chaining (gate ⑥). A version's content hash is the
// SHA-256 of its snapshot with the hash fields excluded (they can't hash
// themselves). Chaining sets supersedesSha256 to the prior version's hash so the
// sequence is tamper-evident.

import type { ReportSnapshot } from "@/packages/pcs-types";
import { sha256OfJson } from "@/packages/util/hash";

/** Stable content hash of a snapshot (excludes the hash fields). */
export function hashSnapshot(s: ReportSnapshot): string {
  const { snapshotSha256: _a, supersedesSha256: _b, ...content } = s;
  void _a;
  void _b;
  return sha256OfJson(content);
}

/** Stamp a snapshot with its own content hash and, if given, the predecessor's. */
export function sealVersion(s: ReportSnapshot, predecessorHash?: string): ReportSnapshot {
  const withPred: ReportSnapshot = { ...s, supersedesSha256: predecessorHash };
  return { ...withPred, snapshotSha256: hashSnapshot(withPred) };
}
