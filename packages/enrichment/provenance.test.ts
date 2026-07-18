import { describe, it, expect } from "vitest";
import { deriveProvenanceCustody } from "./provenance";

describe("deriveProvenanceCustody", () => {
  it("absent / empty notes contribute nothing (existing behaviour unchanged)", () => {
    for (const n of [undefined, null, "", "   "]) {
      const p = deriveProvenanceCustody(n);
      expect(p).toEqual({ coverage: 0, quality: 0, events: 0, signals: [] });
    }
  });

  it("unrecognised prose contributes nothing (length alone is not score)", () => {
    const p = deriveProvenanceCustody("A nice heavy piece, quite shiny, I like it a lot.");
    expect(p.coverage).toBe(0);
    expect(p.signals).toHaveLength(0);
  });

  it("a described single-owner, sealed, original-packaging history lifts custody", () => {
    const p = deriveProvenanceCustody(
      "Single owner from new, still sealed in the original packaging with intact foil.",
    );
    const keys = p.signals.map((s) => s.key);
    expect(keys).toContain("single_owner");
    expect(keys).toContain("original_packaging");
    expect(keys).toContain("sealed");
    expect(p.coverage).toBeGreaterThan(0);
    // Narrative-only signals shift the estimate but add NO trial (CI stays wide).
    expect(p.events).toBe(0);
  });

  it("documented-evidence signals (receipt / papers / chain) add custody trials", () => {
    const p = deriveProvenanceCustody(
      "Purchased from the estate of the original owner in 1998; original receipt and certificate of authenticity retained.",
    );
    const keys = p.signals.map((s) => s.key);
    expect(keys).toContain("documented_chain");
    expect(keys).toContain("receipt");
    expect(keys).toContain("certificate");
    expect(p.events).toBeGreaterThanOrEqual(3); // each evidence signal is a trial
  });

  it("credit is CAPPED — a description stuffed with every signal can never max custody", () => {
    const everything =
      "Single owner from new, original packaging, sealed with intact foil, original receipt, " +
      "certificate of authenticity and warranty card, purchased from the estate of the first owner, " +
      "provenance documented since 1972, ex-collection, chain of ownership complete.";
    const p = deriveProvenanceCustody(everything);
    expect(p.coverage).toBeLessThanOrEqual(0.35);
    expect(p.quality).toBeLessThanOrEqual(0.2);
  });

  it("is deterministic — same notes, same result", () => {
    const n = "Inherited by descent; original receipt from 1990 retained.";
    expect(deriveProvenanceCustody(n)).toEqual(deriveProvenanceCustody(n));
  });

  it("does NOT credit a DENIED claim — 'No original packaging'", () => {
    const p = deriveProvenanceCustody("No original packaging. Case and coin in mint condition.");
    expect(p.signals.map((s) => s.key)).not.toContain("original_packaging");
  });

  it("negation is clause-scoped — 'no scratches, original box' still credits the box", () => {
    const p = deriveProvenanceCustody("No scratches, original box and papers retained.");
    const keys = p.signals.map((s) => s.key);
    expect(keys).toContain("original_packaging");
    expect(keys).toContain("certificate"); // "papers"
  });

  it("credits family provenance — gift / heirloom / handed down", () => {
    for (const n of ["A gift from my grandfather", "family heirloom", "handed down through three generations"]) {
      expect(deriveProvenanceCustody(n).signals.map((s) => s.key)).toContain("documented_chain");
    }
  });

  it("the Poppy description: credits the family gift, not the denied packaging", () => {
    const notes =
      "Christmas tradition and gift from Robert Milliken (b.1943) to his children and grandchildren. No original packaging. Case and coin in mint condition.";
    const keys = deriveProvenanceCustody(notes).signals.map((s) => s.key);
    expect(keys).toContain("documented_chain"); // "gift from" — family provenance
    expect(keys).not.toContain("original_packaging"); // "No original packaging" — denied
    // "(b.1943)" is a birth year, not a provenance date — correctly not credited.
    expect(keys).not.toContain("dated_history");
  });
});
