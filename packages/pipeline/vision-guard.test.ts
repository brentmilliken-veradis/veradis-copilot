// F-2 (D-2) — vision may only downgrade, never move the number up. The guard
// lives at the ingest→enrich seam (scorer core untouched): an uncorroborated
// vision-only value earns no identity credit.

import { beforeEach, describe, expect, it } from "vitest";
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
import type { OrderIntake } from "@/packages/intake/types";

const enc = new TextEncoder();

function adapters(vision: Record<string, VisionScenario> = {}): PipelineAdapters {
  return {
    vision: new StubVisionAdapter(vision),
    sources: [pcgsAdapter(), numistaAdapter()], // no scenarios — nothing resolves
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(),
    sanctions: new StubSanctionsAdapter(),
    narrative: new StubNarrativeAdapter(),
  };
}

function coinOrder(objectId: string, declared: Record<string, string>): OrderIntake {
  return {
    orderId: `ord-${objectId}`,
    objectId,
    category: "coins",
    sku: "verify",
    declaredAttributes: declared,
    photos: [
      { filename: "obv.jpg", bytes: enc.encode("OBV") },
      { filename: "rev.jpg", bytes: enc.encode("REV") },
    ],
  };
}

const DECLARED = { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM", variety: "Proof" };

async function composite(objectId: string, declared: Record<string, string>, vision: Record<string, VisionScenario>) {
  const res = await runProvisional(new InMemoryRepository(), new StubStorage(), adapters(vision), coinOrder(objectId, declared));
  return res;
}

describe("F-2 — vision cannot raise the score", () => {
  beforeEach(() => resetStubRegistry());

  it("an uncorroborated vision 'upgrade' of a declared attribute LOWERS the composite", async () => {
    const baseline = await composite("c-base", DECLARED, {}); // vision echoes declaration
    const upgraded = await composite("c-upgrade", DECLARED, {
      "c-upgrade": { derivedAttributes: { mint_mark: "Ottawa Mint (rarer)" } },
    });

    expect(upgraded.snapshot.score.composite).toBeLessThan(baseline.snapshot.score.composite);
    // The conflict is on the record as a correction + an uncredited check.
    expect(upgraded.corrections.some((c) => c.claimed === "RCM")).toBe(true);
    const check = upgraded.snapshot.checks.find((c) => c.key === "mint_mark");
    expect(check?.note).toMatch(/no corroborating source — not credited/);
    expect(check?.authorityState).toBe("declared");
  });

  it("an uncorroborated vision-ADDED attribute cannot lift the score above the missing baseline", async () => {
    const partial = { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM" }; // no variety
    const missing = await composite("c-missing", partial, {}); // variety stays missing
    const filled = await composite("c-filled", partial, {
      "c-filled": { derivedAttributes: { variety: "Proof" } },
    });

    expect(filled.snapshot.score.composite).toBeLessThanOrEqual(missing.snapshot.score.composite);
    const check = filled.snapshot.checks.find((c) => c.key === "variety");
    expect(check?.result).toBe("gap_held_open");
    expect(check?.note).toMatch(/held open, not credited/);
  });

  it("a CORROBORATED vision correction still earns full Tier-1 credit (mislabel demo intact)", async () => {
    const res = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      {
        ...adapters({ "c-mislabel": { derivedAttributes: { year: "2007" } } }),
        sources: [pcgsAdapter({ "year=2007": { matched: true } }), numistaAdapter()],
      },
      coinOrder("c-mislabel", { ...DECLARED, year: "2008" }),
    );
    const check = res.snapshot.checks.find((c) => c.key === "year");
    expect(check?.result).toBe("corrected");
    expect(check?.authorityState).toBe("resolved"); // Tier-1 corroborated the corrected value
  });

  it("vision-confirms-declaration is a no-op on the score (regression)", async () => {
    const echo = await composite("c-echo", DECLARED, {});
    const confirmed = await composite("c-confirm", DECLARED, {
      "c-confirm": { derivedAttributes: { ...DECLARED } },
    });
    expect(confirmed.snapshot.score.composite).toBe(echo.snapshot.score.composite);
  });

  it("R-2: an uncorroborated vision attribute cannot lift the composite through CUSTODY", async () => {
    // Attribute-keyed graph stub: a link exists only when the cross-ref sees
    // `provenance_hint` (today's objectId-keyed stub is attribute-blind and
    // could never catch this channel).
    const attrGraph = {
      name: "graph:attr-keyed",
      crossRef: async (q: { attributes: Record<string, string> }) =>
        q.attributes.provenance_hint
          ? [{ institution: "Fake Museum", relation: "same-collection", confidence: 0.9 }]
          : [],
    };

    // Baseline: no hint anywhere.
    const baseline = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      { ...adapters(), graph: attrGraph },
      coinOrder("c-cust-base", DECLARED),
    );

    // Attack: vision ADDS provenance_hint (uncorroborated) — must not lift.
    const visionAdds = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      { ...adapters({ "c-cust-vis": { derivedAttributes: { provenance_hint: "ex-Royal Collection" } } }), graph: attrGraph },
      coinOrder("c-cust-vis", DECLARED),
    );
    expect(visionAdds.snapshot.score.composite).toBeLessThanOrEqual(baseline.snapshot.score.composite);
    expect(visionAdds.snapshot.checks.filter((c) => c.quadrant === "custody")).toHaveLength(0); // no link earned

    // Positive control: the OWNER declares the hint → the channel works and lifts.
    const ownerDeclares = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      { ...adapters(), graph: attrGraph },
      coinOrder("c-cust-decl", { ...DECLARED, provenance_hint: "ex-Royal Collection" }),
    );
    expect(ownerDeclares.snapshot.score.composite).toBeGreaterThan(baseline.snapshot.score.composite);
    expect(ownerDeclares.snapshot.checks.some((c) => c.quadrant === "custody")).toBe(true);
  });

  it("R-2: a Tier-1-corroborated vision correction still reaches custody", async () => {
    const attrGraph = {
      name: "graph:attr-keyed",
      crossRef: async (q: { attributes: Record<string, string> }) =>
        q.attributes.year === "2007" ? [{ institution: "Royal Canadian Mint", relation: "same-issue", confidence: 0.8 }] : [],
    };
    const res = await runProvisional(
      new InMemoryRepository(),
      new StubStorage(),
      {
        ...adapters({ "c-cust-corr": { derivedAttributes: { year: "2007" } } }),
        sources: [pcgsAdapter({ "year=2007": { matched: true } }), numistaAdapter()],
        graph: attrGraph,
      },
      coinOrder("c-cust-corr", { ...DECLARED, year: "2008" }), // owner mislabelled
    );
    // The corrected + Tier-1-resolved year flows to the graph → custody link.
    expect(res.snapshot.checks.some((c) => c.quadrant === "custody")).toBe(true);
  });

  it("a vision-only category re-route seals capped and cannot be confirmed", async () => {
    const repo = new InMemoryRepository();
    const res = await runProvisional(
      repo,
      new StubStorage(),
      adapters({ "c-reroute": { derivedCategory: "medals" } }), // calibrated target — cap must still apply
      coinOrder("c-reroute", {
        // Owner-declared attributes that map onto the medals profile, so the
        // rerouted report is scoreable (otherwise it refunds as unscored).
        naming: "12345 Pte. J. Smith, Seaforth Highlanders",
        rank: "Private",
        unit: "Seaforth Highlanders of Canada",
        campaign: "1939–45 Star",
        gazette: "LG 37012",
      }),
    );
    expect(res.report.category).toBe("medals");
    expect(res.snapshot.capReason).toBe("vision_reroute");
    expect(["gold", "silver", "bronze"]).not.toContain(res.snapshot.score.tier);
    expect(res.report.status).toBe("provisional");
    await expect(
      confirmReport(repo, { reportId: res.report.id, curator: "Curator", credentialClass: "curator", verb: "confirmed" }),
    ).rejects.toThrow(/capped \(vision_reroute\)/);
  });
});
