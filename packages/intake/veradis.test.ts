// E-C — verify.veradis.ai intake: signature scheme, payload parsing, and the
// mapping into the pipeline's OrderIntake shape.

import { describe, expect, it } from "vitest";
import {
  parseVeradisIntake,
  signVeradisPayload,
  toOrderIntake,
  verifyVeradisSignature,
  type VeradisIntakePayload,
} from "./veradis";

const SECRET = "shared-secret";

function payload(overrides: Partial<VeradisIntakePayload> = {}): VeradisIntakePayload {
  return {
    report_id: "0d4b6f4e-1111-2222-3333-444455556666",
    object_id: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
    user_id: "99998888-7777-6666-5555-444433332222",
    email: "collector@example.com",
    owner_name: "Alex Collector",
    type: "verify",
    category: "coins",
    title: "2007 RCM Proof Set",
    declared_attributes: { Year: "2007", "Mint mark": "RCM", empty: "  " },
    photo_paths: ["99998888-7777-6666-5555-444433332222/obv.jpg", "99998888-7777-6666-5555-444433332222/rev.heic"],
    ...overrides,
  };
}

describe("veradis intake signature", () => {
  it("round-trips sign → verify", () => {
    const body = JSON.stringify(payload());
    const sig = signVeradisPayload(body, SECRET);
    expect(verifyVeradisSignature(body, sig, SECRET)).toBe(true);
  });

  it("rejects a wrong secret, tampered body, or missing header", () => {
    const body = JSON.stringify(payload());
    const sig = signVeradisPayload(body, SECRET);
    expect(verifyVeradisSignature(body, sig, "other-secret")).toBe(false);
    expect(verifyVeradisSignature(body + " ", sig, SECRET)).toBe(false);
    expect(verifyVeradisSignature(body, null, SECRET)).toBe(false);
  });
});

describe("parseVeradisIntake", () => {
  it("parses a full payload", () => {
    const parsed = parseVeradisIntake(payload());
    expect(parsed.reportId).toBe("0d4b6f4e-1111-2222-3333-444455556666");
    expect(parsed.category).toBe("coins");
    expect(parsed.sku).toBe("verify");
    expect(parsed.title).toBe("2007 RCM Proof Set");
    expect(parsed.declaredAttributes).toEqual({ year: "2007", mint_mark: "RCM" });
    expect(parsed.photoPaths).toHaveLength(2);
  });

  it("maps type appraise → appraise sku, anything else → verify", () => {
    expect(parseVeradisIntake(payload({ type: "appraise" })).sku).toBe("appraise");
    expect(parseVeradisIntake(payload({ type: "pcs" })).sku).toBe("verify");
  });

  it("rejects an unsupported category", () => {
    expect(() => parseVeradisIntake(payload({ category: "paintings" }))).toThrow(/unsupported category/);
  });

  it("rejects missing required fields and empty photo lists", () => {
    expect(() => parseVeradisIntake(payload({ report_id: "" }))).toThrow(/report_id/);
    expect(() => parseVeradisIntake(payload({ email: undefined as unknown as string }))).toThrow(/email/);
    expect(() => parseVeradisIntake(payload({ photo_paths: [] }))).toThrow(/photo_paths/);
  });

  it("tolerates null owner_name / title / declared_attributes", () => {
    const parsed = parseVeradisIntake(payload({ owner_name: null, title: null, declared_attributes: null }));
    expect(parsed.ownerName).toBeNull();
    expect(parsed.title).toBeNull();
    expect(parsed.declaredAttributes).toEqual({});
  });
});

describe("toOrderIntake", () => {
  it("maps the accounts report id to orderId and the object id through", () => {
    const parsed = parseVeradisIntake(payload());
    const photos = [{ filename: "obv.jpg", bytes: new Uint8Array([1]) }];
    const order = toOrderIntake(parsed, photos);
    expect(order).toMatchObject({
      orderId: parsed.reportId,
      objectId: parsed.objectId,
      category: "coins",
      sku: "verify",
      ownerFacingName: "2007 RCM Proof Set",
    });
    expect(order.photos).toBe(photos);
  });

  it("falls back to the owner's name when the object has no title", () => {
    const parsed = parseVeradisIntake(payload({ title: null }));
    expect(toOrderIntake(parsed, []).ownerFacingName).toBe("Alex Collector");
  });
});
