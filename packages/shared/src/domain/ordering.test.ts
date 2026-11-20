import { describe, expect, it } from "vitest";
import { moveInOrder, orderBetween, rebalance } from "./ordering.js";

describe("fractional ordering", () => {
  it("creates start, end, and midpoint positions", () => {
    expect(orderBetween()).toBe(1024);
    expect(orderBetween(undefined, 20)).toBe(10);
    expect(orderBetween(20)).toBe(1044);
    expect(orderBetween(20, 40)).toBe(30);
  });
  it("guards invalid and exhausted gaps", () => {
    expect(() => orderBetween(5, 5)).toThrow(RangeError);
    expect(() => orderBetween(5, 5.000000000000001)).toThrow(RangeError);
  });
  it("rebases positions and moves by index", () => {
    expect(rebalance(["a", "b"])).toEqual([
      { id: "a", order: 1024 },
      { id: "b", order: 2048 },
    ]);
    expect(
      moveInOrder(
        [
          { id: "a", order: 1024 },
          { id: "b", order: 2048 },
        ],
        "b",
        0,
      ),
    ).toEqual([
      { id: "b", order: 512 },
      { id: "a", order: 1024 },
    ]);
  });
  it("rejects unknown item and bounds the destination", () => {
    expect(() => moveInOrder([], "x", 0)).toThrow("not found");
    expect(moveInOrder([{ id: "x", order: 1 }], "x", 9)[0]?.order).toBe(1024);
  });
});
