// Phase A acceptance — the end-to-end gate (BUILD-KICKOFF "Acceptance A"):
//   1. a real coin runs end-to-end → coins is CALIBRATED: a credible real tier,
//      confirm-to-definitive open (this is also the coins field-golden
//      validation — see tests/golden/coins-calibration-v1.json)
//   2. a mislabelled coin is auto-corrected
//   3. the engine reproduces the 2007 RCM proof-set report incl. the v01→v02 ladder
// All on seeded data with stubbed adapters.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { runProvisional, type PipelineAdapters } from "./run";
import { confirmReport } from "@/packages/curator/confirm";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { StubVisionAdapter, type VisionScenario } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";
import { renderReport } from "@/packages/report/render";
import { buildCoin2007 } from "@/packages/fixtures/coin-2007";
import type { OrderIntake, PhotoInput } from "@/packages/intake/types";

const PHOTO_FILES = ["IMG_2348.jpg", "IMG_2349.jpg", "IMG_2350.jpg", "IMG_2351.jpg", "IMG_2352.jpg", "IMG_2353.jpg", "IMG_2354.jpg", "IMG_2355.jpg", "IMG_2356.jpg"];

function realPhotos(): PhotoInput[] {
  return PHOTO_FILES.map((file) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(fileURLToPath(new URL(`../../docs/fixtures/PCS-CA-2026-0007/${file}`, import.meta.url)));
    } catch {
      bytes = new TextEncoder().encode(file);
    }
    return { filename: file, bytes };
  });
}

function adapters(visionScenarios: Record<string, VisionScenario> = {}): PipelineAdapters {
  return {
    vision: new StubVisionAdapter(visionScenarios),
    sources: [
      pcgsAdapter({ "year=2007": { matched: true, url: "https://pcgs.com/2007" }, "denomination=Proof Set": { matched: true } }),
      numistaAdapter({ "country=Canada": { matched: true }, "mint_mark=RCM": { matched: true } }),
    ],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter({ "coin-clean": [{ institution: "Royal Canadian Mint", relation: "same-issue", confidence: 0.8 }] }),
    sanctions: new StubSanctionsAdapter(),
    narrative: new StubNarrativeAdapter(),
  };
}

function order(overrides: Partial<OrderIntake> = {}): OrderIntake {
  return {
    orderId: "ord-accept",
    objectId: "coin-clean",
    category: "coins",
    sku: "appraise",
    declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM", variety: "Proof" },
    ownerFacingName: "2007 Royal Canadian Mint Proof Set",
    photos: realPhotos(),
    ...overrides,
  };
}

describe("Phase A acceptance", () => {
  beforeEach(() => resetStubRegistry());

  it("1 — a real coin runs end-to-end → coins is calibrated: a credible tier, confirmable to definitive", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(repo, new StubStorage(), adapters(), order());

    // scored, provisional (pending curator), scoreable
    expect(res.report.status).toBe("provisional");
    expect(res.score.isScoreable).toBe(true);
    expect(res.version.v).toBe(1);
    expect(res.snapshot.evidence).toHaveLength(9); // nine photos hashed

    // Coins IS calibrated → no cap; a genuine set earns a credible confident
    // tier (Silver here on thin custody; Gold with full provenance — the
    // v01→v02 ladder). Never Flagged for a genuine coin.
    expect(res.snapshot.capReason).toBeUndefined();
    expect(["gold", "silver", "bronze"]).toContain(res.snapshot.score.tier);

    // it renders honestly — a real tier, no "not yet calibrated", never "authenticated"
    const html = renderReport(res.snapshot);
    expect(html).toContain("Provenance Confidence Score");
    expect(html).toContain("Provisional — under expert review"); // watermark until curator confirms
    expect(html).not.toContain("This category is not yet calibrated");
    expect(html.toLowerCase()).not.toContain("authenticated");

    // a calibrated report CAN now be confirmed to definitive…
    const confirmed = await confirmReport(repo, { reportId: res.report.id, curator: "Curator", credentialClass: "curator", verb: "confirmed" });
    expect(confirmed.report.status).toBe("definitive");

    // every external adapter ran as a stub, each flagged with the key it needs
    expect(res.stubs.map((s) => s.envKey)).toEqual(
      expect.arrayContaining(["VISION_API_KEY", "PCGS_API_TOKEN", "NUMISTA_API_KEY", "NARRATIVE_API_KEY"]),
    );
  });

  it("2 — a mislabelled coin is auto-corrected", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(
      repo,
      new StubStorage(),
      adapters({ "coin-mislabel": { derivedAttributes: { year: "2007" } } }),
      order({ orderId: "ord-mislabel", objectId: "coin-mislabel", declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2008", mint_mark: "RCM", variety: "Proof" } }),
    );

    // the owner typed 2008; the engine corrected it to 2007
    expect(res.corrections).toHaveLength(1);
    expect(res.corrections[0].claimed).toBe("2008");
    expect(res.corrections[0].correctedValue).toBe("2007");
    expect(res.snapshot.object.resolvedAttributes.year).toBe("2007");
    // the correction surfaces in the rendered report's narrative
    expect(res.snapshot.narrative.some((n) => n.id === "corrections")).toBe(true);
  });

  it("3 — reproduces the 2007 RCM proof-set report incl. the v01→v02 ladder", () => {
    const v1 = buildCoin2007(1);
    const v2 = buildCoin2007(2);
    // v01 Silver → v02 Gold, driven by Custody
    expect(Math.round(v1.score.composite)).toBe(85);
    expect(v1.score.tier).toBe("silver");
    expect(Math.round(v2.score.composite)).toBe(93);
    expect(v2.score.tier).toBe("gold");
    // the delta panel renders the ladder
    const html = renderReport(v2);
    expect(html).toContain("What changed since v1");
    expect(html).toContain("Silver → Gold");
    // hash chain: v02 supersedes v01
    expect(v2.supersedesSha256).toBe(v1.snapshotSha256);
  });

  it("determinism — same (objectId, snapshotTs) scores identically to the digit", async () => {
    // Pin the clock so both runs share snapshotTs (= report.createdAt); the seed is
    // then identical and the deterministic scorer must reproduce exactly.
    const fixedEnv = () => ({ now: () => "2026-07-13T00:00:00.000Z", id: () => randomUUID() });
    const a = await runProvisional(new InMemoryRepository(fixedEnv()), new StubStorage(), adapters(), order());
    const b = await runProvisional(new InMemoryRepository(fixedEnv()), new StubStorage(), adapters(), order());
    expect(JSON.stringify(a.score)).toBe(JSON.stringify(b.score));
  });
});
