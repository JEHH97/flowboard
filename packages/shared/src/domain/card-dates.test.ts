import { describe, expect, it } from "vitest";
import { isOverdue, toDateInputValue } from "./card-dates.js";

describe("card due dates", () => {
  const today = new Date("2026-03-20T12:00:00.000Z");

  it("marks only earlier calendar dates as overdue", () => {
    expect(isOverdue("2026-03-19T23:59:59.999Z", today)).toBe(true);
    expect(isOverdue("2026-03-20T00:00:00.000Z", today)).toBe(false);
    expect(isOverdue("2026-03-21T00:00:00.000Z", today)).toBe(false);
  });

  it("handles missing or invalid values and formats date inputs", () => {
    expect(isOverdue(null, today)).toBe(false);
    expect(isOverdue("not-a-date", today)).toBe(false);
    expect(toDateInputValue("2026-03-21T10:00:00.000Z")).toBe("2026-03-21");
    expect(toDateInputValue(null)).toBe("");
  });
});
