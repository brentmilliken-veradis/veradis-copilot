// Vision adapter (E3). Derives object attributes from photos, flags red flags,
// and reports each image's C2PA content-credential state. With VISION_API_KEY
// (or ANTHROPIC_API_KEY) set AND a Storage to load image bytes from, analysis
// runs on Claude multimodal; otherwise it runs as a fixture-replay stub
// (BUILD-KICKOFF §3). Neither adapter EVER invents attributes it wasn't shown —
// when unsure, it echoes the owner's declaration (i.e. "no correction found").

import type { Category, C2paState } from "@/packages/pcs-types";
import { ALL_CATEGORIES } from "@/packages/pcs-types";
import { loadProfile, ProfileValidationError } from "@/packages/profiles/loader";
import type { Storage } from "./storage";
import { markStubbed } from "./stub-registry";

export interface VisionRequest {
  objectId: string;
  category: Category;
  declaredAttributes: Record<string, string>;
  evidence: { slot: string; sha256: string; storagePath: string }[];
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
  /** The slot of the photo that best shows the OBJECT ITSELF (the coin, watch,
   *  painting…) — not its certificate, box, or packaging — for the report hero
   *  and the collection card. Vision picks it because slot/upload order can't
   *  tell a coin from its COA. Omitted when no image clearly shows the object. */
  heroSlot?: string;
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
      heroSlot: s?.heroSlot,
      // Default: content credentials absent (most consumer photos have none).
      c2pa: s?.c2pa ?? Object.fromEntries(req.evidence.map((e) => [e.slot, "absent" as C2paState])),
    };
  }
}

// ---- Live adapter: Claude reads the images. Attributes only from what it sees. ----

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/** Claude-accepted image media types, sniffed from magic bytes. */
export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export function sniffImageMediaType(bytes: Uint8Array): ImageMediaType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  // Intake converts HEIC → JPEG upstream; anything unrecognised is treated as JPEG.
  return "image/jpeg";
}

const VISION_SYSTEM = [
  "You are the vision stage of the veradis provenance engine. You examine photographs of a collectable object and report ONLY what you can actually see.",
  "HARD RULES:",
  "- NEVER invent an attribute. If an attribute is not clearly legible in the images, OMIT it — the engine will fall back to the owner's declaration. Do not guess.",
  "- The owner's typed attributes are a HYPOTHESIS. Report a different value only when the images clearly contradict it.",
  `- derivedCategory: include ONLY if the object is clearly a different category than declared. Allowed values: ${ALL_CATEGORIES.join(", ")}.`,
  "- redFlags: physical warning signs visible in the images (casting seams, re-engraving, cleaning hairlines, renamed rims, redials, over-restoration). Each needs the slot it was seen in and a short factual note. Empty array if none.",
  "- heroSlot: the capture slot of the ONE image that best shows the OBJECT ITSELF — the coin, watch, painting, medal — clearly and recognisably. NEVER pick a certificate of authenticity, a box, a case, packaging, a document, or a receipt. Prefer a clean, well-lit, front-facing view of the object. If no image clearly shows the object, omit heroSlot.",
  "- You NEVER score, grade, value, or authenticate. You read attributes and flag observations.",
  'Return ONLY a JSON object: {"derivedAttributes": {<key>: <string value>}, "derivedCategory": <string, optional>, "redFlags": [{"key": string, "evidenceSlot": string, "note": string}], "heroSlot": <string, optional>}. Nothing outside the JSON.',
].join("\n");

