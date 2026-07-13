// Corpus ingestion (E8). Fetch → chunk → embed → pgvector. Runs as a Vercel Cron
// BATCH, never in a request path (BUILD-KICKOFF §2). Embeddings go through the
// (stubbed) EmbeddingAdapter until EMBEDDINGS_API_KEY is set.

import type { Repository } from "@/packages/data/repository";
import type { EmbeddingAdapter } from "@/packages/adapters/embedding";
import { sha256Hex } from "@/packages/util/hash";
import type { CorpusSourceDoc } from "./sources";

/** Split text into ~maxChars chunks on sentence boundaries. */
export function chunkText(text: string, maxChars = 240): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > maxChars) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

export interface IngestOpts {
  now?: string;
}

export async function ingestCorpus(
  repo: Repository,
  embedder: EmbeddingAdapter,
  docs: CorpusSourceDoc[],
  opts: IngestOpts = {},
): Promise<{ documents: number; chunks: number }> {
  const fetchedAt = opts.now ?? "2026-07-13T00:00:00Z";
  let documents = 0;
  let chunks = 0;
  for (const d of docs) {
    const doc = await repo.addCorpusDocument({
      category: d.category,
      source: d.source,
      url: d.url ?? null,
      licence: d.licence ?? null,
      fetchedAt,
      sha256: sha256Hex(d.text),
    });
    documents++;
    const parts = chunkText(d.text);
    const embeddings = await embedder.embed(parts);
    for (let i = 0; i < parts.length; i++) {
      await repo.addCorpusChunk({
        corpusDocumentId: doc.id,
        text: parts[i],
        embedding: embeddings[i],
        metadataJson: { source: d.source, tier: d.tier, url: d.url ?? null },
      });
      chunks++;
    }
  }
  return { documents, chunks };
}
