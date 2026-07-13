// Tally webhook intake — signature verification and payload parsing.
// Tally signs each webhook: base64(HMAC-SHA256(raw body, signing secret)) in the
// `tally-signature` header. Parsing is label-tolerant: fields are matched by
// label pattern, not position, so form edits don't silently break intake.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Category } from "@/packages/pcs-types";
import type { Sku } from "./types";

export function verifyTallySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TallyField {
  key: string;
  label: string;
  type: string;
  value: unknown;
}

export interface TallyWebhookPayload {
  eventId: string;
  eventType: string;
  data: {
    responseId: string;
    submissionId: string;
    formId: string;
    formName: string;
    createdAt: string;
    fields: TallyField[];
  };
}

export interface TallyPhotoRef {
  name: string;
  url: string;
  mimeType: string;
}

export interface ParsedSubmission {
  submissionId: string;
  email: string;
  ownerName: string | null;
  category: Category;
  sku: Sku;
  declaredAttributes: Record<string, string>;
  photos: TallyPhotoRef[];
}

const CATEGORIES: Category[] = ["coins", "cards", "medals", "watches", "silver"];

function fieldByLabel(fields: TallyField[], pattern: RegExp): TallyField | undefined {
  return fields.find((f) => pattern.test(f.label));
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(asText).join(", ");
  if (typeof v === "object") return String((v as { text?: unknown }).text ?? "");
  return String(v);
}

/** Tally MULTIPLE_CHOICE values arrive as option-id arrays; resolve via options. */
function choiceText(f: TallyField | undefined): string {
  if (!f) return "";
  const options = (f as TallyField & { options?: { id: string; text: string }[] }).options;
  if (options && Array.isArray(f.value)) {
    return (f.value as string[])
      .map((id) => options.find((o) => o.id === id)?.text ?? id)
      .join(", ");
  }
  return asText(f.value);
}

export function parseTallySubmission(payload: TallyWebhookPayload): ParsedSubmission {
  const fields = payload.data.fields ?? [];

  const emailField = fields.find((f) => f.type === "INPUT_EMAIL" || /e-?mail/i.test(f.label));
  const email = asText(emailField?.value).trim();
  if (!email) throw new Error("submission has no email field");

  const rawCategory = choiceText(fieldByLabel(fields, /category|object type/i)).toLowerCase();
  const category = CATEGORIES.find((c) => rawCategory.includes(c.replace(/s$/, ""))) ?? "coins";

  const rawSku = choiceText(fieldByLabel(fields, /service|tier|package/i)).toLowerCase();
  const sku: Sku = rawSku.includes("apprais") ? "appraise" : "verify";

  const ownerName = asText(fieldByLabel(fields, /\bname\b/i)?.value).trim() || null;

  // Every other text answer becomes a declared attribute (the owner's hypothesis).
  const declaredAttributes: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "FILE_UPLOAD" || f === emailField) continue;
    if (/category|object type|service|tier|package|\bname\b/i.test(f.label)) continue;
    const v = choiceText(f).trim();
    if (v) declaredAttributes[f.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] = v;
  }

  const photos: TallyPhotoRef[] = [];
  for (const f of fields) {
    if (f.type !== "FILE_UPLOAD" || !Array.isArray(f.value)) continue;
    for (const file of f.value as { name?: string; url?: string; mimeType?: string }[]) {
      if (file?.url) photos.push({ name: file.name ?? "photo", url: file.url, mimeType: file.mimeType ?? "" });
    }
  }
  if (photos.length === 0) throw new Error("submission has no photos");

  return { submissionId: payload.data.submissionId, email, ownerName, category, sku, declaredAttributes, photos };
}
