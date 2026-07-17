// R-1 — the push webhook is retired; what remains is the intake shape the
// report poller builds from the shared veradis-accounts rows, and its mapping
// into the pipeline's OrderIntake.

import { describe, expect, it } from "vitest";
import { toOrderIntake, type ParsedVeradisIntake } from "./veradis";

function parsed(overrides: Partial<ParsedVeradisIntake> = {}): ParsedVeradisIntake {
  return {
    reportId: "0d4b6f4e-1111-2222-3333-444455556666",
    objectId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
    userId: "99998888-7777-6666-5555-444433332222",
    email: "collector@example.com",
    ownerName: "Alex Collector",
    category: "art",
    sku: "verify",
    title: "Fishboats, Rivers Inlet",
    declaredAttributes: { artist: "E. J. Hughes", year: "1946" },
    photoPaths: ["99998888/front.jpg"],
    ...overrides,
  };
}

describe("toOrderIntake", () => {
  it("maps the accounts report id to orderId and the object id through", () => {
    const photos = [{ filename: "front.jpg", bytes: new Uint8Array([1]) }];
    const order = toOrderIntake(parsed(), photos);
    expect(order).toMatchObject({
      orderId: "0d4b6f4e-1111-2222-3333-444455556666",
      objectId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
      category: "art",
      sku: "verify",
      ownerFacingName: "Fishboats, Rivers Inlet",
    });
    expect(order.photos).toBe(photos);
  });

  it("falls back to the owner's name when the object has no title", () => {
    expect(toOrderIntake(parsed({ title: null }), []).ownerFacingName).toBe("Alex Collector");
  });

  it("leaves ownerFacingName unset when neither exists", () => {
    expect(toOrderIntake(parsed({ title: null, ownerName: null }), []).ownerFacingName).toBeUndefined();
  });
});
