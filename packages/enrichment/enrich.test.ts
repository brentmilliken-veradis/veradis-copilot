import { describe, it, expect, beforeEach } from "vitest";
import { enrich, type EnrichAdapters, type EnrichInput } from "./enrich";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { loadProfile } from "@/packages/profiles/loader";
import { pcgsAdapter, numistaAdapter, type SourceScenario } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter, type GraphScenario } from "@/packages/adapters/graph";
import { StubSanctionsAdapter, type SanctionsScenario } from "@/packages/adapters/sanctions";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";
import type { Report } from "@/packages/pcs-types";

async function makeReport(repo: InMemoryRepository, objectId = "obj:c1"): Promise<Report> {
  const r = await repo.createReport({ orderId: "o", objectId, category: "coins" });
  return repo.updateReport(r.id, { status: "paid" });
}

function adapters(opts: {
  pcgs?: SourceScenario;
  numista?: SourceScenario;
  graph?: GraphScenario;
  sanctions?: SanctionsScenario;
} = {}): EnrichAdapters {
  return {
    sources: [pcgsAdapter(opts.pcgs), numistaAdapter(opts.numista)],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(opts.graph),
    sanctions: new StubSanctionsAdapter(opts.sanctions),
  };
}

function input(report: Report, resolved: Record<string, string>): EnrichInput {
  return {
    report,
    profile: loadProfile("coins"),
    declaredAttributes: resolved,
    resolvedAttributes: resolved,
    redFlags: [],
  };
}

