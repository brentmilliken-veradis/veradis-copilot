// Sanctions + stolen-property checks (E4 → Risk quadrant). trade.gov CSL and
// OFAC are free/programmatic; stolen registries (Interpol, ICOM) run always;
// ALR is feature-flagged off (Risk capped at 90). Stub clears by default.

import type { RiskEventInput } from "@/packages/pcs-types";
import { markStubbed } from "./stub-registry";

export interface SanctionsQuery {
  parties: string[];
  objectId: string;
}

export interface SanctionsAdapter {
  name: string;
  /** Returns any Risk events found (empty = clear). */
  check(q: SanctionsQuery): Promise<RiskEventInput[]>;
}

/** Scenario keyed by objectId → forced risk events (for testing hits). */
export type SanctionsScenario = Record<string, RiskEventInput[]>;

export class StubSanctionsAdapter implements SanctionsAdapter {
  name = "sanctions:stub";
  constructor(private scenario: SanctionsScenario = {}) {}

  async check(q: SanctionsQuery): Promise<RiskEventInput[]> {
    markStubbed(this.name, "TRADEGOV_CSL_KEY", "sanctions + stolen-registry screening");
    return this.scenario[q.objectId] ?? [];
  }
}
