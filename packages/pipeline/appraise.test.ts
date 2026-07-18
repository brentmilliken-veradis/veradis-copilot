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
import type { ValuationAdapter, ValuationEstimate } from "@/packages/adapters/valuation";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";
import { renderReport } from "@/packages/report/render";
import type { OrderIntake } from "@/packages/intake/types";
import { loadProfile } from "@/packages/profiles/loader";
import type { CategoryProfile } from "@/packages/pcs-types";

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

// Coins ships `provisional`; these tests exercise the calibrated-category
// confirm/band mechanism against a calibrated profile override. No shipped
// category is calibrated — the loader.test.ts guard enforces that.
const calibratedCoins = (): CategoryProfile => ({ ...loadProfile("coins"), calibration: "calibrated" });

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
    const res = await runProvisional(repo, new StubStorage(), adapters(), appraiseOrder(), { profile: calibratedCoins() });

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
    const res = await runProvisional(repo, new StubStorage(), adapters(), appraiseOrder(), { profile: calibratedCoins() });
    const base = { reportId: res.report.id, curator: "C", credentialClass: "curator" as const, verb: "confirmed" as const };

    await expect(confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 0, hi: 0 } })).rejects.toThrow(/0–0/);
    await expect(confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 500, hi: 100 } })).rejects.toThrow(/lo ≤ hi/);

    const verify = await runProvisional(repo, new StubStorage(), adapters(), {
      ...appraiseOrder(),
      orderId: "ord-verify",
      objectId: "coin-verify",
      sku: "verify",
    }, { profile: calibratedCoins() });
    await expect(
      confirmReport(repo, { ...base, reportId: verify.report.id, valuationBand: { currency: "CAD", lo: 100, hi: 200 } }),
    ).rejects.toThrow(/no Appraise valuation/);
  });

  it("R-6: an invalid band writes NO curator_action; a valid confirm mints exactly one", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(repo, new StubStorage(), adapters(), appraiseOrder(), { profile: calibratedCoins() });
    const base = { reportId: res.report.id, curator: "C", credentialClass: "curator" as const, verb: "confirmed" as const };

    // Two invalid attempts throw — and leave the audit trail empty.
    await expect(confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 0, hi: 0 } })).rejects.toThrow();
    await expect(confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 900, hi: 100 } })).rejects.toThrow();
    expect(await repo.listCuratorActions(res.report.id)).toHaveLength(0);
    expect((await repo.getReport(res.report.id))?.status).toBe("provisional"); // not sealed

    // A valid confirm mints exactly one immutable action.
    await confirmReport(repo, { ...base, valuationBand: { currency: "CAD", lo: 1200, hi: 1800 } });
    expect(await repo.listCuratorActions(res.report.id)).toHaveLength(1);
  });
});

// F-8 indicative mode: when a valuation adapter is wired it may attach a clearly-
// LABELLED machine estimate to a provisional Appraise. It is never a certified
// band, degrades to the no-band default when unusable, and never moves the score.
const fakeValuation = (est: ValuationEstimate | null): ValuationAdapter => ({
  name: "valuation:fake",
  async estimate() {
    return est;
  },
});

const EST: ValuationEstimate = {
  currency: "CAD",
  fmvLo: 50,
  fmvHi: 130,
  marketInterest: "modest",
  basis: "2004 RCM proof dollar, mintage 25,000, in full original packaging.",
  factors: [
    { name: "Limited mintage (25,000)", kind: "lift", effect: "scarcity supports the upper range" },
    { name: "Indicative estimate", kind: "info", effect: "not based on live comparable sales" },
  ],
  confidence: "moderate",
};

describe("F-8 indicative mode — a labelled machine estimate, score untouched", () => {
  beforeEach(() => resetStubRegistry());

  it("attaches a clearly-labelled indicative band when the adapter returns an estimate", async () => {
    const res = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      { ...adapters(), valuation: fakeValuation(EST) },
      appraiseOrder(),
      { profile: calibratedCoins() },
    );
    const v = res.snapshot.valuation!;
    expect(v).toMatchObject({ fmvLo: 50, fmvHi: 130, indicative: true, estimateConfidence: "moderate" });
    expect(v.basis).toContain("mintage");
    expect(v.factors.some((f) => f.kind === "info")).toBe(true);

    const html = renderReport(res.snapshot);
    expect(html).toContain("CAD 50–130");
    expect(html).toContain("Machine estimate — not a certified appraisal");
    expect(html).toContain("Market interest: modest");
    expect(html).not.toContain("Indicative value — under expert review"); // the valuation-pending line is gone (the provisional watermark is a separate line)
    expect(html.toLowerCase()).not.toContain("certified appraisal</h"); // ceiling: never a certified-appraisal header
  });

  it("a null estimate degrades to the F-8 default — no band, 'under expert review'", async () => {
    const res = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      { ...adapters(), valuation: fakeValuation(null) },
      appraiseOrder(),
      { profile: calibratedCoins() },
    );
    expect(res.snapshot.valuation!.fmvLo).toBeUndefined();
    expect(renderReport(res.snapshot)).toContain("Indicative value — under expert review");
  });

  it("the indicative valuation NEVER moves the score (F-8 independence)", async () => {
    const withVal = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      { ...adapters(), valuation: fakeValuation(EST) },
      appraiseOrder(),
      { profile: calibratedCoins() },
    );
    const without = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      adapters(),
      appraiseOrder(),
      { profile: calibratedCoins() },
    );
    // Composite is a deterministic weighted sum of the quadrant raws (no seed) —
    // identical inputs ⇒ identical composite whether or not a value was attached.
    expect(withVal.score.composite).toBe(without.score.composite);
  });
});