const RESOLVED = { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM", variety: "Proof" };

describe("enrich (E4)", () => {
  beforeEach(() => resetStubRegistry());

  it("closes an identity check when a Tier-1 source matches", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    await enrich(repo, adapters({ pcgs: { "year=2007": { matched: true, url: "https://pcgs.com/2007" } } }), input(report, RESOLVED));

    const checks = await repo.listChecks(report.id);
    const yearCheck = checks.find((c) => c.quadrant === "identity" && c.key === "year");
    expect(yearCheck?.authorityState).toBe("resolved");
    expect(yearCheck?.result).toBe("match");
    const cites = await repo.listCitations(report.id);
    expect(cites.some((c) => c.name === "PCGS" && c.tier === 1 && c.retrievalState === "retrieved")).toBe(true);
  });

  it("corroborates via corpus but never closes the check (Tier-2)", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    // Seed a coin corpus chunk that mentions the mint mark.
    const doc = await repo.addCorpusDocument({ category: "coins", source: "acsearch.info (die-match)", url: null, licence: null, fetchedAt: "2026-07-13T00:00:00Z", sha256: "d" });
    const [emb] = await new StubEmbeddingAdapter().embed(["mint_mark RCM Royal Canadian Mint 2007 proof"]);
    await repo.addCorpusChunk({ corpusDocumentId: doc.id, text: "mint_mark RCM Royal Canadian Mint 2007 proof", embedding: emb, metadataJson: { source: "acsearch.info (die-match)" } });

    // No Tier-1 match configured → mint_mark should resolve via corpus.
    await enrich(repo, adapters(), input(report, RESOLVED));
    const checks = await repo.listChecks(report.id);
    const mm = checks.find((c) => c.quadrant === "identity" && c.key === "mint_mark");
    expect(mm?.authorityState).toBe("corpus");
    expect(mm?.result).toBe("consistent"); // corroborated, NOT "match"
    const cites = await repo.listCitations(report.id);
    expect(cites.some((c) => c.tier === 2 && c.name.includes("acsearch"))).toBe(true);
  });

  it("holds a gap open for a missing attribute (widens CI, never lowers score)", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    const { variety, ...noVariety } = RESOLVED; // drop variety
    void variety;
    const res = await enrich(repo, adapters(), input(report, noVariety));
    const varietyInput = res.scoreInputs.identity.find((i) => i.key === "variety");
    expect(varietyInput).toMatchObject({ present: false, credit: 0, authorityState: "missing" });
    const checks = await repo.listChecks(report.id);
    expect(checks.find((c) => c.key === "variety")?.result).toBe("gap_held_open");
  });

  it("screens sanctions/stolen registries into Risk events", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo, "obj:stolen");
    const res = await enrich(
      repo,
      adapters({ sanctions: { "obj:stolen": [{ kind: "stolen", severity: "high" }] } }),
      input(report, RESOLVED),
    );
    expect(res.scoreInputs.risk).toEqual([{ kind: "stolen", severity: "high" }]);
    const checks = await repo.listChecks(report.id);
    expect(checks.find((c) => c.quadrant === "risk" && c.key === "stolen")?.result).toBe("flagged");
  });

  it("a clean sanctions screen resolves; the stolen-property register is an honest gap without the add-on", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    const res = await enrich(repo, adapters(), input(report, RESOLVED));
    expect(res.scoreInputs.risk).toHaveLength(0);
    expect(res.scoreInputs.theftRegistryChecked).toBe(false);
    const checks = await repo.listChecks(report.id);
    // The sanctions/PEP screen ran clean…
    const sanctions = checks.find((c) => c.quadrant === "risk" && c.key === "sanctions_screen");
    expect(sanctions?.result).toBe("match");
    expect(sanctions?.authorityState).toBe("resolved");
    // …but the stolen-property register was never queried — a gap, not a clean.
    const theft = checks.find((c) => c.quadrant === "risk" && c.key === "stolen_registry");
    expect(theft?.result).toBe("gap_held_open");
    expect(theft?.authorityState).toBe("missing");
  });

  it("the theft add-on resolves the stolen-property register and closes a second risk trial", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    const res = await enrich(repo, adapters(), { ...input(report, RESOLVED), theftRegistryChecked: true });
    expect(res.scoreInputs.theftRegistryChecked).toBe(true);
    const checks = await repo.listChecks(report.id);
    const theft = checks.find((c) => c.quadrant === "risk" && c.key === "stolen_registry");
    expect(theft?.result).toBe("match");
    expect(theft?.authorityState).toBe("resolved");
  });

  it("internal graph cross-ref raises custody coverage and cites the institution", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo, "obj:linked");
    const res = await enrich(
      repo,
      adapters({ graph: { "obj:linked": [{ institution: "Seaforth Highlanders", relation: "same-issue", confidence: 1.0 }] } }),
      input(report, RESOLVED),
    );
    expect(res.scoreInputs.custody.coverage).toBeCloseTo(0.6, 6); // 0.5 base + 0.1
    const cites = await repo.listCitations(report.id);
    expect(cites.some((c) => c.name === "Seaforth Highlanders")).toBe(true);
  });

  it("sets category scale factor and keeps ALR off at D5", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    const res = await enrich(repo, adapters(), input(report, RESOLVED));
    expect(res.scoreInputs.scaleFactor).toBe(10);
    expect(res.scoreInputs.alrEnabled).toBe(false);
  });

  // P2 (fix brief v04): a vision-ADDED value (owner never declared the key) must
  // clear a STRONGER corpus bar (0.6) than a declared value (0.35). A fixed-
  // cosine embedder pins a corpus match at 0.5 — between the two bars.
  const fixedCosineAdapters = (): EnrichAdapters => ({
    sources: [pcgsAdapter(), numistaAdapter()],
    embedder: { name: "embedding:fixed", dim: 2, embed: async (texts) => texts.map(() => [1, 0]) },
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
  });

  async function seedCorpusAt(repo: InMemoryRepository, cosine: number): Promise<void> {
    const doc = await repo.addCorpusDocument({ category: "coins", source: "acsearch.info (die-match)", url: null, licence: null, fetchedAt: "2026-07-13T00:00:00Z", sha256: "d" });
    // query embeds to [1,0]; a chunk [cosine, sqrt(1-cosine^2)] gives exactly `cosine`.
    await repo.addCorpusChunk({
      corpusDocumentId: doc.id,
      text: "variety proof",
      embedding: [cosine, Math.sqrt(1 - cosine * cosine)],
      metadataJson: { source: "acsearch.info (die-match)" },
    });
  }

  it("P2: a DECLARED value at a mid corpus score (0.5) is corroborated", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    await seedCorpusAt(repo, 0.5);
    // variety declared AND resolved → the ordinary 0.35 bar applies.
    const res = await enrich(repo, fixedCosineAdapters(), input(report, RESOLVED));
    const variety = res.scoreInputs.identity.find((i) => i.key === "variety");
    expect(variety).toMatchObject({ authorityState: "corpus", credit: 0.5, present: true });
  });

  it("P2: a VISION-ADDED value at the same score (0.5) is held open — below the 0.6 bar", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    await seedCorpusAt(repo, 0.5);
    // variety is in resolved (vision added it) but NOT declared.
    const { variety, ...declared } = RESOLVED;
    const res = await enrich(repo, fixedCosineAdapters(), {
      report,
      profile: loadProfile("coins"),
      declaredAttributes: declared,
      resolvedAttributes: { ...declared, variety },
      redFlags: [],
    });
    const varietyInput = res.scoreInputs.identity.find((i) => i.key === "variety");
    expect(varietyInput).toMatchObject({ credit: 0, present: false });
    const checks = await repo.listChecks(report.id);
    expect(checks.find((c) => c.key === "variety")?.note).toMatch(/no corroborating source — held open/);
  });

  it("P2: a VISION-ADDED value that clears the STRONGER bar (0.7) is corroborated", async () => {
    const repo = new InMemoryRepository();
    const report = await makeReport(repo);
    await seedCorpusAt(repo, 0.7);
    const { variety, ...declared } = RESOLVED;
    const res = await enrich(repo, fixedCosineAdapters(), {
      report,
      profile: loadProfile("coins"),
      declaredAttributes: declared,
      resolvedAttributes: { ...declared, variety },
      redFlags: [],
    });
    const varietyInput = res.scoreInputs.identity.find((i) => i.key === "variety");
    expect(varietyInput).toMatchObject({ authorityState: "corpus", credit: 0.5, present: true });
  });
});
