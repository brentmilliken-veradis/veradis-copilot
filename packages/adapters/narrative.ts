// Narrative adapter (drafts prose for the report). The LLM drafts NARRATIVE only —
// it NEVER emits a number the scorer owns. Until NARRATIVE_API_KEY is set, a
// deterministic template stub produces the sections. Honesty ceiling enforced:
// "verified/expert-reviewed", never "authenticated".

import type { NarrativeSection, Tier } from "@/packages/pcs-types";
import { markStubbed } from "./stub-registry";

export interface NarrativeRequest {
  title: string;
  category: string;
  resolvedAttributes: Record<string, string>;
  tier: Tier;
  corrections: { claimed: string; correctedValue: string }[];
}

export interface NarrativeAdapter {
  name: string;
  draft(req: NarrativeRequest): Promise<NarrativeSection[]>;
}

const TIER_PROSE: Record<Tier, string> = {
  gold: "The documentary record is complete and corroborated.",
  silver: "The record is strong with disclosed gaps.",
  bronze: "The record carries material gaps, disclosed in full.",
  flagged: "The network finds evidence the claimed identity does not match this object.",
  unscored: "There was insufficient data to reach a confident answer.",
  withheld: "This query is routed to a curator-mediated channel under a disclosure restriction.",
};

export class StubNarrativeAdapter implements NarrativeAdapter {
  name = "narrative:stub";

  async draft(req: NarrativeRequest): Promise<NarrativeSection[]> {
    markStubbed(this.name, "NARRATIVE_API_KEY", "report narrative drafting");
    const attrs = Object.entries(req.resolvedAttributes)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(", ");
    const sections: NarrativeSection[] = [
      {
        id: "summary",
        title: "Summary",
        body: `${req.title}. ${attrs}. ${TIER_PROSE[req.tier]} Verified against the documentary record, expert-reviewed.`,
      },
    ];
    if (req.corrections.length) {
      sections.push({
        id: "corrections",
        title: "What we corrected",
        body: req.corrections
          .map((c) => `You catalogued this as “${c.claimed}”; the images read “${c.correctedValue}”. We corrected it and re-scored.`)
          .join(" "),
      });
    }
    return sections;
  }
}
