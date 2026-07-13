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

  it("throws for an unknown category", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => loadProfile("furniture")).toThrow(ProfileValidationError);
  });

  it("seeds all built-in profiles into a repository", async () => {
    const repo = new InMemoryRepository();
    await seedProfiles(repo);
    const seeded = await repo.getProfile("coins");
    expect(seeded?.json.identityKeys.length).toBe(5);
    expect(allProfiles().length).toBeGreaterThanOrEqual(1);
  });
});
