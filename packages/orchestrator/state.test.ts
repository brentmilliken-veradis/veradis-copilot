import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  statusForTier,
  InvalidTransitionError,
} from "./state";

describe("orchestrator state machine", () => {
  it("allows the happy path created → paid → provisional → definitive", () => {
    expect(canTransition("created", "paid")).toBe(true);
    expect(canTransition("paid", "provisional")).toBe(true);
    expect(canTransition("provisional", "definitive")).toBe(true);
  });

  it("allows refund short-circuits from paid", () => {
    expect(canTransition("paid", "unscored")).toBe(true);
    expect(canTransition("paid", "withheld")).toBe(true);
  });

  it("forbids illegal jumps", () => {
    expect(canTransition("created", "definitive")).toBe(false);
    expect(canTransition("created", "provisional")).toBe(false);
    expect(canTransition("definitive", "provisional")).toBe(false);
    expect(canTransition("unscored", "paid")).toBe(false);
  });

  it("assertTransition throws on an illegal move", () => {
    expect(() => assertTransition("created", "definitive")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("paid", "provisional")).not.toThrow();
  });

  it("marks terminal states", () => {
    expect(isTerminal("definitive")).toBe(true);
    expect(isTerminal("unscored")).toBe(true);
    expect(isTerminal("withheld")).toBe(true);
    expect(isTerminal("provisional")).toBe(false);
    expect(isTerminal("paid")).toBe(false);
  });

  it("maps a scored tier to the next status after paid", () => {
    expect(statusForTier("gold")).toBe("provisional");
    expect(statusForTier("silver")).toBe("provisional");
    expect(statusForTier("bronze")).toBe("provisional");
    expect(statusForTier("flagged")).toBe("provisional"); // paid + delivered
    expect(statusForTier("unscored")).toBe("unscored");
    expect(statusForTier("withheld")).toBe("withheld");
  });
});
