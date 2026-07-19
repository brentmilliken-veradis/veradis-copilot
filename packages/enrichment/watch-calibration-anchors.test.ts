// Watch calibration anchors (category #2). Proves the watches Gold-path end to
// end through enrich → score, with a Tier-1 reference resolver standing in for the
// live web-search adapter:
//   - a documented single-owner-from-new watch, full set (box + papers), with its
//     reference CONFIRMED reaches GOLD;
//   - reference confirmed but NO provenance stays SILVER (honest mid-confidence);
//   - a redial / material inconsistency can NOT be laundered to Gold by a good story.
// Ground truth: an Omega Speedmaster Professional "Moonwatch" ref 311.30.42.30.01.005.

import { describe, it, expect } from "vitest";
import { enrich } from "./enrich";
import { scorePcs } from "@/packages/pcs-core";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { loadProfile } from "@/packages/profiles/loader";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import type { SourceAdapter, ObjectResolution } from "@/packages/adapters/source";
import type { MaterialCheckInput } from "@/packages/pcs-types";

// The reference resolver confirms brand + reference + movement calibre — exactly
// what the live web-search adapter closes for a clearly-resolved reference.
const resolver: SourceAdapter = {
  name: "Watch reference",
  tier: 1,
  role: "ground_truth",
  categories: ["watches"],
  async lookup() {
    return { adapter: "Watch reference", tier: 1, role: "ground_truth" as const, matched: false, name: "Watch reference", retrievalState: "pending" as const };
  },
  async resolveObject(): Promise<ObjectResolution> {
    return {
      matched: true,
      sourceName: "Watch reference",
      url: "https://www.omegawatches.com/watch-311-30-42-30-01-005",
      tier: 1,
      confirmedKeys: { brand: "Omega", reference: "311.30.42.30.01.005", movement_calibre: "1861" },
    };
  },
};

const ATTRS = {
  brand: "Omega",
  reference: "311.30.42.30.01.005",
  serial_number: "87654321",
  movement_calibre: "1861",
  dial_configuration: "black",
  title: "Omega Speedmaster Professional Moonwatch",
};
const FULL_SET_NOTES =
  "Single owner from new. Purchased new in 2015 from an authorised dealer. Full set — original box, warranty card and service papers, serial matching the caseback. Mint condition.";

async function score(objectId: string, opts: { notes?: string; materialHint?: MaterialCheckInput[] } = {}) {
  const repo = new InMemoryRepository();
  const r0 = await repo.createReport({ orderId: `o-${objectId}`, objectId, category: "watches" });
  const report = await repo.updateReport(r0.id, { status: "paid" });
  const resolved = opts.notes ? { ...ATTRS, notes: opts.notes } : { ...ATTRS };
  const enr = await enrich(
    repo,
    { sources: [resolver], embedder: new StubEmbeddingAdapter(), graph: new StubGraphAdapter(), sanctions: new StubSanctionsAdapter() },
    { report, profile: loadProfile("watches"), declaredAttributes: resolved, resolvedAttributes: resolved, redFlags: [], materialHint: opts.materialHint },
  );
  const s = scorePcs(enr.scoreInputs);
  return { tier: s.tier, ciLo: s.ci.lo, inputs: enr.scoreInputs, repo, reportId: report.id };
}

describe("watch calibration anchors — a documented, reference-confirmed watch reaches Gold", () => {
  it("full set (box + papers) + single-owner-from-new + reference confirmed → GOLD (floor ≥ 80)", async () => {
    const r = await score("omega-gold", { notes: FULL_SET_NOTES });
    expect(r.tier).toBe("gold");
    expect(r.ciLo).toBeGreaterThanOrEqual(80);
    expect(r.inputs.firstOwnerFromNew).toBe(true);
    // Identity closed by the reference resolver, not merely declared.
    const idResolved = (await r.repo.listChecks(r.reportId)).filter(
      (c) => c.quadrant === "identity" && c.authorityState === "resolved",
    );
    expect(idResolved.some((c) => c.key === "reference")).toBe(true);
    // First owner from new → the stolen-property register is moot, not a gap.
    const theft = (await r.repo.listChecks(r.reportId)).find((c) => c.key === "stolen_registry");
    expect(theft?.result).toBe("match");
  });

  it("reference confirmed but NO provenance → SILVER (mid-confidence, not Gold)", async () => {
    const r = await score("omega-no-prov");
    expect(r.tier).toBe("silver");
    expect(r.inputs.firstOwnerFromNew).toBe(false);
  });

  it("a redial (material inconsistency) can NOT be laundered to Gold by a full-set story", async () => {
    const r = await score("omega-redial", {
      notes: FULL_SET_NOTES,
      materialHint: [{ key: "dial_configuration", weight: 1, consistency: "inconsistent", present: true }],
    });
    // The material veto strips the complete-timeline lift…
    expect(r.inputs.firstOwnerFromNew).toBe(false);
    // …and a forensic inconsistency can never present as a confident tier.
    expect(r.tier).not.toBe("gold");
    expect(r.tier).not.toBe("silver");
  });
});
