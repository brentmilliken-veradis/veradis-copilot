// verify.veradis.ai intake — signature verification and payload parsing (E-C).
// The verify-store stripe-webhook (metadata kind=`report`), after inserting the
// veradis-accounts `reports` row, POSTs this signed payload to
// /api/intake/veradis. HMAC scheme mirrors Tally: base64(HMAC-SHA256(raw body,
// shared secret)) in the `x-veradis-signature` header, secret in
// VERADIS_INTAKE_SIGNING_SECRET on both sides.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Category } from "@/packages/pcs-types";
import { ALL_CATEGORIES } from "@/packages/pcs-types";
import type { OrderIntake, PhotoInput, Sku } from "./types";

export const VERADIS_SIGNATURE_HEADER = "x-veradis-signature";

export function signVeradisPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export function verifyVeradisSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const a = Buffer.from(signVeradisPayload(rawBody, secret));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The wire contract verify-store sends. snake_case to match its JS conventions
 *  and the veradis-accounts schema it reads the values from. */
export interface VeradisIntakePayload {
  /** veradis-accounts reports.id — the paid row the webhook just inserted.
   *  Doubles as the copilot orderId AND the delivery-bridge write-back target. */
  report_id: string;
  /** veradis-accounts objects.id the report is on. */
  object_id: string;
  /** veradis-accounts profiles.id (auth user). */
  user_id: string;
  /** Collector's email (webhook already looked it up for its own notification). */
  email: string;
  owner_name?: string | null;
  /** reports.type — 'verify' | 'appraise' ('pcs' maps to verify). */
  type: string;
  /** Object category as catalogued; must be a copilot Category. */
  category: string;
  /** objects.title — the owner-facing name. */
  title?: string | null;
  /** The owner's catalogue entry — the hypothesis the engine tests. */
  declared_attributes?: Record<string, unknown> | null;
  /** objects.photo_paths — storage paths in the accounts object-photos bucket. */
  photo_paths: string[];
}

export interface ParsedVeradisIntake {
  reportId: string;
  objectId: string;
  userId: string;
  email: string;
  ownerName: string | null;
  category: Category;
  sku: Sku;
  title: string | null;
  declaredAttributes: Record<string, string>;
  photoPaths: string[];
}

export function parseVeradisIntake(payload: VeradisIntakePayload): ParsedVeradisIntake {
  const need = (v: unknown, name: string): string => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`payload missing ${name}`);
    return v.trim();
  };
  const reportId = need(payload.report_id, "report_id");
  const objectId = need(payload.object_id, "object_id");
  const userId = need(payload.user_id, "user_id");
  const email = need(payload.email, "email");

  const rawCategory = need(payload.category, "category").toLowerCase();
  const category = (ALL_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as Category)
    : undefined;
  if (!category) {
    throw new Error(`unsupported category "${payload.category}" — no copilot profile`);
  }

  const sku: Sku = String(payload.type).toLowerCase() === "appraise" ? "appraise" : "verify";

  const declaredAttributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload.declared_attributes ?? {})) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) declaredAttributes[k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] = s;
  }

  const photoPaths = (payload.photo_paths ?? []).filter((p): p is string => typeof p === "string" && !!p.trim());
  if (!photoPaths.length) throw new Error("payload has no photo_paths");

  return {
    reportId,
    objectId,
    userId,
    email,
    ownerName: payload.owner_name?.trim() || null,
    category,
    sku,
    title: payload.title?.trim() || null,
    declaredAttributes,
    photoPaths,
  };
}

/** Map a parsed store order + downloaded photos into the pipeline's intake
 *  shape. orderId = the veradis-accounts reports.id, so the delivery bridge
 *  (E-D) can address the write-back row straight off the copilot report. */
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
