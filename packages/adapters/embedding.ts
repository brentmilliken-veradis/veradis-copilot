// Embedding adapter + corpus retrieval (E4 uses retrieval; E8 fills the corpus).
// Tier 2–3 corpus corroborates a check but NEVER closes it. The live embedder is
// env-swappable; until EMBEDDINGS_API_KEY is set, StubEmbeddingAdapter produces a
// deterministic pseudo-embedding so retrieval is testable offline.

import { createHash } from "node:crypto";
import type { Category, CorpusChunk } from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import { markStubbed } from "./stub-registry";

export interface EmbeddingAdapter {
  name: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

const STUB_DIM = 64;

/** Deterministic bag-of-hashed-tokens vector — same text ⇒ same vector. Not a
 *  real semantic embedding, but stable and good enough to exercise retrieval. */
export class StubEmbeddingAdapter implements EmbeddingAdapter {
  name = "embedding:stub";
  dim = STUB_DIM;

  async embed(texts: string[]): Promise<number[][]> {
    markStubbed(this.name, "EMBEDDINGS_API_KEY", "corpus embeddings");
    return texts.map((t) => this.vector(t));
  }

  private vector(text: string): number[] {
    const v = new Array(STUB_DIM).fill(0);
    for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      const h = createHash("sha256").update(tok).digest();
      const idx = h[0] % STUB_DIM;
      v[idx] += 1;
    }
    return normalise(v);
  }
}

function normalise(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // inputs are unit-normalised
}

export interface RetrievedChunk {
  chunk: CorpusChunk;
  score: number;
}

/** Top-K corpus retrieval for a category. Corroboration only — the caller must
 *  cite these, never close a check on them. */
export async function retrieveTopK(
  repo: Repository,
  embedder: EmbeddingAdapter,
  opts: { category: Category; query: string; k?: number },
): Promise<RetrievedChunk[]> {
  const chunks = await repo.listCorpusChunks(opts.category);
  if (!chunks.length) return [];
  const [q] = await embedder.embed([opts.query]);
  return chunks
    .map((chunk) => ({ chunk, score: cosine(q, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.k ?? 3);
}
