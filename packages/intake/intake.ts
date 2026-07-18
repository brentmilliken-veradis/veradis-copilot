// Intake stage (E2). Paid order → job: create the report, store + hash every
// photo as an evidence_item, select the category profile, and move the report
// created → paid. No scoring here — that is E3–E5.

import type { EvidenceItem, Report, CategoryProfile } from "@/packages/pcs-types";
import type { Repository } from "@/packages/data/repository";
import type { Storage } from "@/packages/adapters/storage";
import { loadProfile, validateProfile } from "@/packages/profiles/loader";
import { assertTransition } from "@/packages/orchestrator/state";
import type { OrderIntake } from "./types";

export interface IntakeResult {
  report: Report;
  evidence: EvidenceItem[];
  profile: CategoryProfile;
  /** Fraction of the profile's core capture slots that received a photo. */
  coverage: { covered: number; required: number };
}

/** Map photos to capture slots: honour an explicit slot, else fill the profile's
 *  core slots in order, then overflow to `extra_<n>`. */
function assignSlots(profile: CategoryProfile, count: number, explicit: (string | undefined)[]): string[] {
  const coreSlots = profile.captureSlots.filter((s) => s.core).map((s) => s.slotId);
  let next = 0;
  return Array.from({ length: count }, (_, i) => {
    if (explicit[i]) return explicit[i] as string;
    if (next < coreSlots.length) return coreSlots[next++];
    return `extra_${i - coreSlots.length + 1}`;
  });
}

export async function intakeOrder(
  repo: Repository,
  storage: Storage,
  order: OrderIntake,
  /** Optional profile override (version pin / test seam). Validated like any
   *  registry profile; defaults to the registry profile for the order category. */
  profileOverride?: CategoryProfile,
): Promise<IntakeResult> {
  const profile = profileOverride ? validateProfile(profileOverride) : loadProfile(order.category); // throws on an unsupported category
  const objectId = order.objectId ?? `obj:${order.orderId}`;

  const report = await repo.createReport({
    orderId: order.orderId,
    objectId,
    category: order.category,
    status: "created",
  });

  const slots = assignSlots(profile, order.photos.length, order.photos.map((p) => p.slot));
  const evidence: EvidenceItem[] = [];
  for (let i = 0; i < order.photos.length; i++) {
    const photo = order.photos[i];
    const stored = await storage.put(`${report.id}/${slots[i]}/${photo.filename}`, photo.bytes);
    const item = await repo.addEvidence({
      reportId: report.id,
      slot: slots[i],
      storagePath: stored.path,
      sha256: stored.sha256,
      exifTs: photo.exifTs ?? null,
      c2paState: "unchecked", // set in E3's ingestion gate
      kind: "photo",
    });
    evidence.push(item);
  }

  // Payment already captured upstream (Stripe webhook) — record the move.
  assertTransition(report.status, "paid");
  const paid = await repo.updateReport(report.id, { status: "paid" });

  const coreRequired = profile.captureSlots.filter((s) => s.core).length;
  const coveredCore = new Set(
    evidence.map((e) => e.slot).filter((slot) => profile.captureSlots.some((s) => s.core && s.slotId === slot)),
  ).size;

  return {
    report: paid,
    evidence,
    profile,
    coverage: { covered: coveredCore, required: coreRequired },
  };
}
