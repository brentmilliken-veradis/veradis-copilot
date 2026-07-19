// Ingestion stage (E3). Runs vision over the evidence, applies the C2PA gate ④,
// and does mislabel correction: the owner's typed label is a hypothesis; where
// the images contradict it, the engine writes a first-class correction (kindness
// register) and re-routes the category if the object is not what was declared.
// No scoring here — resolved attributes + corrections feed E4/E5.

import type {
  Category,
  CategoryProfile,
  Correction,
  C2paState,
  Report,
} from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import type { VisionAdapter, VisionRedFlag } from "@/packages/adapters/vision";
import { loadProfile } from "@/packages/profiles/loader";

export interface IngestInput {
  report: Report;
  profile: CategoryProfile;
  declaredAttributes: Record<string, string>;
  evidence: { id: string; slot: string; sha256: string; storagePath: string }[];
}

export interface IngestResult {
  report: Report;
  profile: CategoryProfile;
  declaredAttributes: Record<string, string>;
  resolvedAttributes: Record<string, string>;
  corrections: Correction[];
  redFlags: VisionRedFlag[];
  c2pa: Record<string, C2paState>;
  rerouted: boolean;
  /** Vision's pick of the photo slot that best shows the object itself (for the
   *  report hero + collection card). Undefined when vision named none / is stubbed. */
  heroSlot?: string;
}

const norm = (v: string): string => v.trim().toLowerCase();

function kindnessNote(label: string, claimed: string, corrected: string): string {
  return `You catalogued the ${label} as “${claimed}”. The images read “${corrected}” — an easy one to miss. We've corrected it and re-scored accordingly.`;
}

export async function ingest(
  repo: Repository,
  vision: VisionAdapter,
  input: IngestInput,
): Promise<IngestResult> {
  const { report, declaredAttributes } = input;
  let profile = input.profile;

  const vr = await vision.analyze({
    objectId: report.objectId,
    category: report.category,
    declaredAttributes,
    evidence: input.evidence.map((e) => ({ slot: e.slot, sha256: e.sha256, storagePath: e.storagePath })),
  });

  // Gate ④ — write each image's C2PA state. An invalid credential is a red flag.
  const redFlags: VisionRedFlag[] = [...vr.redFlags];
  for (const e of input.evidence) {
    const state = vr.c2pa[e.slot] ?? "unchecked";
    await repo.updateEvidence(e.id, { c2paState: state });
    if (state === "invalid") {
      redFlags.push({ key: "c2pa_invalid", evidenceSlot: e.slot, note: "content credential failed validation" });
    }
  }

  // Category re-route — the object is not the category the owner picked.
  let rerouted = false;
  let updatedReport = report;
  const corrections: Correction[] = [];
  if (vr.derivedCategory && vr.derivedCategory !== report.category) {
    const claimedCat: Category = report.category;
    const c = await repo.addCorrection({
      reportId: report.id,
      claimed: `category: ${claimedCat}`,
      evidence: "vision attribute-from-image",
      correctedValue: `category: ${vr.derivedCategory}`,
      kindnessNote: kindnessNote("category", claimedCat, vr.derivedCategory),
    });
    corrections.push(c);
    updatedReport = await repo.updateReport(report.id, { category: vr.derivedCategory });
    profile = loadProfile(vr.derivedCategory);
    rerouted = true;
  }

  // Per-attribute mislabel correction over the (possibly re-routed) profile's
  // identity keys. A correction only fires when declared and derived both exist
  // and genuinely differ.
  const resolvedAttributes: Record<string, string> = { ...declaredAttributes };
  for (const key of profile.identityKeys.map((k) => k.key)) {
    const claimed = declaredAttributes[key];
    const derived = vr.derivedAttributes[key];
    if (derived === undefined) continue;
    resolvedAttributes[key] = derived;
    if (claimed !== undefined && norm(claimed) !== norm(derived)) {
      const label = profile.identityKeys.find((k) => k.key === key)?.label ?? key;
      const c = await repo.addCorrection({
        reportId: report.id,
        claimed,
        evidence: `derived from images (${key})`,
        correctedValue: derived,
        kindnessNote: kindnessNote(label, claimed, derived),
      });
      corrections.push(c);
    }
  }
  // Attributes the owner never supplied but the engine derived get added too.
  for (const [k, v] of Object.entries(vr.derivedAttributes)) {
    if (!(k in resolvedAttributes)) resolvedAttributes[k] = v;
  }

  return {
    report: updatedReport,
    profile,
    declaredAttributes,
    resolvedAttributes,
    corrections,
    redFlags,
    c2pa: vr.c2pa,
    rerouted,
    heroSlot: vr.heroSlot,
  };
}
