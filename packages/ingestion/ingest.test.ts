import { describe, it, expect, beforeEach } from "vitest";
import { ingest } from "./ingest";
import { intakeOrder } from "@/packages/intake/intake";
import type { OrderIntake } from "@/packages/intake/types";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";
import { StubVisionAdapter, type VisionScenario } from "@/packages/adapters/vision";
import { resetStubRegistry } from "@/packages/adapters/stub-registry";

const enc = new TextEncoder();

function coinOrder(overrides: Partial<OrderIntake> = {}): OrderIntake {
  return {
    orderId: "ord-1",
    category: "coins",
    sku: "appraise",
    declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM" },
    photos: [
      { filename: "obv.jpg", bytes: enc.encode("OBV") },
      { filename: "rev.jpg", bytes: enc.encode("REV") },
      { filename: "edge.jpg", bytes: enc.encode("EDG") },
      { filename: "mm.jpg", bytes: enc.encode("MM") },
    ],
    ...overrides,
  };
}

async function runIntakeThenIngest(order: OrderIntake, scenarios: Record<string, VisionScenario>) {
  const repo = new InMemoryRepository();
  const intake = await intakeOrder(repo, new StubStorage(), order);
  const vision = new StubVisionAdapter(scenarios);
  const result = await ingest(repo, vision, {
    report: intake.report,
    profile: intake.profile,
    declaredAttributes: order.declaredAttributes,
    evidence: intake.evidence.map((e) => ({ id: e.id, slot: e.slot, sha256: e.sha256 })),
  });
  return { repo, intake, result };
}

describe("ingest (E3)", () => {
  beforeEach(() => resetStubRegistry());

  it("no contradiction → no corrections, C2PA states written", async () => {
    const { repo, result } = await runIntakeThenIngest(coinOrder(), {});
    expect(result.corrections).toHaveLength(0);
    expect(result.resolvedAttributes).toMatchObject({ year: "2007", mint_mark: "RCM" });
    const evidence = await repo.listEvidence(result.report.id);
    expect(evidence.every((e) => e.c2paState === "absent")).toBe(true);
  });

  it("MISLABEL DEMO: a coin typed 2008 is auto-corrected to 2007", async () => {
    const order = coinOrder({
      orderId: "ord-mislabel",
      declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2008", mint_mark: "RCM" },
    });
    const { repo, result } = await runIntakeThenIngest(order, {
      "obj:ord-mislabel": { derivedAttributes: { year: "2007" } },
    });

    // exactly one correction, on the year, kindness register
    expect(result.corrections).toHaveLength(1);
    const c = result.corrections[0];
    expect(c.claimed).toBe("2008");
    expect(c.correctedValue).toBe("2007");
    expect(c.kindnessNote).toContain("2008");
    expect(c.kindnessNote).toContain("2007");

    // the corrected value wins; unrelated declared attributes are kept
    expect(result.resolvedAttributes.year).toBe("2007");
    expect(result.resolvedAttributes.mint_mark).toBe("RCM");

    // persisted as a first-class record
    expect(await repo.listCorrections(result.report.id)).toHaveLength(1);
  });

  it("an invalid C2PA credential raises an anti-fraud red flag", async () => {
    const { result } = await runIntakeThenIngest(coinOrder(), {
      "obj:ord-1": { c2pa: { obverse: "invalid" } },
    });
    expect(result.redFlags.some((f) => f.key === "c2pa_invalid" && f.evidenceSlot === "obverse")).toBe(true);
  });

  it("re-routes the category when the images say it is something else", async () => {
    const { repo, result } = await runIntakeThenIngest(coinOrder({ orderId: "ord-reroute" }), {
      "obj:ord-reroute": { derivedCategory: "medals" },
    });
    expect(result.rerouted).toBe(true);
    expect(result.report.category).toBe("medals");
    expect(result.profile.category).toBe("medals");
    expect(result.corrections.some((c) => c.claimed.includes("coins") && c.correctedValue.includes("medals"))).toBe(true);
    expect((await repo.getReport(result.report.id))?.category).toBe("medals");
  });
});
