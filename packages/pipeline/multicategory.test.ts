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

function artOrder(): OrderIntake {
  return {
    orderId: "ord-art-1",
    objectId: "art-1",
    category: "art",
    sku: "verify",
    declaredAttributes: {
      artist: "E. J. Hughes",
      title: "Fishboats, Rivers Inlet",
      medium: "oil on canvas",
      dimensions: "76 x 96 cm",
      signature_inscription: "signed lower right",
    },
    ownerFacingName: "Fishboats, Rivers Inlet",
    photos: [
      { filename: "front.jpg", bytes: enc.encode("FRONT") },
      { filename: "signature.jpg", bytes: enc.encode("SIG") },
      { filename: "verso.jpg", bytes: enc.encode("VERSO") },
      { filename: "raking.jpg", bytes: enc.encode("RAKE") },
    ],
  };
}

describe("E-E multi-category scaffolds", () => {
  beforeEach(() => resetStubRegistry());

  it("an art order runs end-to-end → provisional, thin sources, no resolved authority", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(repo, new StubStorage(), adapters(), artOrder());

    expect(res.report.status).toBe("provisional");
    expect(res.snapshot.provisional).toBe(true);
    expect(res.profile.category).toBe("art");

    // Thin sources: not one identity check closed by a Tier-1 authority.
    const identityChecks = res.snapshot.checks.filter((c) => c.quadrant === "identity");
    expect(identityChecks.length).toBeGreaterThan(0);
    expect(identityChecks.every((c) => c.authorityState !== "resolved")).toBe(true);

    // The provisional watermark + honesty ceiling hold on the rendered report.
    const html = renderReport(res.snapshot);
    expect(html).toContain("Provisional — under expert review");
    expect(html.toLowerCase()).not.toContain("authenticated");

    // A curator can still confirm it → definitive (Brent's own-collection path).
    const confirmed = await confirmReport(repo, {
      reportId: res.report.id,
      curator: "Curator",
      credentialClass: "curator",
      verb: "confirmed",
    });
    expect(confirmed.report.status).toBe("definitive");
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
