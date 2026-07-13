// Internal graph cross-reference (E4). The tenant collections already ingested
// (Seaforth, Wührmann, 5th/15th Field RCA) are the moat: a cross-institutional
// or cross-family link is the strongest Custody signal. Stub returns no links by
// default; a scenario can inject corroborating edges for a given object.

import type { Category } from "@/packages/pcs-types";

export interface GraphLink {
  institution: string;
  relation: string; // e.g. "same-issue", "same-recipient", "sibling-object"
  confidence: number; // 0–1
  note?: string;
}

export interface GraphQuery {
  objectId: string;
  category: Category;
  attributes: Record<string, string>;
}

export interface GraphAdapter {
  name: string;
  crossRef(q: GraphQuery): Promise<GraphLink[]>;
}

export type GraphScenario = Record<string, GraphLink[]>;

export class StubGraphAdapter implements GraphAdapter {
  name = "graph:internal";
  constructor(private scenario: GraphScenario = {}) {}

  async crossRef(q: GraphQuery): Promise<GraphLink[]> {
    return this.scenario[q.objectId] ?? [];
  }
}
