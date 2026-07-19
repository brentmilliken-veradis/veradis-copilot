// E-E — multi-category scaffolds through the full pipeline. The honesty rule
// (ADR-002): with no Tier-1 source serving these categories, results carry NO
// resolved authority and stay provisional — thin sources are visible in the
// checks, never papered over.

import { beforeEach, describe, expect, it } from "vitest";
import { runProvisional, type PipelineAdapters } from "./run";
import { confirmReport } from "@/packages/curator/confirm";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { StubVisionAdapter } from "@/packages/adapters/vision";
import { pcgsAdapter, numistaAdapter } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";
import { renderReport } from "@/packages/report/render";
import type { OrderIntake } from "@/packages/intake/types";

function adapters(): PipelineAdapters {
  return {
    vision: new StubVisionAdapter(),
    sources: [pcgsAdapter(), numistaAdapter()], // coins-only — nothing serves the new categories
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
    narrative: new StubNarrativeAdapter(),
  };
}

const enc = new TextEncoder();

// A still-provisional scaffold category (luxury / handbags) — the F-1 cap example.
// (Coins, watches and art are calibrated; the cap tests need an uncalibrated one.)
function scaffoldOrder(): OrderIntake {
  return {
    orderId: "ord-lux-1",
    objectId: "lux-1",
    category: "luxury",
    sku: "verify",
    declaredAttributes: {
      maison: "Hermès",
      model: "Birkin 30",
      date_code: "square Y",
      material: "Togo leather",
      hardware: "gold",
    },
    ownerFacingName: "Hermès Birkin 30",
    photos: [
      { filename: "front.jpg", bytes: enc.encode("FRONT") },
      { filename: "stamp.jpg", bytes: enc.encode("STAMP") },
      { filename: "hardware.jpg", bytes: enc.encode("HW") },
      { filename: "interior.jpg", bytes: enc.encode("INT") },
    ],
  };
}

describe("E-E multi-category scaffolds", () => {
  beforeEach(() => resetStubRegistry());

  it("an uncalibrated (luxury) order runs end-to-end → tier capped to flagged, provisional, confirm blocked (F-1)", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(repo, new StubStorage(), adapters(), scaffoldOrder());

    expect(res.report.status).toBe("provisional");
    expect(res.snapshot.provisional).toBe(true);
    expect(res.profile.category).toBe("luxury");

    // F-1: an uncalibrated category can never present a confident tier.
    expect(res.snapshot.capReason).toBe("uncalibrated_category");
    expect(["gold", "silver", "bronze"]).not.toContain(res.snapshot.score.tier);
    expect(res.version.tier).toBe(res.snapshot.score.tier);

    // Thin sources: not one identity check closed by a Tier-1 authority.
    const identityChecks = res.snapshot.checks.filter((c) => c.quadrant === "identity");
    expect(identityChecks.length).toBeGreaterThan(0);
    expect(identityChecks.every((c) => c.authorityState !== "resolved")).toBe(true);

    // The provisional watermark + honesty ceiling + uncalibrated line render.
    const html = renderReport(res.snapshot);
    expect(html).toContain("Provisional — under expert review");
    expect(html).toContain("This category is not yet calibrated");
    expect(html.toLowerCase()).not.toContain("authenticated");

    // F-1 gate: a capped report cannot be confirmed to definitive…
    await expect(
      confirmReport(repo, { reportId: res.report.id, curator: "Curator", credentialClass: "curator", verb: "confirmed" }),
    ).rejects.toThrow(/capped/);
    // …but the withhold (refund) path stays open.
    const withheld = await confirmReport(repo, {
      reportId: res.report.id,
      curator: "Curator",
      credentialClass: "curator",
      verb: "withheld",
    });
    expect(withheld.report.status).toBe("withheld");
  });

  it("F-1: an uncalibrated object that would score a confident tier still seals capped", async () => {
    // A generous fake Tier-1 source resolves every identity key — the raw
    // composite climbs, but the presented tier must stay capped.
    const artTier1 = {
      name: "Fake Registry",
      tier: 1 as const,
      role: "ground_truth" as const,
      categories: ["luxury" as const],
      async lookup(l: { key: string; value: string }) {
        return {
          adapter: "Fake Art Registry",
          tier: 1 as const,
          role: "ground_truth" as const,
          matched: true,
          value: l.value,
          name: "Fake Art Registry",
          retrievalState: "retrieved" as const,
        };
      },
    };
    const repo = new InMemoryRepository();
    const res = await runProvisional(
      repo,
      new StubStorage(),
      { ...adapters(), sources: [artTier1] },
      scaffoldOrder(),
    );
    // P2 counterfactual: the RAW deterministic tier must actually be confident
    // here — otherwise the test proves nothing about the cap. With every
    // identity key Tier-1-resolved, the raw score is gold/silver/bronze…
    expect(["gold", "silver", "bronze"]).toContain(res.rawScore.tier);
    // …and the cap is what turns it into the presented Flagged.
    expect(res.snapshot.score.tier).toBe("flagged");
    expect(["gold", "silver", "bronze"]).not.toContain(res.snapshot.score.tier);
    expect(res.snapshot.capReason).toBe("uncalibrated_category");
    // Composite + CI are preserved — only the presented tier is capped.
    expect(res.snapshot.score.composite).toBe(res.rawScore.composite);
    expect(res.snapshot.score.composite).toBeGreaterThan(0);
  });

  it("watches and fine-china orders run the same pipeline", async () => {
    for (const [category, declared] of [
      ["watches", { brand: "Omega", reference: "145.022", serial_number: "31,5xx,xxx", movement_calibre: "861" }],
      ["fine-china", { manufactory: "KPM Berlin", backstamp_mark: "blue sceptre", pattern_or_form: "Kurland" }],
    ] as const) {
      const repo = new InMemoryRepository();
      const res = await runProvisional(repo, new StubStorage(), adapters(), {
        orderId: `ord-${category}`,
        objectId: `obj-${category}`,
        category,
        sku: "verify",
        declaredAttributes: { ...declared },
        photos: [{ filename: "a.jpg", bytes: enc.encode("A") }, { filename: "b.jpg", bytes: enc.encode("B") }],
      });
      expect(res.report.status).toBe("provisional");
      expect(res.profile.category).toBe(category);
      expect(res.score.isScoreable).toBe(true);
    }
  });

  it("a coins vision re-route into a scaffold category loads its profile", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(
      repo,
      new StubStorage(),
      {
        ...adapters(),
        vision: new StubVisionAdapter({ "obj-reroute": { derivedCategory: "art" } }),
      },
      {
        orderId: "ord-reroute",
        objectId: "obj-reroute",
        category: "coins",
        sku: "verify",
        declaredAttributes: { year: "1950" },
        photos: [{ filename: "a.jpg", bytes: enc.encode("A") }],
      },
    );
    expect(res.report.category).toBe("art");
    expect(res.profile.category).toBe("art");
    expect(res.corrections.some((c) => c.claimed === "category: coins")).toBe(true);
  });
});
