// Source adapters + router (E4). Tier-1 APIs (PCGS, Numista) are GROUND TRUTH —
// a match closes a check (authority-resolved). Everything else corroborates.
// Until the API keys are set the adapters are fixture-replay stubs; an
// unconfigured lookup returns "not matched" with an honest retrieval_state.

import type { Category, RetrievalState, SourceTier } from "@/packages/pcs-types";
import { markStubbed } from "./stub-registry";

export interface SourceLookup {
  key: string;
  value: string;
  category: Category;
}

export interface SourceResult {
  adapter: string;
  tier: SourceTier;
  role: "ground_truth" | "corroboration" | "cite_only";
  matched: boolean;
  value?: string;
  name: string;
  url?: string;
  retrievalState: RetrievalState;
}

/** Per-key confirmation a catalogue can close, from ONE object-level lookup. */
export interface ObjectResolution {
  matched: boolean;
  sourceName: string;
  url?: string;
  tier: SourceTier;
  /** identity keys the catalogue CONFIRMS, key → the confirmed value. Only keys
   *  that clearly agree are listed — a disagreement is left OUT (honest: it is
   *  not credited, and may surface as a correction elsewhere). */
  confirmedKeys: Record<string, string>;
  /** keys where the catalogue's value DIFFERS from the declared value (a likely
   *  mislabel) — value is the catalogue's. Advisory; never auto-credited. */
  correctedKeys?: Record<string, string>;
}

export interface SourceAdapter {
  name: string;
  tier: SourceTier;
  role: "ground_truth" | "corroboration" | "cite_only";
  categories: Category[];
  lookup(l: SourceLookup): Promise<SourceResult>;
  /** Optional object-level resolution (E4+). A catalogue API answers per OBJECT
   *  (one search → the whole coin), not per attribute, so a Tier-1 adapter that
   *  implements this resolves all identity keys from a single search. Adapters
   *  without it (the stubs) fall back to per-key `lookup`. */
  resolveObject?(input: {
    attributes: Record<string, string>;
    category: Category;
    identityKeys: string[];
  }): Promise<ObjectResolution | null>;
}

/** A canned match for the stub: objectId-agnostic, keyed by `${key}=${value}`. */
export type SourceScenario = Record<string, { matched: boolean; url?: string; retrievalState?: RetrievalState }>;

class StubSourceAdapter implements SourceAdapter {
  constructor(
    public name: string,
    public tier: SourceTier,
    public role: "ground_truth" | "corroboration" | "cite_only",
    public categories: Category[],
    private envKey: string,
    private scenario: SourceScenario = {},
  ) {}

  async lookup(l: SourceLookup): Promise<SourceResult> {
    markStubbed(this.name, this.envKey, "Tier-1 source lookup");
    const hit = this.scenario[`${l.key}=${l.value}`];
    return {
      adapter: this.name,
      tier: this.tier,
      role: this.role,
      matched: hit?.matched ?? false,
      value: hit?.matched ? l.value : undefined,
      name: this.name,
      url: hit?.url,
      // Honest default: we couldn't reach the API, so the datum is pending.
      retrievalState: hit?.retrievalState ?? (hit?.matched ? "retrieved" : "pending"),
    };
  }
}

export function pcgsAdapter(scenario: SourceScenario = {}): SourceAdapter {
  return new StubSourceAdapter("PCGS", 1, "ground_truth", ["coins"], "PCGS_API_TOKEN", scenario);
}

export function numistaAdapter(scenario: SourceScenario = {}): SourceAdapter {
  return new StubSourceAdapter("Numista", 1, "ground_truth", ["coins"], "NUMISTA_API_KEY", scenario);
}

// Watches (BUILD-KICKOFF E11). Brand archive extracts (e.g. Omega Extract of the
// Archives, Rolex service confirmations) are the Tier-1 IDENTITY ground truth — a
// match closes brand/reference/serial. WatchCharts corroborates market data at
// Tier-2 (cite, never closes). Both stub until their keys land. NOTE: The Watch
// Register is a THEFT (risk) source, not identity — it belongs in the risk path
// (the paid theft add-on), NOT here, so it never mis-resolves an identity check.
export function brandArchiveAdapter(scenario: SourceScenario = {}): SourceAdapter {
  return new StubSourceAdapter("Brand archive extract", 1, "ground_truth", ["watches"], "BRAND_ARCHIVE_API_KEY", scenario);
}

export function watchChartsAdapter(scenario: SourceScenario = {}): SourceAdapter {
  return new StubSourceAdapter("WatchCharts", 2, "corroboration", ["watches"], "WATCHCHARTS_API_KEY", scenario);
}

// ---- Live Numista adapter (E4): real Tier-1 identity ground truth ----
// Numista answers per OBJECT — one /types search resolves the whole coin, and each
// identity key is confirmed against the matched catalogue entry. A confirmed key
// closes its identity check ("resolved") and cites the Numista URL. Activates on
// NUMISTA_API_KEY; without it the fixture-replay stub is used. Any failure (network,
// non-200, no match) degrades to "not matched" — never crashes the pipeline.

