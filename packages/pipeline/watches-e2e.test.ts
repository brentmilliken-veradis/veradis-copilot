// Watches end-to-end calibration runner. Proves the watch profile flows through
// intake → ingest → enrich → score and that the calibration cap is load-bearing
// for watches. These use CONSTRUCTED fixtures (plumbing proof); exact expert
// tiers are asserted by the field-golden set (real objects) when it lands.

import { describe, it, expect, beforeEach } from "vitest";
import { runProvisional } from "./run";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";
import { buildWatchFixture } from "@/packages/fixtures/watch";

const matRaw = (s: { quadrants: { quadrant: string; raw: number }[] }) =>
  s.quadrants.find((q) => q.quadrant === "material")?.raw ?? NaN;

describe("watches end-to-end — calibration path", () => {
  beforeEach(() => resetStubRegistry());

  it("a genuine watch, CALIBRATED, presents its real tier (not capped)", async () => {
    const { order, adapters, calibratedProfile } = buildWatchFixture("genuine_strong");
    const res = await runProvisional(new InMemoryRepository(), new StubStorage(), adapters, order, {
      profile: calibratedProfile,
    });

    expect(res.snapshot.capReason).toBeUndefined();
    expect(res.score.tier).not.toBe("flagged"); // a fully-sourced genuine earns a real tier
    expect(res.score).toEqual(res.rawScore); // uncapped: presented === raw
  });

  it("the SAME genuine watch, PROVISIONAL (registry default), is capped to Flagged — the cap is load-bearing", async () => {
    const { order, adapters } = buildWatchFixture("genuine_strong");
    // No profile override → the registry watches profile ships provisional.
    const res = await runProvisional(new InMemoryRepository(), new StubStorage(), adapters, order);

    expect(res.snapshot.capReason).toBe("uncalibrated_category");
    expect(res.score.tier).toBe("flagged");
    // The scorer's real tier is higher — proving the cap actually clamps.
    expect(res.rawScore.tier).not.toBe("flagged");
  });

  it("a frankenwatch, even CALIBRATED, is caught: material integrity fails and no confident tier", async () => {
    const { order, adapters, calibratedProfile } = buildWatchFixture("franken");
    const res = await runProvisional(new InMemoryRepository(), new StubStorage(), adapters, order, {
      profile: calibratedProfile,
    });

    // The redial + non-genuine movement drive the material quadrant down…
    expect(matRaw(res.rawScore)).toBeLessThan(50);
    // …and the engine refuses Gold/Silver for a fake.
    expect(["flagged", "bronze"]).toContain(res.score.tier);
    // A material check is recorded as flagged.
    const matFlagged = res.snapshot.checks.some((c) => c.quadrant === "material" && c.result === "flagged");
    expect(matFlagged).toBe(true);
  });
});
