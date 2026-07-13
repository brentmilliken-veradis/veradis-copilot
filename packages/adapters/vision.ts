// Vision adapter (E3). Derives object attributes from photos, flags red flags,
// and reports each image's C2PA content-credential state. The real adapter calls
// a vision model; until VISION_API_KEY is set it runs as a fixture-replay stub
// (BUILD-KICKOFF §3). The stub NEVER invents attributes it wasn't given — with no
// scenario it echoes the owner's declaration (i.e. "no correction found").

import type { Category, C2paState } from "@/packages/pcs-types";
import { markStubbed } from "./stub-registry";

export interface VisionRequest {
  objectId: string;
  category: Category;
  declaredAttributes: Record<string, string>;
  evidence: { slot: string; sha256: string }[];
}

export interface VisionRedFlag {
  key: string;
  evidenceSlot: string;
  note: string;
}

export interface VisionResult {
  /** Attributes read from the images (the engine's own view of the object). */
  derivedAttributes: Record<string, string>;
  /** If the images say this is a different category than declared, re-route. */
  derivedCategory?: Category;
  redFlags: VisionRedFlag[];
  /** C2PA state per evidence slot (gate ④). */
  c2pa: Record<string, C2paState>;
}

export interface VisionAdapter {
  name: string;
  analyze(req: VisionRequest): Promise<VisionResult>;
}

/** A scenario pre-canned for the stub, keyed by objectId. */
export type VisionScenario = Partial<Omit<VisionResult, "c2pa">> & {
  c2pa?: Record<string, C2paState>;
};

export class StubVisionAdapter implements VisionAdapter {
  name = "vision:stub";
  constructor(private scenarios: Record<string, VisionScenario> = {}) {}

  async analyze(req: VisionRequest): Promise<VisionResult> {
    markStubbed(this.name, "VISION_API_KEY", "vision attribute-from-image + C2PA");
    const s = this.scenarios[req.objectId];
    return {
      derivedAttributes: s?.derivedAttributes ?? { ...req.declaredAttributes },
      derivedCategory: s?.derivedCategory,
      redFlags: s?.redFlags ?? [],
      // Default: content credentials absent (most consumer photos have none).
      c2pa: s?.c2pa ?? Object.fromEntries(req.evidence.map((e) => [e.slot, "absent" as C2paState])),
    };
  }
}

/** Adapter factory — live when the key is present, else the stub. */
export function getVisionAdapter(scenarios: Record<string, VisionScenario> = {}): VisionAdapter {
  // No live adapter yet; when VISION_API_KEY lands, branch to it here.
  return new StubVisionAdapter(scenarios);
}
