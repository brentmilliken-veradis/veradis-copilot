// F-8 (D-3) — Appraise never fabricates a number. Provisional = no band,
// "under expert review"; the only numeric band is expert-set at confirm.

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

const enc = new TextEncoder();

function adapters(): PipelineAdapters {
  return {
    vision: new StubVisionAdapter(),
    sources: [pcgsAdapter(), numistaAdapter()],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
    narrative: new StubNarrativeAdapter(),
  };
}

function appraiseOrder(): OrderIntake {
  return {
    orderId: "ord-appraise",
    objectId: "coin-appraise",
    category: "coins", // calibrated — the F-1 cap must not interfere here
    sku: "appraise",
    declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM", variety: "Proof" },
    currency: "CAD",
    photos: [
      { filename: "obv.jpg", bytes: enc.encode("OBV") },
      { filename: "rev.jpg", bytes: enc.encode("REV") },
    ],
  };
}

describe("F-8 — Appraise valuation honesty", () => {
  beforeEach(() => resetStubRegistry());

  it("a provisional Appraise carries NO band and renders 'under expert review'", async () => {
    const res = await runProvisional(new InMemoryRepository(), new StubStorage(), adapters(), appraiseOrder());

    expect(res.snapshot.valuation).toBeDefined();
    expect(res.snapshot.valuation!.fmvLo).toBeUndefined();
    expect(res.snapshot.valuation!.fmvHi).toBeUndefined();

    const html = renderReport(res.snapshot);
    expect(html).toContain("Indicative value — under expert review");
    expect(html).not.toContain("0–0");
    expect(html).toContain("does not depend on the value concluded"); // independence line intact
  });

  it("the expert-set band at confirm is the only number that renders", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(repo, new StubStorage(), adapters(), appraiseOrder());

    const confirmed = await confirmReport(repo, {
      reportId: res.report.id,
      curator: "Curator",
      credentialClass: "curator",
      verb: "confirmed",
      valuationBand: { currency: "CAD", lo: 1200, hi: 1800 },
    });

    const sealed = confirmed.version!.snapshotJson;
    expect(sealed.valuation).toMatchObject({ currency: "CAD", fmvLo: 1200, fmvHi: 1800 });
    const html = renderReport(sealed);
    expect(html).toContain("CAD 1,200–1,800");
    expect(html).not.toContain("under expert review");
    expect(html.toLowerCase()).not.toContain("certified appraisal</h"); // ceiling text remains as scope prose
  });

  it("guards: a 0–0 or inverted band is rejected; a band on a non-Appraise is rejected", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(repo, new StubStorage(), adapters(), appraiseOrder());
    const base = { reportId: res.report.id, curator: "C", credentialClass: "curator" as const, verb: "confirmed" as const };

    await expect(confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 0, hi: 0 } })).rejects.toThrow(/0–0/);
    await expect(confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 500, hi: 100 } })).rejects.toThrow(/lo ≤ hi/);

    const verify = await runProvisional(repo, new StubStorage(), adapters(), {
      ...appraiseOrder(),
      orderId: "ord-verify",
      objectId: "coin-verify",
      sku: "verify",
    });
    await expect(
      confirmReport(repo, { ...base, reportId: verify.report.id, valuationBand: { currency: "CAD", lo: 100, hi: 200 } }),
    ).rejects.toThrow(/no Appraise valuation/);
  });
});
