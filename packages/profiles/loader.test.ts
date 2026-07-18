import { describe, it, expect } from "vitest";
import { loadProfile, validateProfile, allProfiles, seedProfiles, ProfileValidationError } from "./loader";
import { InMemoryRepository } from "@/packages/data/in-memory";
import type { CategoryProfile } from "@/packages/pcs-types";

describe("profile loader", () => {
  it("loads the Coins profile as versioned data", () => {
    const p = loadProfile("coins");
    expect(p.category).toBe("coins");
    expect(p.version).toBe(1);
    expect(p.identityKeys.map((k) => k.key)).toEqual([
      "country", "denomination", "year", "mint_mark", "variety",
    ]);
    // never a serial
    expect(p.identityNeverKeys).toContain("serial");
    expect(p.identityKeys.some((k) => k.key === "serial")).toBe(false);
  });

  it("Coins identity weights sum to 1.0", () => {
    const p = loadProfile("coins");
    const sum = p.identityKeys.reduce((a, k) => a + k.weight, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("rejects a profile whose identity weights do not sum to 1.0", () => {
    const bad: CategoryProfile = {
      category: "coins", version: 9, label: "bad",
      identityKeys: [{ key: "year", label: "Y", weight: 0.5 }],
      captureSlots: [], redFlags: [], corpusSources: [], compKeys: [],
    };
    expect(() => validateProfile(bad)).toThrow(ProfileValidationError);
  });

  it("rejects a forbidden identity key (coins have no serial)", () => {
    const bad: CategoryProfile = {
      category: "coins", version: 9, label: "bad",
      identityKeys: [{ key: "serial", label: "S", weight: 1.0 }],
      identityNeverKeys: ["serial"],
      captureSlots: [], redFlags: [], corpusSources: [], compKeys: [],
    };
    expect(() => validateProfile(bad)).toThrow(/forbidden identity key/);
  });

  it("loads the E-E scaffold profiles (watches, art, fine-china) validated", () => {
    for (const cat of ["watches", "art", "fine-china"] as const) {
      const p = loadProfile(cat);
      expect(p.category).toBe(cat);
      expect(p.version).toBe(1);
      const sum = p.identityKeys.reduce((a, k) => a + k.weight, 0);
      expect(sum).toBeCloseTo(1.0, 6);
      expect(p.captureSlots.some((s) => s.core)).toBe(true);
      expect(p.redFlags.length).toBeGreaterThan(0);
      // Scaffolds are explicitly labelled so no artefact presents them as calibrated.
      expect(p.label.toLowerCase()).toMatch(/scaffold|thin/);
    }
  });

  it("medals resolves to the full v2 profile; v1 stays pinnable", () => {
    const latest = loadProfile("medals");
    expect(latest.version).toBe(2);
    expect(latest.captureSlots.map((s) => s.slotId)).toContain("naming_macro");
    expect(latest.redFlags.map((r) => r.key)).toContain("remounted_group");
    const pinned = loadProfile("medals", 1);
    expect(pinned.version).toBe(1);
  });

  it("watches legitimately use a serial (not a forbidden key)", () => {
    const p = loadProfile("watches");
    expect(p.identityKeys.some((k) => k.key === "serial_number")).toBe(true);
    expect(p.identityNeverKeys ?? []).not.toContain("serial_number");
  });

  it("throws for an unknown category", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => loadProfile("furniture")).toThrow(ProfileValidationError);
  });

  it("only deliberately-calibrated categories carry the calibrated flag", () => {
    // Honesty invariant (D-1): no shipped category may present a confident tier
    // until its calibration is validated — a golden set + a validated
    // field-golden entry. Calibrating is a deliberate act: flip the flag AND
    // add its golden regression test (tests/golden/<cat>-calibration-v1.json +
    // packages/profiles/<cat>-calibration.test.ts) in the SAME change, then add
    // it here. A silent re-flip of any OTHER category must still fail CI.
    const calibrated = allProfiles()
      .filter((p) => p.calibration === "calibrated")
      .map((p) => `${p.category}@${p.version}`)
      .sort();
    expect(calibrated).toEqual(["coins@1"]);
  });

  it("seeds all built-in profiles into a repository", async () => {
    const repo = new InMemoryRepository();
    await seedProfiles(repo);
    const seeded = await repo.getProfile("coins");
    expect(seeded?.json.identityKeys.length).toBe(5);
    expect(allProfiles().length).toBeGreaterThanOrEqual(1);
  });
});