function visionUserText(req: VisionRequest): string {
  const attrs = Object.entries(req.declaredAttributes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return [
    `Declared category: ${req.category}`,
    "Owner-declared attributes (hypothesis — verify against the images):",
    attrs || "(none)",
    "",
    "Each image above is labelled with its capture slot. Read the object's attributes from the images using the declared attribute keys (plus any clearly legible additional keys), note red flags, and respond with the JSON object only.",
  ].join("\n");
}

interface RawVisionJson {
  derivedAttributes?: unknown;
  derivedCategory?: unknown;
  redFlags?: unknown;
  heroSlot?: unknown;
}

/** Defensive parse of Claude's JSON into the VisionResult shape (minus c2pa).
 *  Returns null when the payload is unusable — caller falls back to the stub. */
export function parseVisionJson(text: string): Omit<VisionResult, "c2pa"> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  let parsed: RawVisionJson;
  try {
    parsed = JSON.parse(raw) as RawVisionJson;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const derivedAttributes: Record<string, string> = {};
  if (parsed.derivedAttributes && typeof parsed.derivedAttributes === "object" && !Array.isArray(parsed.derivedAttributes)) {
    for (const [k, v] of Object.entries(parsed.derivedAttributes as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) derivedAttributes[k] = v;
      else if (typeof v === "number") derivedAttributes[k] = String(v);
    }
  }

  let derivedCategory: Category | undefined;
  if (typeof parsed.derivedCategory === "string" && (ALL_CATEGORIES as readonly string[]).includes(parsed.derivedCategory)) {
    derivedCategory = parsed.derivedCategory as Category;
  }

  const redFlags: VisionRedFlag[] = [];
  if (Array.isArray(parsed.redFlags)) {
    for (const f of parsed.redFlags as unknown[]) {
      const flag = f as Partial<VisionRedFlag> | null;
      if (flag && typeof flag.key === "string" && typeof flag.note === "string") {
        redFlags.push({ key: flag.key, evidenceSlot: typeof flag.evidenceSlot === "string" ? flag.evidenceSlot : "", note: flag.note });
      }
    }
  }

  const heroSlot = typeof parsed.heroSlot === "string" && parsed.heroSlot.trim() ? parsed.heroSlot.trim() : undefined;

  return { derivedAttributes, derivedCategory, redFlags, heroSlot };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ---- Image sizing for the vision call (fix brief 2026-07-17) ----
// iPhone JPEGs are ~3–5 MB each; base64 inflates ~33%, so a photo-heavy object
// blows past Anthropic's ~32 MB request-body limit → HTTP 413. We downscale a
// THROWAWAY copy of each image to ≤1568 px long edge (Anthropic's own server
// cap) and re-encode JPEG before base64, then bound the total payload. The
// STORED evidence bytes and their SHA-256 are never touched — this copy is
// sent to the LLM only.

/** Anthropic downscales anything over this long edge server-side anyway. */
export const VISION_MAX_LONG_EDGE = 1568;
const VISION_JPEG_QUALITY = 80;
/** Total base64 payload budget — well under Anthropic's ~32 MB request limit. */
export const VISION_TOTAL_PAYLOAD_BUDGET = 20 * 1024 * 1024;
/** Anthropic caps a single image at 5 MB base64; stay clear of the edge. */
export const VISION_PER_IMAGE_MAX = Math.floor(4.5 * 1024 * 1024);

/** Downscale a THROWAWAY copy for the vision call: decode → if the long edge
 *  exceeds VISION_MAX_LONG_EDGE, resize to it (aspect preserved) → re-encode
 *  JPEG. Pure-JS (jimp) — no native binary, matching the repo's Vercel-safe
 *  constraint. On a decode failure the original bytes are returned unchanged;
 *  the per-image guard still keeps an over-limit image from being sent. */
export async function downscaleForVision(bytes: Uint8Array): Promise<Uint8Array> {
  const { Jimp } = await import("jimp");
  let img;
  try {
    img = await Jimp.read(Buffer.from(bytes));
  } catch {
    return bytes; // undecodable — leave as-is; the payload cap guards size
  }
  const longEdge = Math.max(img.width, img.height);
  if (longEdge > VISION_MAX_LONG_EDGE) {
    // Resize by the long edge only; jimp preserves aspect for the other edge.
    if (img.width >= img.height) img.resize({ w: VISION_MAX_LONG_EDGE });
    else img.resize({ h: VISION_MAX_LONG_EDGE });
  }
  const out = await img.getBuffer("image/jpeg", { quality: VISION_JPEG_QUALITY });
  return new Uint8Array(out);
}

export interface VisionImage {
  slot: string;
  core: boolean;
  mediaType: ImageMediaType;
  /** base64-encoded, downscaled bytes. */
  base64: string;
}

export interface PayloadSelection {
  included: VisionImage[];
  /** Slots left out, with why — logged by the caller (no silent truncation). */
  dropped: { slot: string; reason: "oversized" | "budget" }[];
}

/** Choose which images fit the payload budget: core capture slots first (they
 *  carry the identity signal), then the rest in order, filling the byte budget.
 *  A single image over the per-image cap is skipped. Pure + deterministic. */
export function selectImagesForPayload(
  images: VisionImage[],
  budget = VISION_TOTAL_PAYLOAD_BUDGET,
  perImageMax = VISION_PER_IMAGE_MAX,
): PayloadSelection {
  // Stable priority: core slots first, original order preserved within each group.
  const ordered = [...images.filter((i) => i.core), ...images.filter((i) => !i.core)];
  const included: VisionImage[] = [];
  const dropped: PayloadSelection["dropped"] = [];
  let total = 0;
  for (const img of ordered) {
    const size = img.base64.length;
    if (size > perImageMax) {
      dropped.push({ slot: img.slot, reason: "oversized" });
      continue;
    }
    if (total + size > budget) {
      dropped.push({ slot: img.slot, reason: "budget" });
      continue;
    }
    included.push(img);
    total += size;
  }
  return { included, dropped };
}

/** Core capture-slot ids for a category (empty on any profile-load failure — a
 *  missing profile must not crash the vision call; images just stay un-prioritised). */
function coreSlotIds(category: Category): Set<string> {
  try {
    const profile = loadProfile(category);
    return new Set(profile.captureSlots.filter((s) => s.core).map((s) => s.slotId));
  } catch (e) {
    if (!(e instanceof ProfileValidationError)) throw e;
    return new Set();
  }
}

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

export class ClaudeVisionAdapter implements VisionAdapter {
  name = "vision:claude";
  constructor(
    private apiKey: string,
    /** Loads each evidence image's bytes by storagePath (E-B Storage adapter). */
    private storage: Storage,
    // Exact model id is env-overridable (VISION_MODEL) — set it if this default drifts.
    private model: string = process.env.VISION_MODEL ?? "claude-opus-4-8",
  ) {}

  async analyze(req: VisionRequest): Promise<VisionResult> {
    // TODO(C2PA): real content-credential validation is out of scope for now —
    // every slot reports "absent", matching the stub's consumer-photo default.
    const c2pa: Record<string, C2paState> = Object.fromEntries(
      req.evidence.map((e) => [e.slot, "absent" as C2paState]),
    );

    // Downscale a throwaway copy of each image (≤1568 px, JPEG) and base64-
    // encode it — the STORED bytes/SHA-256 are never touched. Then bound the
    // total payload so a photo-heavy object can never 413.
    const core = coreSlotIds(req.category);
    const images: VisionImage[] = [];
    for (const e of req.evidence) {
      const bytes = await this.storage.get(e.storagePath);
      if (!bytes) continue; // missing blob — analyse what we have
      const scaled = await downscaleForVision(bytes);
      // The downscale re-encodes JPEG; on decode failure it returns the original
      // bytes, so sniff the copy we actually send rather than assuming JPEG.
      images.push({ slot: e.slot, core: core.has(e.slot), mediaType: sniffImageMediaType(scaled), base64: toBase64(scaled) });
    }

    const { included, dropped } = selectImagesForPayload(images);
    if (dropped.length) {
      // Operating rule: no silent truncation — a bounded set must be logged.
      console.warn(
        `vision:claude — payload cap dropped ${dropped.length} image(s): ${dropped
          .map((d) => `${d.slot} (${d.reason})`)
          .join(", ")}`,
      );
    }

    // Nothing to look at → behave like the stub (echo the declaration).
    if (!included.length) return new StubVisionAdapter().analyze(req);

    const content: ClaudeContentBlock[] = [];
    for (const img of included) {
      content.push({ type: "text", text: `Capture slot: ${img.slot}` });
      content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    }
    content.push({ type: "text", text: visionUserText(req) });

    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2000,
        system: VISION_SYSTEM,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) throw new Error(`vision:claude ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    const parsed = parseVisionJson(text);
    if (!parsed) return new StubVisionAdapter().analyze(req);

    // Echo-declared safety net: derived attributes overlay the declaration; an
    // attribute Claude omitted stays at the owner's declared value downstream
    // (ingest resolves per-key), so no invention can enter here.
    return { ...parsed, c2pa };
  }
}

/** Adapter factory — Claude when a key + storage are present, else the stub. */
export function getVisionAdapter(
  scenarios: Record<string, VisionScenario> = {},
  storage?: Storage,
): VisionAdapter {
  const key = process.env.VISION_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  return key && storage ? new ClaudeVisionAdapter(key, storage) : new StubVisionAdapter(scenarios);
}
