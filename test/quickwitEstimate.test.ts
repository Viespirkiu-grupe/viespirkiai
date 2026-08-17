import { describe, expect, it } from "vitest";
import { clampHitsEstimate } from "../quickwit/quickwit.js";

describe("Quickwit hit estimate", () => {
  it("is never lower than the number of observed live hits", () => {
    expect(clampHitsEstimate(43, 44)).toBe(44);
  });

  it("preserves an estimate that is higher than the observed hits", () => {
    expect(clampHitsEstimate(100, 44)).toBe(100);
  });

  it("uses observed hits when no estimate is available", () => {
    expect(clampHitsEstimate(null, 44)).toBe(44);
  });
});
