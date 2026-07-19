// Valuation adapter (F-8 indicative mode). Produces a clearly-LABELLED indicative
// fair-market-value estimate for a provisional Appraise — never a certified band,
// and NEVER a score input (F-8 independence: the deterministic engine never sees
// this output). With VALUATION_API_KEY (or ANTHROPIC_API_KEY) set, the estimate is
// drafted by Claude from the RESOLVED catalogue identity + condition/provenance
// signals; otherwise the stub returns null and the report keeps "Indicative value
// — under expert review" (the F-8 default). The authoritative band is still
// expert-set at curator confirm.
//
// The adapter uses Claude's server-side WEB SEARCH to find REAL comparable
// listings / sales (dealers, eBay, auction) for the resolved object, and prices
// the band from them.
//
// HONESTY GUARDS baked in below (not just prompt-deep):
//  - Comps must be CITED. A comparable is accepted only with a real source URL;
//    an uncited "sale" is dropped. No fabricated auction results.
//  - A defensible WIDE range or nothing: an unusable / degenerate / inverted band
//    is dropped to null → the report falls back to "under expert review".
//  - The estimate is labelled indicative and confidence is capped at "moderate".

import type { Category, Comp, Factor } from "@/packages/pcs-types";
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
  /** Real, CITED comparable listings / sales found by web search (0–6). Each
   *  carries a source URL; uncited comps are dropped. */
  comps: Comp[];
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
/** Web search runs an agentic loop server-side — allow generous headroom, then fall
 *  back to the F-8 "under expert review" default rather than hang the pipeline. */
const VALUATION_TIMEOUT_MS = 45_000;

const MARKET_INTEREST: readonly MarketInterest[] = ["low", "modest", "warm", "high"];
const FACTOR_KINDS: readonly Factor["kind"][] = ["lift", "hold", "decide", "info"];

const VALUATION_SYSTEM = [
  "You are the valuation stage of the veradis provenance engine. You produce an INDICATIVE fair-market-value estimate for a collectable object, grounded in REAL comparable listings and sales you find with web search.",
  "This is NOT a certified appraisal. It is an indicative estimate that a human expert will confirm. Write for an owner who wants an honest, market-grounded ballpark.",
  "METHOD:",
  "- USE web search to find the SAME object (or the closest comparable) currently listed or recently sold — dealers, eBay (sold + asking), auction results, the issuer's own price if still sold. Search by the specific identity (issuer, year, exact model / SKU / commemorative, metal).",
  "- Price the range FROM those comparables. Return them as `comps` so the owner can see the evidence.",
  "HARD RULES:",
  "- Every comp MUST have a real source `url` you actually saw in search results. NEVER invent a sale, price, lot, date, or URL. If you found no usable comps, return an empty comps array and say so — do not fabricate.",
  "- Give a defensible range. If comps cluster, the range can be tight; if sparse, keep it wide. State the grounding in ONE line as `basis` (e.g. 'from 3 eBay sold + 1 dealer listing').",
  `- marketInterest: your honest read of demand from what you saw — one of ${MARKET_INTEREST.join(", ")}.`,
  "- factors: 2 to 5 value drivers, each {name, kind, effect}. kind is one of lift, hold, decide, info.",
  "- confidence: only `low` or `moderate`. Never higher — this is indicative.",
  "- Express fmvLo and fmvHi as plain numbers (no symbols, no separators) in the requested currency, fmvLo <= fmvHi, both > 0.",
  '- If you cannot form a defensible estimate, return {"noEstimate": true}.',
  'Return ONLY a JSON object as your FINAL message: {"fmvLo": number, "fmvHi": number, "marketInterest": string, "basis": string, "comps": [{"source": string, "venue": string, "date": string, "result": string, "url": string}], "factors": [{"name": string, "kind": string, "effect": string}], "confidence": string}  OR  {"noEstimate": true}. `result` is the price seen (e.g. "CAD 95 sold" / "USD 120 asking").',
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
  comps?: unknown;
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

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Defensive parse of Claude's JSON into a ValuationEstimate. Returns null when
 *  the payload is unusable or the band is not defensible — the caller then keeps
 *  the F-8 "under expert review" default. Comps are accepted ONLY when cited with
 *  a real http(s) URL (no fabricated sales). */
export function parseValuationJson(text: string, currency: string): ValuationEstimate | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let raw = (fenced ? fenced[1] : text).trim();
  // The web-search response can wrap the JSON in prose — take the outermost object.
  if (!raw.startsWith("{")) {
    const s = raw.indexOf("{");
    const e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
  }
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
  // Comps: accept ONLY cited ones (a real http(s) URL). An uncited "sale" is dropped.
  const comps: Comp[] = [];
  if (Array.isArray(parsed.comps)) {
    for (const c of parsed.comps as unknown[]) {
      const cc = c as Record<string, unknown> | null;
      const url = str(cc?.url);
      if (!cc || !/^https?:\/\//i.test(url)) continue;
      comps.push({
        source: str(cc.source) || "Listing",
        venue: str(cc.venue),
        date: str(cc.date),
        result: str(cc.result),
        basis: str(cc.basis) || "web search",
        url,
      });
      if (comps.length >= 6) break;
    }
  }

  // Always carry the honesty caveat as an info factor, even if the model omitted
  // it — making room within the 5-factor cap if the model filled every slot.
  if (!factors.some((f) => f.kind === "info")) {
    if (factors.length >= 5) factors.pop();
    factors.push({
      name: "Indicative estimate",
      kind: "info",
      effect: comps.length
        ? `Grounded in ${comps.length} cited comparable${comps.length > 1 ? "s" : ""} — an expert confirms the firm band.`
        : "No live comparable sales found — estimate from catalogue knowledge; an expert confirms.",
    });
  }

  return { currency, fmvLo, fmvHi, marketInterest, basis, factors, comps, confidence };
}

export class ClaudeValuationAdapter implements ValuationAdapter {
  name = "valuation:claude";
  constructor(
    private apiKey: string,
    // Env-overridable (VALUATION_MODEL) if this default drifts.
    private model: string = process.env.VALUATION_MODEL ?? "claude-opus-4-8",
  ) {}

  async estimate(req: ValuationRequest): Promise<ValuationEstimate | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VALUATION_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: this.model,
          max_tokens: 3000,
          system: VALUATION_SYSTEM,
          // Server-side web search — the model finds and cites real comparables.
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
          messages: [{ role: "user", content: valuationUserText(req) }],
        }),
      });
    } catch (e) {
      // Network / fetch failure / timeout — degrade to the F-8 default, never crash.
      console.warn(`valuation:claude request failed — ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      console.warn(`valuation:claude ${res.status} ${await res.text().catch(() => "")}`);
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    // The final answer is in the text blocks; web_search_tool_result blocks are skipped.
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();
    return parseValuationJson(text, req.currency);
  }
}

/** Adapter factory — Claude when a key is present, else the stub (F-8 default). */
export function getValuationAdapter(): ValuationAdapter {
  const key = process.env.VALUATION_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  return key ? new ClaudeValuationAdapter(key) : new StubValuationAdapter();
}
