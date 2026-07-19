// Report image builder. Turns the owner's uploaded photos into small, self-
// contained data: URIs for the delivered report HTML — a hero + evidence strip
// that shows the actual object. These are built at DELIVERY and inlined into the
// HTML file only; they are NEVER written to the snapshot (the snapshot stays
// small and hash-stable, and re-rendering it without photos still produces a
// valid report).
//
// Pure-JS (jimp), matching the repo's Vercel-safe, no-native-binary constraint.
// Defensive: any failure on a single photo is skipped; a total failure returns
// [] so the report still renders (with the graceful "photographs on file"
// placeholder) rather than blocking delivery.

import { createHash } from "node:crypto";
import type { ReportImage } from "./render";

/** Report thumbnails/hero don't need print resolution — a long edge of ~1000 px
 *  at JPEG q78 is crisp on screen and keeps the inlined HTML small. */
export const REPORT_MAX_LONG_EDGE = 1000;
const REPORT_JPEG_QUALITY = 78;
/** Bound the total inlined payload so a photo-heavy object can't produce a
 *  many-MB HTML file. base64 inflates ~33%; ~4.5 MB of JPEG → ~6 MB of HTML. */
export const REPORT_IMAGE_BUDGET = Math.floor(4.5 * 1024 * 1024);

export interface DeliveryPhoto {
  filename: string;
  bytes: Uint8Array;
}

export interface EvidenceRef {
  slot: string;
  sha256: string;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function downscaleJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { Jimp } = await import("jimp");
    const img = await Jimp.read(Buffer.from(bytes));
    const longEdge = Math.max(img.width, img.height);
    if (longEdge > REPORT_MAX_LONG_EDGE) {
      if (img.width >= img.height) img.resize({ w: REPORT_MAX_LONG_EDGE });
      else img.resize({ h: REPORT_MAX_LONG_EDGE });
    }
    const out = await img.getBuffer("image/jpeg", { quality: REPORT_JPEG_QUALITY });
    return new Uint8Array(out);
  } catch {
    return null; // undecodable — skip this photo
  }
}

function humanize(slot: string): string {
  return slot.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Front-ish views first so the renderer's hero picks a good frame; then the
 *  rest in capture order. */
const SLOT_ORDER = ["obverse", "front", "hero", "reverse", "mintmark_macro", "edge"];
function slotRank(slot: string): number {
  const i = SLOT_ORDER.indexOf(slot);
  return i === -1 ? SLOT_ORDER.length + 1 : i;
}

/** Build inlined report images from the delivered photos, mapping each to its
 *  evidence slot by SHA-256 (falling back to capture order). Bounded by
 *  REPORT_IMAGE_BUDGET; returns [] on total failure. */
export async function buildReportImages(
  photos: DeliveryPhoto[],
  evidence: EvidenceRef[],
): Promise<ReportImage[]> {
  if (!photos.length) return [];
  const bySha = new Map(evidence.map((e) => [e.sha256, e.slot]));
  const out: ReportImage[] = [];
  let spent = 0;
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    const slot = bySha.get(sha256Hex(p.bytes)) ?? evidence[i]?.slot ?? `extra_${i + 1}`;
    const scaled = await downscaleJpeg(p.bytes);
    if (!scaled) continue;
    const b64 = Buffer.from(scaled).toString("base64");
    if (spent + b64.length > REPORT_IMAGE_BUDGET) break; // stay within the file-size budget
    spent += b64.length;
    out.push({ slot, label: humanize(slot), dataUri: `data:image/jpeg;base64,${b64}` });
  }
  out.sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
  return out;
}