const NUMISTA_BASE = "https://api.numista.com/v3";
const NUMISTA_TIMEOUT_MS = 12000;

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
/** veradis category → Numista `category` query value. */
const NUMISTA_CATEGORY: Partial<Record<Category, string>> = { coins: "coin" };

function norm(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Numista's search behaves AND-ish: a query word absent from the type title can
// EXCLUDE the correct entry. Descriptors like "proof"/"silver"/"special edition"
// are rarely in the type title and sink the result, whereas the distinctive topic
// word ("poppy") surfaces it. So the query keeps country + year + denomination +
// the title's distinctive topics, and drops finish/material/grading words.
const QUERY_STOP = new Set([
  "special", "edition", "proof", "specimen", "uncirculated", "bu", "ms", "pf", "brilliant",
  "silver", "gold", "platinum", "fine", "sterling", "cupronickel", "nickel", "bronze", "copper",
  "coin", "coins", "the", "a", "an", "of", "and", "canadian", "royal", "mint", "rcm",
  "commemorative", "piece", "set", "cased", "boxed", "coloured", "colored", "circulation",
  "dollar", "dollars", "cent", "cents",
]);

/** Distinctive topic words from the owner's title (e.g. "poppy") — the terms that
 *  actually surface the right Numista entry. Generic descriptors are dropped. */
export function titleTopics(title?: string): string {
  if (!title) return "";
  return norm(title)
    .split(" ")
    .filter((w) => w && !QUERY_STOP.has(w) && Number.isNaN(Number(w)))
    .join(" ");
}

interface NumistaType {
  id: number;
  title?: string;
  issuer?: { code?: string; name?: string };
  min_year?: number;
  max_year?: number;
  object_type?: { id?: number; name?: string };
  value?: { text?: string } | string;
  mints?: { name?: string }[];
}

// Retries transient failures (network error, timeout, 429, 5xx) with a short
// backoff — a single dropped call must not silently starve identity and make the
// score non-deterministic. Permanent 4xx (bad key, not found) fail fast. `attempts`
// defaults to 1; the identity-critical SEARCH passes more, the detail lookup (whose
// failure is tolerable) keeps 1.
async function numistaGet(path: string, apiKey: string, attempts = 1): Promise<unknown | null> {
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), NUMISTA_TIMEOUT_MS);
    try {
      const r = await fetch(`${NUMISTA_BASE}${path}`, {
        headers: { "Numista-API-Key": apiKey, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (r.ok) return (await r.json()) as unknown;
      if (r.status !== 429 && r.status < 500) {
        console.warn(`numista ${r.status} ${path} (permanent — not retried)`);
        return null; // bad key / not found — retrying cannot help
      }
      console.warn(`numista ${r.status} ${path} (attempt ${i + 1}/${attempts})`);
    } catch (e) {
      console.warn(`numista request failed ${path} (attempt ${i + 1}/${attempts}) — ${(e as Error).message}`);
    } finally {
      clearTimeout(t);
    }
    if (i < attempts - 1) await sleep(250 * (i + 1));
  }
  return null;
}

function denomText(t: NumistaType): string {
  const v = typeof t.value === "string" ? t.value : (t.value?.text ?? "");
  return norm(`${t.title ?? ""} ${v}`);
}

/** How well a candidate type agrees with the resolved attributes (higher = better). */
export function scoreNumistaCandidate(t: NumistaType, attrs: Record<string, string>): number {
  let s = 0;
  const country = attrs.country ? norm(attrs.country) : "";
  const issuer = norm(t.issuer?.name ?? "");
  if (country && (issuer === country || issuer.includes(country) || norm(t.issuer?.code ?? "") === country)) s += 3;
  const year = attrs.year ? parseInt(attrs.year, 10) : NaN;
  if (!Number.isNaN(year) && t.min_year !== undefined && t.max_year !== undefined && year >= t.min_year && year <= t.max_year) s += 3;
  const denom = attrs.denomination ? norm(attrs.denomination) : "";
  if (denom && denomText(t).includes(denom)) s += 1;
  return s;
}

export class NumistaSourceAdapter implements SourceAdapter {
  name = "Numista";
  tier: SourceTier = 1;
  role = "ground_truth" as const;
  categories: Category[] = ["coins"];
  constructor(private apiKey: string) {}

  // Per-key lookups are answered by resolveObject; the per-key path stays a
  // no-match so it never fires five searches or double-resolves an identity key.
  async lookup(): Promise<SourceResult> {
    return { adapter: this.name, tier: this.tier, role: this.role, matched: false, name: this.name, retrievalState: "pending" };
  }

  async resolveObject(input: {
    attributes: Record<string, string>;
    category: Category;
    identityKeys: string[];
  }): Promise<ObjectResolution | null> {
    const { attributes, category, identityKeys } = input;
    const catParam = NUMISTA_CATEGORY[category];
    if (!catParam) return null;
    // Country + year + denomination + distinctive title topics. NO finish/variety
    // words (they exclude the right entry — see QUERY_STOP).
    const q = [attributes.country, attributes.year, attributes.denomination, titleTopics(attributes.title)]
      .filter((x) => x && String(x).trim())
      .join(" ")
      .trim();
    if (!q) return null;

    // Identity-critical: retry the search so a transient failure can't silently
    // starve identity (3 attempts). The detail call below tolerates failure.
    const search = (await numistaGet(
      `/types?q=${encodeURIComponent(q)}&category=${catParam}&lang=en&count=8`,
      this.apiKey,
      3,
    )) as { types?: NumistaType[] } | null;
    const types = search?.types ?? [];
    const none: ObjectResolution = { matched: false, sourceName: this.name, tier: this.tier, confirmedKeys: {} };
    if (!types.length) return none;

    // Best candidate by attribute agreement.
    let best = types[0];
    let bestScore = scoreNumistaCandidate(types[0], attributes);
    for (const t of types.slice(1)) {
      const sc = scoreNumistaCandidate(t, attributes);
      if (sc > bestScore) {
        best = t;
        bestScore = sc;
      }
    }

    // One detail call on the winner for the citable URL, denomination and mint.
    const detail = ((await numistaGet(`/types/${best.id}?lang=en`, this.apiKey)) as NumistaType | null) ?? best;
    const url = `https://en.numista.com/${best.id}`;

    const confirmedKeys: Record<string, string> = {};
    const correctedKeys: Record<string, string> = {};

    const country = attributes.country ? norm(attributes.country) : "";
    const issuerName = norm(detail.issuer?.name ?? best.issuer?.name ?? "");
    const countryOk = !!country && (issuerName === country || issuerName.includes(country) || norm(best.issuer?.code ?? "") === country);
    const minY = detail.min_year ?? best.min_year;
    const maxY = detail.max_year ?? best.max_year;
    const year = attributes.year ? parseInt(attributes.year, 10) : NaN;
    const yearOk = !Number.isNaN(year) && minY !== undefined && maxY !== undefined && year >= minY && year <= maxY;
    const denomOk = attributes.denomination ? denomText(detail).includes(norm(attributes.denomination)) : false;

    for (const key of identityKeys) {
      const value = attributes[key];
      if (!value) continue;
      const nv = norm(value);
      if (key === "country" && countryOk) confirmedKeys[key] = value;
      else if (key === "year" && yearOk) confirmedKeys[key] = value;
      else if (key === "denomination") {
        if (denomOk) confirmedKeys[key] = value;
        else {
          const catDenom = typeof detail.value === "string" ? detail.value : detail.value?.text;
          if (catDenom) correctedKeys[key] = catDenom; // catalogue disagrees — advisory mislabel
        }
      } else if (key === "mint_mark" || key === "mint") {
        const mints = norm((detail.mints ?? []).map((m) => m?.name ?? "").join(" "));
        const rcm = mints.includes("royal canadian mint");
        if (mints && (mints.includes(nv) || (nv.includes("rcm") && rcm) || (nv.includes("royal canadian mint") && rcm))) confirmedKeys[key] = value;
      } else if (key === "variety") {
        const hay = norm(`${detail.title ?? ""} ${detail.object_type?.name ?? ""}`);
        if (hay.includes(nv)) confirmedKeys[key] = value;
      }
    }

    // Matched only when the catalogue clearly identifies THIS coin: right issuer,
    // any provided year/denomination must AGREE (never confirm against a wrong-
    // denomination candidate), and at least one strong signal beyond country.
    const denomProvided = !!attributes.denomination;
    const yearProvided = !Number.isNaN(year);
    const matched =
      countryOk &&
      (!yearProvided || yearOk) &&
      (!denomProvided || denomOk) &&
      (yearOk || denomOk);
    if (!matched) return none;
    return {
      matched: true,
      sourceName: this.name,
      url,
      tier: this.tier,
      confirmedKeys,
      correctedKeys: Object.keys(correctedKeys).length ? correctedKeys : undefined,
    };
  }
}

/** Adapter factory — the real Numista API when NUMISTA_API_KEY is set, else the stub. */
export function getNumistaAdapter(scenario: SourceScenario = {}): SourceAdapter {
  const key = process.env.NUMISTA_API_KEY;
  return key ? new NumistaSourceAdapter(key) : numistaAdapter(scenario);
}

/** Route a lookup to every adapter that serves the category; return the
 *  highest-authority match (lowest tier number wins), else the first result. */
export async function routeLookup(
  adapters: SourceAdapter[],
  l: SourceLookup,
): Promise<SourceResult[]> {
  const eligible = adapters.filter((a) => a.categories.includes(l.category));
  return Promise.all(eligible.map((a) => a.lookup(l)));
}
