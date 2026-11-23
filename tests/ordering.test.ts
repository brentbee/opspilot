import { describe, expect, it } from "vitest";
import { STEP, needsRebalance, positionBetween, rebalance } from "@/lib/ordering";

describe("fractional ordering", () => {
  it("handles an empty column", () => expect(positionBetween(null, null)).toBe(STEP));
  it("drops to the top", () => expect(positionBetween(null, 2048)).toBe(1024));
  it("drops to the bottom", () => expect(positionBetween(2048, null)).toBe(3072));
  it("drops between two cards", () => expect(positionBetween(1024, 2048)).toBe(1536));

  it("keeps order across many inserts at the same spot", () => {
    let lo = 1024;
    const hi = 2048;
    for (let i = 0; i < 30; i++) {
      const p = positionBetween(lo, hi);
      expect(p).toBeGreaterThan(lo);
      expect(p).toBeLessThan(hi);
      lo = p;
    }
  });

  it("flags neighbours that are too close", () => {
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
    expect(needsRebalance(1, 2)).toBe(false);
    expect(rebalance(3)).toEqual([1024, 2048, 3072]);
  });
});
