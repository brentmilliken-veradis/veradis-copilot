// F-1 — thin-source tier cap truth table (all six tiers × both calibrations).

import { describe, expect, it } from "vitest";
import { capTier } from "./cap";
import type { Tier } from "@/packages/pcs-types";

const TIERS: Tier[] = ["gold", "silver", "bronze", "flagged", "unscored", "withheld"];

describe("capTier", () => {
  it("calibrated: every tier passes through unchanged", () => {
    for (const t of TIERS) expect(capTier(t, "calibrated")).toBe(t);
  });

  it("provisional: scored tiers clamp to flagged; refund states pass through", () => {
    expect(capTier("gold", "provisional")).toBe("flagged");
    expect(capTier("silver", "provisional")).toBe("flagged");
    expect(capTier("bronze", "provisional")).toBe("flagged");
    expect(capTier("flagged", "provisional")).toBe("flagged");
    expect(capTier("unscored", "provisional")).toBe("unscored");
    expect(capTier("withheld", "provisional")).toBe("withheld");
  });

  it("can never emit a confident tier for a provisional category", () => {
    for (const t of TIERS) {
      expect(["gold", "silver", "bronze"]).not.toContain(capTier(t, "provisional"));
    }
  });
});
