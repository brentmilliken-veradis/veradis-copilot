// Narrative adapter (drafts prose for the report). The LLM drafts NARRATIVE only —
// it NEVER emits a number the scorer owns. With NARRATIVE_API_KEY (or ANTHROPIC_API_KEY)
// set, drafting runs on Claude; otherwise a deterministic template stub produces the
// sections. Honesty ceiling enforced: "verified/expert-reviewed", never "authenticated".

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

// ---- Live adapter: Claude drafts the prose, never the number. ----

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const NARRATIVE_SYSTEM = [
  "You draft the prose for a veradis provenance report. You are a careful, plain, institutional writer.",
  "HARD RULES:",
  "- You NEVER state or imply a numeric score, percentage, probability, or the tier's rank. The score is computed by a separate deterministic engine; the tier word is given to you only to set tone.",
  "- Honesty ceiling: you may write 'verified against the documentary record, expert-reviewed'. You must NEVER write 'authenticated', 'guaranteed genuine', 'certified authentic', or any equivalent.",
  "- Use ONLY the attributes and corrections provided. Never invent a fact, a source, a date, or a piece of history.",
  "- Voice: short declarative sentences; institutional; no marketing language.",
  'Return ONLY a JSON array of sections, each {"id":string,"title":string,"body":string}. Nothing outside the JSON.',
].join("\n");

function narrativeUserPrompt(req: NarrativeRequest): string {
  const attrs = Object.entries(req.resolvedAttributes)
    .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`)
    .join("\n");
  const corr = req.corrections.length
    ? req.corrections.map((c) => `- catalogued as "${c.claimed}"; the record reads "${c.correctedValue}"`).join("\n")
    : "(none)";
  return [
    `Object title: ${req.title}`,
    `Category: ${req.category}`,
    `Tier (tone only — do not print the word or any number): ${req.tier} — ${TIER_PROSE[req.tier]}`,
    "",
    "Resolved attributes:",
    attrs || "(none)",
    "",
    "Corrections we made:",
    corr,
    "",
    "Write a 'Summary' section (2–4 sentences), and — only if there were corrections — a 'What we corrected' section. End the summary with 'Verified against the documentary record, expert-reviewed.'",
  ].join("\n");
}

function parseSections(text: string): NarrativeSection[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter(
          (s): s is NarrativeSection =>
            !!s &&
            typeof (s as NarrativeSection).id === "string" &&
            typeof (s as NarrativeSection).body === "string",
        )
        .map((s) => ({ id: s.id, title: s.title ?? s.id, body: s.body }));
    }
  } catch {
    /* fall through to empty */
  }
  return [];
}

export class ClaudeNarrativeAdapter implements NarrativeAdapter {
  name = "narrative:claude";
  constructor(
    private apiKey: string,
    // Exact model id is env-overridable (NARRATIVE_MODEL) — set it if this default drifts.
    private model: string = process.env.NARRATIVE_MODEL ?? "claude-sonnet-4-5",
  ) {}

  async draft(req: NarrativeRequest): Promise<NarrativeSection[]> {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        system: NARRATIVE_SYSTEM,
        messages: [{ role: "user", content: narrativeUserPrompt(req) }],
      }),
    });
    if (!res.ok) throw new Error(`narrative:claude ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    const sections = parseSections(text);
    return sections.length ? sections : new StubNarrativeAdapter().draft(req);
  }
}

/** Factory — Claude when a key is present, else the deterministic stub. */
export function getNarrativeAdapter(): NarrativeAdapter {
  const key = process.env.NARRATIVE_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  return key ? new ClaudeNarrativeAdapter(key) : new StubNarrativeAdapter();
}
