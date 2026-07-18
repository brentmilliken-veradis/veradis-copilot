// Watch fixtures for the calibration harness. Mirrors coin-2007 but assembles a
// full runProvisional input (order + adapters) for a WATCH, with the evidence
// strength dialled by preset so the profile→enrich→score path can be exercised
// end-to-end. These are constructed fixtures that prove the PLUMBING — the
// field-golden set (real objects, expert-assigned tiers) is what backs the flip.

import type { PipelineAdapters } from "@/packages/pipeline/run";
import type { OrderIntake } from "@/packages/intake/types";
import type { CategoryProfile } from "@/packages/pcs-types";
import { StubVisionAdapter, type VisionScenario } from "@/packages/adapters/vision";
import { brandArchiveAdapter, watchChartsAdapter, type SourceScenario } from "@/packages/adapters/source";
import { StubEmbeddingAdapter } from "@/packages/adapters/embedding";
import { StubGraphAdapter } from "@/packages/adapters/graph";
import { StubSanctionsAdapter } from "@/packages/adapters/sanctions";
import { StubNarrativeAdapter } from "@/packages/adapters/narrative";
import { loadProfile } from "@/packages/profiles/loader";

export type WatchPreset = "genuine_strong" | "franken";

/** A genuine Rolex Submariner 16610 with full papers — every identity key
 *  resolves against the brand archive (Tier-1), clean movement, documented
 *  custody. The kind of object that should earn a confident tier once watches
 *  is calibrated. */
const GENUINE: Record<string, string> = {
  brand: "Rolex",
  reference: "16610",
  serial_number: "P114xxxx",
  movement_calibre: "3135",
  dial_configuration: "black dial, luminous hour markers, Mercedes hands",
};

/** A frankenwatch: a genuine case but a redial and a non-genuine movement — the
 *  engine must register the material-integrity failures and refuse a confident
 *  tier even with the category calibrated. */
const FRANKEN: Record<string, string> = { ...GENUINE, serial_number: "unknown", movement_calibre: "unknown" };

export interface WatchFixture {
  order: OrderIntake;
  adapters: PipelineAdapters;
  /** The watches profile force-calibrated — pass as runProvisional opts.profile to
   *  see the UNCAPPED tier (the registry profile ships provisional and would cap). */
  calibratedProfile: CategoryProfile;
}

function photos(): OrderIntake["photos"] {
  const slots = ["dial_front", "caseback", "serial_macro", "movement", "clasp_buckle", "papers_warranty"];
  return slots.map((s) => ({ filename: `${s}.jpg`, bytes: new TextEncoder().encode(s), slot: s }));
}

/** Build a watch end-to-end fixture for the given preset. `objectId` seeds the
 *  scorer, so vary it per case for independent CI streams. */
export function buildWatchFixture(preset: WatchPreset, objectId = `watch-${preset}`): WatchFixture {
  const declared = preset === "franken" ? FRANKEN : GENUINE;

  // Brand-archive (Tier-1) closes every SUPPLIED identity key for the genuine
  // watch; the franken leaves serial/calibre unresolved.
  const archive: SourceScenario = {};
  for (const [k, v] of Object.entries(declared)) {
    if (v !== "unknown") archive[`${k}=${v}`] = { matched: true, url: "https://archive.example/extract" };
  }

  const vision: Record<string, VisionScenario> =
    preset === "franken"
      ? {
          [objectId]: {
            derivedAttributes: { ...declared },
            redFlags: [
              { key: "redial", evidenceSlot: "dial_front", note: "Reprinted dial: font and minute track inconsistent with reference." },
              { key: "fake_movement", evidenceSlot: "movement", note: "Movement architecture does not match the claimed calibre." },
            ],
          },
        }
      : { [objectId]: { derivedAttributes: { ...declared }, redFlags: [] } };

  const adapters: PipelineAdapters = {
    vision: new StubVisionAdapter(vision),
    sources: [brandArchiveAdapter(archive), watchChartsAdapter()],
    embedder: new StubEmbeddingAdapter(),
    graph: new StubGraphAdapter(
      preset === "genuine_strong"
        ? { [objectId]: [{ institution: "Rolex Service Centre", relation: "service-record", confidence: 0.8 }] }
        : {},
    ),
    sanctions: new StubSanctionsAdapter(),
    narrative: new StubNarrativeAdapter(),
  };

  const order: OrderIntake = {
    orderId: `ord-${objectId}`,
    objectId,
    category: "watches",
    sku: "verify",
    declaredAttributes: declared,
    ownerFacingName: preset === "franken" ? "Rolex Submariner (as presented)" : "Rolex Submariner 16610",
    photos: photos(),
  };

  const calibratedProfile: CategoryProfile = { ...loadProfile("watches"), calibration: "calibrated" };
  return { order, adapters, calibratedProfile };
}
