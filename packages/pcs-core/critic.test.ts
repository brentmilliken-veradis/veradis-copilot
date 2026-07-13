import { describe, it, expect } from "vitest";
import { applyCritic } from "./tier";

describe("critic gate (§9) — may only withhold or downgrade, never inflate", () => {
  it("no directive → tier unchanged", () => {
    expect(applyCritic("gold")).toBe("gold");
  });

  it("downgrades within the positive bands", () => {
    expect(applyCritic("gold", "silver")).toBe("silver");
    expect(applyCritic("silver", "bronze")).toBe("bronze");
  });

  it("refuses to inflate", () => {
    expect(applyCritic("bronze", "gold")).toBe("bronze");
    expect(applyCritic("silver", "gold")).toBe("silver");
  });

  it("may always withhold or flag", () => {
    expect(applyCritic("gold", "withheld")).toBe("withheld");
    expect(applyCritic("silver", "flagged")).toBe("flagged");
  });
});
