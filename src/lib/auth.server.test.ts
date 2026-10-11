import { describe, expect, it } from "vitest";
import { assertVenueOperator, isOperatorRole } from "./auth.server";

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const fakeDb = (row: { role: string } | null) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) }) }) as never;

describe("assertVenueOperator", () => {
  it("allows owner and operator", async () => {
    await expect(assertVenueOperator(fakeDb({ role: "owner" }), U, V)).resolves.toBe("owner");
    await expect(assertVenueOperator(fakeDb({ role: "operator" }), U, V)).resolves.toBe("operator");
  });
  it("rejects a user with no link to the venue", async () => {
    await expect(assertVenueOperator(fakeDb(null), U, V)).rejects.toThrow();
  });
  it("rejects an unknown role", async () => {
    await expect(assertVenueOperator(fakeDb({ role: "admin" }), U, V)).rejects.toThrow();
    expect(isOperatorRole("admin")).toBe(false);
  });
  it("rejects invalid ids", async () => {
    await expect(assertVenueOperator(fakeDb({ role: "owner" }), "x", V)).rejects.toThrow();
  });
});
