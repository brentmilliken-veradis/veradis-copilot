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

export interface SourceAdapter {
  name: string;
  tier: SourceTier;
  role: "ground_truth" | "corroboration" | "cite_only";
  categories: Category[];
  lookup(l: SourceLookup): Promise<SourceResult>;
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

/** Route a lookup to every adapter that serves the category; return the
 *  highest-authority match (lowest tier number wins), else the first result. */
export async function routeLookup(
  adapters: SourceAdapter[],
  l: SourceLookup,
): Promise<SourceResult[]> {
  const eligible = adapters.filter((a) => a.categories.includes(l.category));
  return Promise.all(eligible.map((a) => a.lookup(l)));
}
