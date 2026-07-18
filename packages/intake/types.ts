// Intake input types (E2). A paid Stripe order + a Tally photo submission become
// an OrderIntake, which the intake stage turns into a report + evidence rows.

import type { Category } from "@/packages/pcs-types";

export type Sku = "verify" | "appraise"; // CHF 20 / CHF 40 (flat, for now)

export interface PhotoInput {
  filename: string;
  bytes: Uint8Array;
  /** Optional profile slot id; if absent, intake maps photos to core slots in order. */
  slot?: string;
  exifTs?: string | null;
}

export interface OrderIntake {
  orderId: string;
  /** Object identity; derived as `obj:<orderId>` when the buyer supplies none. */
  objectId?: string;
  category: Category;
  sku: Sku;
  /** The owner's typed label — a hypothesis the engine will test in E3. */
  declaredAttributes: Record<string, string>;
  ownerFacingName?: string;
  photos: PhotoInput[];
  ownerLocale?: string;
  currency?: string;
  /** Paid add-ons purchased alongside the base SKU. `theftRegistry` = the hard
   *  stolen-property register check (e.g. The Watch Register for watches). When
   *  absent, the base report discloses the register was NOT checked and the risk
   *  CI is not tightened by it. */
  addons?: { theftRegistry?: boolean };
}
