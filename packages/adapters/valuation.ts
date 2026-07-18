// Valuation adapter (F-8 indicative mode). Produces a clearly-LABELLED indicative
// fair-market-value estimate for a provisional Appraise — never a certified band,
// and NEVER a score input (F-8 independence: the deterministic engine never sees
// this output). With VALUATION_API_KEY (or ANTHROPIC_API_KEY) set, the estimate is
// drafted by Claude from the RESOLVED catalogue identity + condition/provenance
// signals; otherwise the stub returns null and the report keeps "Indicative value
// — under expert review" (the F-8 default). The authoritative band is still
// expert-set at curator confirm.
//
// HONESTY GUARDS baked in below (not just prompt-deep):
//  - No fabricated comparable sales. The model is told it has no live market feed
//    and returns NO comps; the engine forces `comps: []`. A real price source can
//    populate comps later with genuine data.
//  - A defensible WIDE range or nothing: an unusable / degenerate / inverted band
//    is dropped to null → the report falls back to "under expert review".
//  - The estimate is labelled indicative and confidence is capped at "moderate".

import type { Category, Factor } from "@/packages/pcs-types";
import { markStubbed } from "./stub-registry";

export type MarketInterest = "low" | "modest" | "warm" | "high";

export interface ValuationRequest {
  objectId: string;
  category: Category;
  /** ISO currency the range should be expressed in (e.g. "CAD"). */
  currency: string;
  /** The engine's resolved view of the object (declared + vision-derived). */
  resolvedAttributes: Record<string, string>;
  /** Custody / condition signal labels (single owner, original packaging, COA…) —
   *  context for the estimate only, NEVER a score input. */
  valueSignals?: string[];
  /** The owner's free-text description, for condition / completeness cues. */
  notes?: string;
}

export interface ValuationEstimate {
  currency: string;
  fmvLo: number;
  fmvHi: number;
  marketInterest: MarketInterest;
  /** One-line, honestly-scoped basis for the range. */
  basis: string;
  /** 0–5 value drivers. Never specific fabricated sales. */
  factors: Factor[];
  /** Indicative confidence — capped at "moderate". */
  confidence: "low" | "moderate";
}

export interface ValuationAdapter {
  name: string;
  estimate(req: ValuationRequest): Promise<ValuationEstimate | null>;
}

/** F-8 default: no engine band. The report renders "Indicative value — under
 *  expert review" and the authoritative band is expert-set at confirm. */
export class StubValuationAdapter implements ValuationAdapter {
  name = "valuation:stub";
  async estimate(): Promise<ValuationEstimate | null> {
    markStubbed(this.name, "VALUATION_API_KEY", "indicative FMV estimate");
    return null;
  }
}

// ---- Live adapter: Claude drafts an indicative range from the resolved identity ----

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const MARKET_INTEREST: readonly MarketInterest[] = ["low", "modest", "warm", "high"];
const FACTOR_KINDS: readonly Factor["kind"][] = ["lift", "hold", "decide", "info"];

const VALUATION_SYSTEM = [
  "You are the valuation stage of the veradis provenance engine. You produce an INDICATIVE fair-market-value estimate for a collectable object from its resolved catalogue identity and its condition / provenance signals.",
  "This is NOT a certified appraisal. It is an indicative estimate that a human expert will confirm. Write for an owner who wants an honest ballpark, not false precision.",
  "HARD RULES:",
  "- Give a WIDE, honest range. Collectables trade in ranges; never imply precision you do not have. A common item can still have a modest range, but it must be realistic for that item.",
  "- Ground the range in the object's identity (type, year, issuer, mintage / rarity, metal), its finish / condition, and its provenance / packaging. State that grounding in ONE line as `basis`.",
  "- You reason from general catalogue and market knowledge. You do NOT have a live auction feed. Do NOT claim you searched the market. Do NOT invent specific comparable sales (no auction house, lot, date, or hammer price). Comparable sales are handled elsewhere.",
  `- marketInterest: your honest read of demand — one of ${MARKET_INTEREST.join(", ")}.`,
  "- factors: 2 to 5 value drivers, each {name, kind, effect}. kind is one of lift, hold, decide, info. Include at least one `info` factor noting the estimate is indicative and not based on live comparable sales.",
  "- confidence: only `low` or `moderate`. Never higher — this is indicative.",
  "- Express fmvLo and fmvHi as plain numbers (no currency symbols, no thousands separators) in the requested currency, with fmvLo <= fmvHi and both > 0.",
  '- If you cannot form a defensible estimate (identity too thin or unknown), return {"noEstimate": true}. Better no number than a fabricated one.',
  'Return ONLY a JSON object, nothing outside it: {"fmvLo": number, "fmvHi": number, "marketInterest": string, "basis": string, "factors": [{"name": string, "kind": string, "effect": string}], "confidence": string}  OR  {"noEstimate": true}.',
].join("\n");

