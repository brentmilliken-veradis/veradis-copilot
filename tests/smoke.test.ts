import { describe, it, expect } from "vitest";

// Smoke test — confirms the Vitest harness resolves and runs before any epic code lands.
describe("harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
