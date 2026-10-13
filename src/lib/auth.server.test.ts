import { describe, expect, it } from "vitest";
import {
  assertPairedVenueDevice,
  assertChampionshipOperator,
  assertSessionOperator,
  assertVenueOperator,
  isOperatorRole,
} from "./auth.server";

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "44444444-4444-4444-8444-444444444444";
const CHAMPIONSHIP = "55555555-5555-4555-8555-555555555555";
const fakeDb = (row: { role: string } | null) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      }),
    }),
  }) as never;

function fakeScopedDb(session: { venue_id: string | null } | null, role: string | null) {
  return {
    from(table: string) {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: session, error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
            }),
          }),
        }),
      };
    },
  } as never;
}

function fakeChampionshipDb(championshipVenue: string, operatorVenue: string | null) {
  return {
    from(table: string) {
      let id = "";
      let venueId = "";
      let userId = "";
      return {
        select: () => ({
          eq: (key: string, value: string) => {
            if (key === "id") id = value;
            if (key === "venue_id") venueId = value;
            if (key === "user_id") userId = value;
            return {
              eq: (nextKey: string, nextValue: string) => {
                if (nextKey === "venue_id") venueId = nextValue;
                if (nextKey === "user_id") userId = nextValue;
                return {
                  maybeSingle: async () => ({
                    data: table === "championships"
                      ? id === CHAMPIONSHIP ? { venue_id: championshipVenue } : null
                      : operatorVenue === venueId && userId === U ? { role: "operator" } : null,
                    error: null,
                  }),
                };
              },
              maybeSingle: async () => ({
                data: table === "championships"
                  ? id === CHAMPIONSHIP ? { venue_id: championshipVenue } : null
                  : null,
                error: null,
              }),
            };
          },
        }),
      };
    },
  } as never;
}

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

describe("assertChampionshipOperator", () => {
  it("authorizes an operator through the venue stored on the championship", async () => {
    await expect(assertChampionshipOperator(fakeChampionshipDb(V, V), U, CHAMPIONSHIP)).resolves.toBe(V);
  });
  it("rejects a user without venue authorization", async () => {
    await expect(assertChampionshipOperator(fakeChampionshipDb(V, null), U, CHAMPIONSHIP)).rejects.toThrow();
  });
  it("rejects a championship attached to another venue", async () => {
    await expect(assertChampionshipOperator(fakeChampionshipDb(OTHER_VENUE, V), U, CHAMPIONSHIP)).rejects.toThrow();
  });
});

describe("assertSessionOperator", () => {
  it("authorizes only through the venue attached to the stored session", async () => {
    await expect(
      assertSessionOperator(
        fakeScopedDb({ venue_id: V }, "operator"),
        U,
        "33333333-3333-4333-8333-333333333333",
      ),
    ).resolves.toBe("operator");
  });
  it("rejects sessions without a venue and users not assigned to the session venue", async () => {
    const sessionId = "33333333-3333-4333-8333-333333333333";
    await expect(
      assertSessionOperator(fakeScopedDb({ venue_id: null }, "owner"), U, sessionId),
    ).rejects.toThrow();
    await expect(
      assertSessionOperator(fakeScopedDb({ venue_id: V }, null), U, sessionId),
    ).rejects.toThrow();
  });
});

describe("assertPairedVenueDevice", () => {
  it("accepts only a paired device associated with the resolved venue", async () => {
    const token = "a".repeat(64);
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const db = {
      from: (table: string) => {
        let id = "";
        let hash = "";
        return {
          select: () => ({
            eq: (key: string, value: string) => {
              if (key === "id") id = value;
              if (key === "device_token_hash") hash = value;
              return {
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data:
                        table === "venue_devices"
                          ? hash === tokenHash
                            ? { id: "device" }
                            : null
                          : id === sessionId
                            ? { id: sessionId }
                            : null,
                      error: null,
                    }),
                  }),
                  maybeSingle: async () => ({
                    data: id === sessionId ? { id: sessionId } : null,
                    error: null,
                  }),
                }),
              };
            },
          }),
        };
      },
    } as never;
    await expect(assertPairedVenueDevice(db, token, V, sessionId)).resolves.toBeUndefined();
    await expect(assertPairedVenueDevice(db, "b".repeat(64), V, sessionId)).rejects.toThrow();
  });
});
