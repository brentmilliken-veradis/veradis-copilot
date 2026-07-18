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
import { renderReport } from "@/packages/report/render";

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
    // The base report discloses the register was NOT checked — never a false clean.
    const html = renderReport(res.snapshot);
    expect(html).toContain("Stolen-property register: not checked");
    expect(html.toLowerCase()).not.toContain("authenticated");
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

  it("the theft add-on tightens a genuine watch's risk CI (the score-improver)", async () => {
    const riskCiWidth = (s: { quadrants: { quadrant: string; ci: { lo: number; hi: number } }[] }) => {
      const r = s.quadrants.find((q) => q.quadrant === "risk")!.ci;
      return r.hi - r.lo;
    };

    const a = buildWatchFixture("genuine_strong", "watch-cmp");
    const base = await runProvisional(new InMemoryRepository(), new StubStorage(), a.adapters, a.order, {
      profile: a.calibratedProfile,
    });

    const b = buildWatchFixture("genuine_strong", "watch-cmp"); // same seed
    b.order.addons = { theftRegistry: true };
    const withAddon = await runProvisional(new InMemoryRepository(), new StubStorage(), b.adapters, b.order, {
      profile: b.calibratedProfile,
    });

    // Same raw risk (90 cap stands), but the add-on's second trial narrows the CI.
    expect(riskCiWidth(withAddon.rawScore)).toBeLessThan(riskCiWidth(base.rawScore));
    // …and the add-on report shows a clean register + certificate, not the gap.
    const html = renderReport(withAddon.snapshot);
    expect(html).toContain("no match on the check date; a clearance certificate");
    expect(html).not.toContain("Stolen-property register: not checked");
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
