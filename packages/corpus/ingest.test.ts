import { describe, it, expect } from "vitest";
import { ingestCorpus, chunkText } from "./ingest";
import { writeBackConfirmed, summariseSnapshot } from "./learning-loop";
import { COIN_CORPUS } from "./sources";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubEmbeddingAdapter, retrieveTopK } from "@/packages/adapters/embedding";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";

describe("corpus pipeline (E8)", () => {
  it("chunkText packs sentences under the size cap", () => {
    const parts = chunkText("One sentence here. Two sentence here. Three sentence here.", 30);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(40);
  });

  it("ingests Coins Tier-1/2 docs → documents + embedded chunks", async () => {
    const repo = new InMemoryRepository();
    const res = await ingestCorpus(repo, new StubEmbeddingAdapter(), COIN_CORPUS);
    expect(res.documents).toBe(COIN_CORPUS.length);
    expect(res.chunks).toBeGreaterThanOrEqual(COIN_CORPUS.length);
    const chunks = await repo.listCorpusChunks("coins");
    expect(chunks.length).toBe(res.chunks);
    for (const c of chunks) expect(c.embedding.length).toBe(64); // stub dim
  });

  it("retrieval finds the mint-mark chunk for a matching query", async () => {
    const repo = new InMemoryRepository();
    const embedder = new StubEmbeddingAdapter();
    await ingestCorpus(repo, embedder, COIN_CORPUS);
    const top = await retrieveTopK(repo, embedder, { category: "coins", query: "mint mark RCM 2007", k: 3 });
    expect(top.length).toBeGreaterThan(0);
    expect(top[0].chunk.text.toLowerCase()).toContain("rcm");
    // corroboration carries its source + tier
    expect(top[0].chunk.metadataJson.source).toBeTruthy();
  });

  it("learning loop writes a confirmed report back as Tier-1 corpus", async () => {
    const repo = new InMemoryRepository();
    const embedder = new StubEmbeddingAdapter();
    const definitive = buildCoin2007(2); // provisional === false
    const res = await writeBackConfirmed(repo, embedder, definitive);
    expect(res.documents).toBe(1);
    const chunks = await repo.listCorpusChunks("coins");
    expect(chunks.some((c) => c.metadataJson.tier === 1)).toBe(true);
    // the written-back knowledge is retrievable
    const top = await retrieveTopK(repo, embedder, { category: "coins", query: "2007 Royal Canadian Mint Proof Set RCM", k: 1 });
    expect(top.length).toBe(1);
  });

  it("the learning loop ignores provisional reports", async () => {
    const repo = new InMemoryRepository();
    const provisional = buildCoin2007(1, { provisional: true });
    const res = await writeBackConfirmed(repo, new StubEmbeddingAdapter(), provisional);
    expect(res).toEqual({ documents: 0, chunks: 0 });
  });

  it("summariseSnapshot captures attributes, verdict, and honesty register", () => {
    const text = summariseSnapshot(buildCoin2007(2));
    expect(text).toContain("year 2007");
    expect(text).toContain("gold");
    expect(text).toContain("expert-reviewed");
    expect(text.toLowerCase()).not.toContain("authenticated");
  });
});
