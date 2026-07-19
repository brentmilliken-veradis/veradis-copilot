// Fine-art calibration anchors (provenance-first, artist-gated). Proves the model
// end to end through enrich → score, with a Tier-1 art resolver standing in for the
// live web-search adapter:
//   - a documented (confirmed) artist + a documented provenance chain + no red
//     flags reaches GOLD;
//   - a documented provenance chain whose ARTIST is NOT confirmed stays below Gold
//     (the gate: provenance can't launder an unverified attribution to Gold);
//   - an attribution red flag (a reproduction sold as an original) can NOT reach a
//     confident tier no matter how good the story.
// Ground truth shape: a documented artist work bought from a real gallery with the
// receipt held (Harrison Galleries, Vancouver) — the owner's own art profile.

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

type RedFlag = { key: string; evidenceSlot: string; note: string };

// Confirms the artist (the gate) and the specific work — what the live resolver
// closes when the artist is documented and the work is in the record.
function resolver(confirmedKeys: Record<string, string>): SourceAdapter {
  return {
    name: "Art reference",
    tier: 1,
    role: "ground_truth",
    categories: ["art"],
    async lookup() {
      return { adapter: "Art reference", tier: 1, role: "ground_truth" as const, matched: false, name: "Art reference", retrievalState: "pending" as const };
    },
    async resolveObject(): Promise<ObjectResolution> {
      const matched = !!confirmedKeys.artist;
      return { matched, sourceName: "Art reference", url: matched ? "https://www.askart.com/artist/x" : undefined, tier: 1, confirmedKeys: matched ? confirmedKeys : {} };
    },
  };
}

const ATTRS = {
  artist: "Nicolas Bott",
  title: "Alpine II",
  medium: "Oil on canvas",
  dimensions: "24 x 36 in",
  signature_inscription: "signed lower right",
  maker: "Nicolas Bott",
};
const DOCUMENTED_NOTES =
  "Single owner from new. Purchased new in 1998 from Harrison Galleries, Vancouver — original gallery receipt held. Held since. Signed lower right.";

async function score(objectId: string, opts: { notes?: string; confirmed?: Record<string, string>; redFlags?: RedFlag[]; materialHint?: MaterialCheckInput[] } = {}) {
  const repo = new InMemoryRepository();
  const r0 = await repo.createReport({ orderId: `o-${objectId}`, objectId, category: "art" });
  const report = await repo.updateReport(r0.id, { status: "paid" });
  const resolved = opts.notes ? { ...ATTRS, notes: opts.notes } : { ...ATTRS };
  // A work found in the record (catalogue raisonné / auction lot) confirms the
  // work's documented fields, not just the artist — that's what reaches Gold.
  const confirmed = opts.confirmed ?? { artist: "Nicolas Bott", title: "Alpine II", medium: "Oil on canvas", dimensions: "24 x 36 in" };
  const enr = await enrich(
    repo,
    { sources: [resolver(confirmed)], embedder: new StubEmbeddingAdapter(), graph: new StubGraphAdapter(), sanctions: new StubSanctionsAdapter() },
    { report, profile: loadProfile("art"), declaredAttributes: resolved, resolvedAttributes: resolved, redFlags: opts.redFlags ?? [], materialHint: opts.materialHint },
  );
  const s = scorePcs(enr.scoreInputs);
  return { tier: s.tier, ciLo: s.ci.lo, inputs: enr.scoreInputs, repo, reportId: report.id };
}

describe("art calibration anchors — provenance-first, artist-gated", () => {
  it("documented artist + documented provenance (gallery receipt) + no red flags → GOLD (floor ≥ 80)", async () => {
    const r = await score("bott-gold", { notes: DOCUMENTED_NOTES });
    expect(r.tier).toBe("gold");
    expect(r.ciLo).toBeGreaterThanOrEqual(80);
    expect(r.inputs.firstOwnerFromNew).toBe(true);
    const idResolved = (await r.repo.listChecks(r.reportId)).filter((c) => c.quadrant === "identity" && c.authorityState === "resolved");
    expect(idResolved.some((c) => c.key === "artist")).toBe(true);
  });

  it("documented provenance but ARTIST NOT confirmed → NOT Gold (the gate)", async () => {
    const r = await score("bott-unconfirmed", { notes: DOCUMENTED_NOTES, confirmed: {} });
    expect(r.tier).not.toBe("gold");
    // The gate suppresses the complete-provenance lift: no first-owner-from-new credit.
    expect(r.inputs.firstOwnerFromNew).toBe(false);
  });

  it("artist confirmed but NO provenance → not Gold (provenance-first)", async () => {
    const r = await score("bott-no-prov");
    expect(r.tier).not.toBe("gold");
  });

  it("a reproduction sold as an original (attribution red flag) can NOT reach a confident tier", async () => {
    const r = await score("bott-repro", {
      notes: DOCUMENTED_NOTES,
      redFlags: [{ key: "print_as_painting", evidenceSlot: "detail_raking_light", note: "uniform rosette dot pattern under magnification" }],
    });
    expect(r.tier).not.toBe("gold");
    expect(r.tier).not.toBe("silver");
    expect(r.inputs.firstOwnerFromNew).toBe(false); // attribution veto strips the lift
  });
});
