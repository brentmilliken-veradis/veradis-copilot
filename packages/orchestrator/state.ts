// Job orchestrator — the report lifecycle state machine (ADR-001 §state model).
//
//   created ──▶ paid ──▶ provisional ──▶ definitive        (the happy path)
//                 │            │
//                 │            └────▶ withheld              (curator finds a legal restriction)
//                 ├────▶ unscored                          (data-sufficiency false → refund)
//                 └────▶ withheld                          (legal restriction → refund + curator)
//
// `flagged` is a SCORE TIER, not a lifecycle node: a Flagged report is paid and
// delivered, so it travels the normal provisional → definitive path with an
// evidence bundle attached. Terminal nodes: definitive, unscored, withheld.

import type { ReportStatus, Tier } from "@/packages/pcs-types";

export const TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  created: ["paid"],
  paid: ["provisional", "unscored", "withheld"],
  provisional: ["definitive", "withheld"],
  definitive: [],
  unscored: [],
  withheld: [],
  // `flagged` never appears as a lifecycle status; kept for enum completeness.
  flagged: [],
};

export const TERMINAL: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  "definitive",
  "unscored",
  "withheld",
]);

export function isTerminal(status: ReportStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: ReportStatus, to: ReportStatus) {
    super(`invalid report transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: ReportStatus, to: ReportStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Given a scored tier, the status a `paid` report moves to.
 *  Unscored/Withheld short-circuit (refund); every scoreable tier — including
 *  Flagged — goes to `provisional` for curator confirmation. */
export function statusForTier(tier: Tier): Extract<ReportStatus, "provisional" | "unscored" | "withheld"> {
  switch (tier) {
    case "unscored":
      return "unscored";
    case "withheld":
      return "withheld";
    default:
      return "provisional";
  }
}
