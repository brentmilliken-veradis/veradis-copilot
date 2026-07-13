import { describe, it, expect } from "vitest";
import { intakeOrder } from "./intake";
import type { OrderIntake, PhotoInput } from "./types";
import { InMemoryRepository } from "@/packages/data/in-memory";
import { StubStorage } from "@/packages/adapters/storage";

const enc = new TextEncoder();

function photo(name: string, content: string, slot?: string): PhotoInput {
  return { filename: name, bytes: enc.encode(content), slot };
}

function coinOrder(overrides: Partial<OrderIntake> = {}): OrderIntake {
  return {
    orderId: "ord-1",
    category: "coins",
    sku: "appraise",
    declaredAttributes: { country: "Canada", denomination: "Proof Set", year: "2007", mint_mark: "RCM" },
    ownerFacingName: "2007 RCM Proof Set",
    photos: [
      photo("a.jpg", "AAAA"),
      photo("b.jpg", "BBBB"),
      photo("c.jpg", "CCCC"),
      photo("d.jpg", "DDDD"),
      photo("e.jpg", "EEEE"),
    ],
    ...overrides,
  };
}

describe("intakeOrder (E2)", () => {
  it("creates a paid report and selects the Coins profile", async () => {
    const repo = new InMemoryRepository();
    const res = await intakeOrder(repo, new StubStorage(), coinOrder());
    expect(res.report.status).toBe("paid");
    expect(res.report.objectId).toBe("obj:ord-1"); // derived
    expect(res.profile.category).toBe("coins");
  });

  it("stores + hashes every photo and maps them to core slots in order", async () => {
    const repo = new InMemoryRepository();
    const res = await intakeOrder(repo, new StubStorage(), coinOrder());
    expect(res.evidence).toHaveLength(5);
    expect(res.evidence.map((e) => e.slot)).toEqual([
      "obverse", "reverse", "edge", "mintmark_macro", "extra_1",
    ]);
    for (const e of res.evidence) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.c2paState).toBe("unchecked"); // set in E3
      expect(e.storagePath.startsWith("stub://")).toBe(true);
    }
    // persisted
    expect(await repo.listEvidence(res.report.id)).toHaveLength(5);
  });

  it("honours an explicit slot", async () => {
    const repo = new InMemoryRepository();
    const order = coinOrder({ photos: [photo("slab.jpg", "SLAB", "slab_label"), photo("o.jpg", "O")] });
    const res = await intakeOrder(repo, new StubStorage(), order);
    expect(res.evidence[0].slot).toBe("slab_label");
    expect(res.evidence[1].slot).toBe("obverse");
  });

  it("reports core-slot coverage", async () => {
    const repo = new InMemoryRepository();
    const res = await intakeOrder(repo, new StubStorage(), coinOrder());
    // obverse, reverse, edge, mintmark_macro covered → 4 of 4 core slots
    expect(res.coverage).toEqual({ covered: 4, required: 4 });
  });

  it("throws on an unsupported category", async () => {
    const repo = new InMemoryRepository();
    // @ts-expect-error exercising the runtime guard
    await expect(intakeOrder(repo, new StubStorage(), coinOrder({ category: "furniture" }))).rejects.toThrow();
  });
});
