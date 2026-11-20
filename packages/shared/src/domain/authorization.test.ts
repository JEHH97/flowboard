import { describe, expect, it } from "vitest";
import { assertCan, can } from "./authorization.js";

describe("board permissions", () => {
  it("grants owner, editor, and viewer capabilities by role", () => {
    expect(can("owner", "manage-members")).toBe(true);
    expect(can("editor", "create")).toBe(true);
    expect(can("editor", "invite")).toBe(false);
    expect(can("viewer", "read")).toBe(true);
    expect(can("viewer", "update")).toBe(false);
  });
  it("denies missing roles and throws on denied actions", () => {
    expect(can(null, "read")).toBe(false);
    expect(() => assertCan("viewer", "delete")).toThrow("Forbidden");
    expect(() => assertCan("owner", "delete")).not.toThrow();
  });
});