function valuationUserText(req: ValuationRequest): string {
  const attrs = Object.entries(req.resolvedAttributes)
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const signals = (req.valueSignals ?? []).filter(Boolean);
  return [
    `Requested currency: ${req.currency}`,
    `Category: ${req.category}`,
    "Resolved object identity (declared + read from the photos):",
    attrs || "(none)",
    signals.length ? `\nProvenance / condition signals present: ${signals.join(", ")}` : "",
    req.notes?.trim() ? `\nOwner's description: ${req.notes.trim()}` : "",
    "",
    "Produce the indicative estimate as the JSON object only.",
  ]
    .filter(Boolean)
    .join("\n");
}

interface RawValuationJson {
  noEstimate?: unknown;
  fmvLo?: unknown;
  fmvHi?: unknown;
  marketInterest?: unknown;
  basis?: unknown;
  factors?: unknown;
  confidence?: unknown;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[, ]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Defensive parse of Claude's JSON into a ValuationEstimate. Returns null when
 *  the payload is unusable or the band is not defensible — the caller then keeps
 *  the F-8 "under expert review" default. `comps` are never accepted here. */
export function parseValuationJson(text: string, currency: string): ValuationEstimate | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  let parsed: RawValuationJson;
  try {
    parsed = JSON.parse(raw) as RawValuationJson;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.noEstimate === true) return null;

  const fmvLo = num(parsed.fmvLo);
  const fmvHi = num(parsed.fmvHi);
  // A band is only shown if it is defensible: two positive numbers, low <= high.
  if (fmvLo === null || fmvHi === null) return null;
  if (fmvLo <= 0 || fmvHi <= 0 || fmvLo > fmvHi) return null;

  const marketInterest = (MARKET_INTEREST as readonly string[]).includes(parsed.marketInterest as string)
    ? (parsed.marketInterest as MarketInterest)
    : "modest";

  const confidence = parsed.confidence === "moderate" ? "moderate" : "low";

  const basis =
    typeof parsed.basis === "string" && parsed.basis.trim()
      ? parsed.basis.trim()
      : "Indicative estimate from the object's catalogue identity, condition and provenance; not based on live comparable sales.";

  const factors: Factor[] = [];
  if (Array.isArray(parsed.factors)) {
    for (const f of parsed.factors as unknown[]) {
      const raw = f as Partial<Factor> | null;
      if (!raw || typeof raw.name !== "string" || !raw.name.trim()) continue;
      const kind = (FACTOR_KINDS as readonly string[]).includes(raw.kind as string) ? (raw.kind as Factor["kind"]) : "info";
      factors.push({
        name: raw.name.trim(),
        kind,
        effect: typeof raw.effect === "string" ? raw.effect : undefined,
      });
      if (factors.length >= 5) break;
    }
  }
  // Always carry the honesty caveat as an info factor, even if the model omitted
  // it — making room within the 5-factor cap if the model filled every slot.
  if (!factors.some((f) => f.kind === "info")) {
    if (factors.length >= 5) factors.pop();
    factors.push({
      name: "Indicative estimate",
      kind: "info",
      effect: "Machine estimate, not based on live comparable sales — an expert confirms the firm band.",
    });
  }

  return { currency, fmvLo, fmvHi, marketInterest, basis, factors, confidence };
}

export class ClaudeValuationAdapter implements ValuationAdapter {
  name = "valuation:claude";
  constructor(
    private apiKey: string,
    // Env-overridable (VALUATION_MODEL) if this default drifts.
    private model: string = process.env.VALUATION_MODEL ?? "claude-opus-4-8",
  ) {}

  async estimate(req: ValuationRequest): Promise<ValuationEstimate | null> {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 900,
          system: VALUATION_SYSTEM,
          messages: [{ role: "user", content: valuationUserText(req) }],
        }),
      });
    } catch (e) {
      // Network / fetch failure — degrade to the F-8 default, never crash.
      console.warn(`valuation:claude request failed — ${(e as Error).message}`);
      return null;
    }
    if (!res.ok) {
      console.warn(`valuation:claude ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    return parseValuationJson(text, req.currency);
  }
}

/** Adapter factory — Claude when a key is present, else the stub (F-8 default). */
export function getValuationAdapter(): ValuationAdapter {
  const key = process.env.VALUATION_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  return key ? new ClaudeValuationAdapter(key) : new StubValuationAdapter();
}
