// verify.veradis.ai intake shape (R-1, revised per ADR-002 PULL contract).
// The push webhook (`/api/intake/veradis` + HMAC signature) is RETIRED — the
// report poller (packages/pollers/reports.ts) now reads the shared
// veradis-accounts queues directly and builds this shape from the `reports` +
// `objects` rows. What remains here is the neutral intake shape and its
// mapping into the pipeline's OrderIntake.

import type { Category } from "@/packages/pcs-types";
import type { OrderIntake, PhotoInput, Sku } from "./types";

export interface ParsedVeradisIntake {
  /** veradis-accounts reports.id — doubles as the copilot orderId AND the
   *  delivery-bridge write-back target. */
  reportId: string;
  /** veradis-accounts objects.id the report is on. */
  objectId: string;
  /** veradis-accounts profiles.id (auth user). */
  userId: string;
  email: string;
  ownerName: string | null;
  category: Category;
  sku: Sku;
  title: string | null;
  declaredAttributes: Record<string, string>;
  photoPaths: string[];
}

/** Map a store order + downloaded photos into the pipeline's intake shape.
 *  orderId = the veradis-accounts reports.id, so the delivery bridge (E-D)
 *  can address the write-back row straight off the copilot report. */
export function toOrderIntake(parsed: ParsedVeradisIntake, photos: PhotoInput[]): OrderIntake {
  return {
    orderId: parsed.reportId,
    objectId: parsed.objectId,
    category: parsed.category,
    sku: parsed.sku,
    declaredAttributes: parsed.declaredAttributes,
    ownerFacingName: parsed.title ?? parsed.ownerName ?? undefined,
    photos,
  };
}
