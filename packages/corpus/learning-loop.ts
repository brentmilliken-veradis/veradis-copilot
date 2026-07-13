// Learning loop (E8). A curator-confirmed (definitive) report is written back into
// the corpus as a Tier-1 document — the verified network becomes ground truth for
// future queries. Provisional reports never feed the loop.

import type { ReportSnapshot } from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import type { EmbeddingAdapter } from "@/packages/adapters/embedding";
import { ingestCorpus, type IngestOpts } from "./ingest";

/** Flatten a confirmed snapshot into retrievable corpus text. */
export function summariseSnapshot(s: ReportSnapshot): string {
  const attrs = Object.entries(s.object.resolvedAttributes)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const resolved = s.checks
    .filter((c) => c.quadrant === "identity" && c.authorityState === "resolved")
    .map((c) => c.label)
    .join("; ");
  return `${s.object.title}. ${attrs}. Verified identity: ${resolved}. PCS ${Math.round(s.score.composite)} ${s.score.tier}, verified against the documentary record and expert-reviewed.`;
}

export async function writeBackConfirmed(
  repo: Repository,
  embedder: EmbeddingAdapter,
  snapshot: ReportSnapshot,
  opts: IngestOpts = {},
): Promise<{ documents: number; chunks: number }> {
  if (snapshot.provisional) return { documents: 0, chunks: 0 };
  const text = summariseSnapshot(snapshot);
  return ingestCorpus(
    repo,
    embedder,
    [{ category: snapshot.category, source: `veradis:${snapshot.reportId} (confirmed)`, tier: 1, text }],
    opts,
  );
}
