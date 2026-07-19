// Recalibration anchors (2026-07-19). Proves the custody-completeness + moot-
// register-on-first-owner-from-new recalibration end-to-end through enrich → score:
//   - a documented single-owner-from-new, catalogue-confirmed coin reaches GOLD;
//   - identity-confirmed but NO provenance stays SILVER (mid-confidence, honest);
//   - a from-new CLAIM with no documents stays SILVER (a bare claim can't buy Gold);
//   - a material-inconsistent object can NOT be laundered to Gold by a good story.
// Ground truth: the 2004 Canada "Poppy" silver dollar (Numista #27776).

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

// Numista confirms 4 of 5 identity keys (country/year/denomination/mint), exactly
// as it does for the real Poppy in production.
const numista: SourceAdapter = {
  name: "Numista",
  tier: 1,
  role: "ground_truth",
  categories: ["coins"],
  async lookup() {
    return { adapter: "Numista", tier: 1, role: "ground_truth" as const, matched: false, name: "Numista", retrievalState: "pending" as const };
  },
  async resolveObject(): Promise<ObjectResolution> {
    return {
      matched: true,
      sourceName: "Numista",
      url: "https://en.numista.com/27776",
      tier: 1,
      confirmedKeys: { country: "Canada", year: "2004", denomination: "Dollar", mint_mark: "Royal Canadian Mint" },
    };
  },
};

const ATTRS = {
  country: "Canada",
  year: "2004",
  denomination: "Dollar",
  mint_mark: "Royal Canadian Mint",
  variety: "Proof",
  title: 'Special Edition Proof Silver Dollar "The Poppy"',
};
const POPPY_NOTES =
  "Single owner — a family Christmas gift, held since new. In its original Royal Canadian Mint casing and red presentation box, with certificate of authenticity (no. 03340). Coin in mint condition.";

async function score(objectId: string, opts: { notes?: string; materialHint?: MaterialCheckInput[] } = {}) {
  const repo = new InMemoryRepository();
  const r0 = await repo.createReport({ orderId: `o-${objectId}`, objectId, category: "coins" });
  const report = await repo.updateReport(r0.id, { status: "paid" });
  const resolved = opts.notes ? { ...ATTRS, notes: opts.notes } : { ...ATTRS };
  const enr = await enrich(
    repo,
    { sources: [numista], embedder: new StubEmbeddingAdapter(), graph: new StubGraphAdapter(), sanctions: new StubSanctionsAdapter() },
    { report, profile: loadProfile("coins"), declaredAttributes: resolved, resolvedAttributes: resolved, redFlags: [], materialHint: opts.materialHint },
  );
  const s = scorePcs(enr.scoreInputs);
  return { tier: s.tier, ciLo: s.ci.lo, inputs: enr.scoreInputs, repo, reportId: report.id };
}

describe("recalibration anchors — Gold rises, fakes and bare cases stay down", () => {
  it("documented single-owner-from-new + catalogue-confirmed identity → GOLD (floor ≥ 80)", async () => {
    const r = await score("poppy-gold", { notes: POPPY_NOTES });
    expect(r.tier).toBe("gold");
    expect(r.ciLo).toBeGreaterThanOrEqual(80);
    expect(r.inputs.firstOwnerFromNew).toBe(true);
    // The stolen-property register is recorded as moot, not a gap.
    const theft = (await r.repo.listChecks(r.reportId)).find((c) => c.key === "stolen_registry");
    expect(theft?.result).toBe("match");
    expect(theft?.authorityState).toBe("resolved");
  });

  it("catalogue-confirmed identity but NO provenance → SILVER (mid-confidence, not Gold)", async () => {
    const r = await score("coin-no-prov");
    expect(r.tier).toBe("silver");
    expect(r.inputs.firstOwnerFromNew).toBe(false);
  });

  it("a from-new CLAIM with NO documents → SILVER (a bare claim can't buy Gold)", async () => {
    const r = await score("coin-claim-only", { notes: "Owned from new, never sold. No paperwork." });
    expect(r.tier).toBe("silver");
    // No documents → the timeline is not complete, so the register is NOT moot and
    // custody cannot reach Gold. An undocumented claim earns identity, not confidence.
    expect(r.inputs.firstOwnerFromNew).toBe(false);
    expect(r.tier).not.toBe("gold");
  });

  it("a material-inconsistent object can NOT be laundered up the tiers by a perfect story", async () => {
    const r = await score("coin-fake", {
      notes: POPPY_NOTES,
      materialHint: [{ key: "surface_strike_luster", weight: 1, consistency: "inconsistent", present: true }],
    });
    // The material veto strips the complete-timeline lift (no clean register)…
    expect(r.inputs.firstOwnerFromNew).toBe(false);
    // …and a forensic inconsistency can never present as a confident tier.
    expect(r.tier).not.toBe("gold");
    expect(r.tier).not.toBe("silver");
  });
});
