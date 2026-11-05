import { describe, expect, it, vi } from "vitest";
import { assertPlatformAdmin, AuthorizationError } from "./auth.server";
import {
  createVenueWithOwner,
  findUserByEmail,
  linkOperator,
  requirePlatformAdmin,
  toClientError,
} from "./superadmin.server";

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const authWith = (user: unknown, error: unknown = null) => ({
  auth: { admin: { getUserById: vi.fn(async () => ({ data: { user }, error })) } },
});

describe("assertPlatformAdmin", () => {
  it("1/14 denies missing identity", async () => {
    await expect(assertPlatformAdmin(authWith({}), undefined)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
  it("2 denies user without app_metadata", async () => {
    await expect(assertPlatformAdmin(authWith({}), U)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("3 denies user_metadata-only superadmin", async () => {
    await expect(
      assertPlatformAdmin(
        authWith({ app_metadata: {}, user_metadata: { platform_role: "superadmin" } }),
        U,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("4/5 denies venue owner/operator without global role", async () => {
    for (const r of ["owner", "operator"])
      await expect(
        assertPlatformAdmin(authWith({ app_metadata: { role: r } }), U),
      ).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("6 denies other platform_role values", async () => {
    await expect(
      assertPlatformAdmin(authWith({ app_metadata: { platform_role: "admin" } }), U),
    ).rejects.toThrow();
  });
  it("7 allows confirmed superadmin", async () => {
    await expect(
      assertPlatformAdmin(authWith({ app_metadata: { platform_role: "superadmin" } }), U),
    ).resolves.toBeUndefined();
  });
  it("8 denies on auth server error or throw", async () => {
    await expect(assertPlatformAdmin(authWith(null, new Error("x")), U)).rejects.toThrow();
    const t = {
      auth: {
        admin: {
          getUserById: async () => {
            throw new Error("net");
          },
        },
      },
    };
    await expect(assertPlatformAdmin(t as never, U)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("9 revocation applies on next request (live lookup each call)", async () => {
    let role: string | undefined = "superadmin";
    const a = {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: { user: { app_metadata: { platform_role: role } } },
            error: null,
          })),
        },
      },
    };
    await assertPlatformAdmin(a, U);
    role = undefined;
    await expect(assertPlatformAdmin(a, U)).rejects.toThrow();
    expect(a.auth.admin.getUserById).toHaveBeenCalledTimes(2);
  });
  it("denial message is generic", () => {
    expect(toClientError(new AuthorizationError("internal detail")).message).not.toContain(
      "internal",
    );
  });
});

type Users = { id: string; email: string; email_confirmed_at: string | null }[];
function fakeAdmin(opts: {
  users: Users;
  rpcResults?: { data?: unknown; error?: unknown }[];
  existingLink?: boolean;
}) {
  const inserts: { table: string; row: unknown }[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const rpcResults = [...(opts.rpcResults ?? [{ data: [{ account_id: A, venue_id: V, slug: "__sent_slug__" }], error: null }])];
  const admin = {
    inserts,
    rpcCalls,
    auth: {
      admin: {
        listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => ({
          data: { users: opts.users.slice((page - 1) * perPage, page * perPage) }, error: null,
        })),
      },
    },
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      const result = rpcResults.shift() ?? { data: null, error: null };
      if (
        Array.isArray(result.data) &&
        result.data.length === 1 &&
        result.data[0]?.slug === "__sent_slug__"
      ) {
        return { ...result, data: [{ ...result.data[0], slug: (args as { p_slug: string }).p_slug }] };
      }
      return result;
    }),
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self,
        maybeSingle: async () => ({ data: table === "venues" ? { id: V } : opts.existingLink ? { id: "l" } : null, error: null }),
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return { select: () => ({ single: async () => ({ data: { id: "link1" }, error: null }) }) };
        },
      });
      return chain;
    },
  };
  return admin;
}
const confirmed = [{ id: U, email: "dono@bar.com", email_confirmed_at: "2026-01-01" }];

describe("superadmin domain", () => {
  it("paginates beyond the first page", async () => {
    const many: Users = Array.from({ length: 450 }, (_, i) => ({
      id: `id${i}`,
      email: `u${i}@x.com`,
      email_confirmed_at: "d",
    }));
    const a = fakeAdmin({ users: many });
    expect((await findUserByEmail(a, " U420@X.com "))?.id).toBe("id420");
  });
  it("10 refuses missing or unconfirmed email", async () => {
    await expect(linkOperator(fakeAdmin({ users: [] }), V, "no@x.com", "operator")).rejects.toThrow(
      /não encontrada/,
    );
    const un = fakeAdmin({ users: [{ id: U, email: "a@x.com", email_confirmed_at: null }] });
    await expect(linkOperator(un, V, "a@x.com", "operator")).rejects.toThrow(/confirmou/);
    expect(un.inserts).toHaveLength(0);
  });
  it("blocks venue creation for users without SuperAdmin access", async () => {
    const a = fakeAdmin({ users: confirmed });
    await expect(requirePlatformAdmin(authWith({ app_metadata: {} }), U)).rejects.toBeInstanceOf(AuthorizationError);
    expect(a.rpcCalls).toHaveLength(0);
  });
  it("creates account, venue, and owner links through the atomic RPC", async () => {
    const a = fakeAdmin({ users: confirmed });
    const r = await createVenueWithOwner(a, "Bar do Zé", "dono@bar.com");
    expect(r).toMatchObject({ status: "created", accountId: A, venueId: V, ownerUserId: U });
    expect(a.rpcCalls).toHaveLength(1);
    expect(a.rpcCalls[0]?.name).toBe("create_individual_venue_with_owner");
    expect(a.rpcCalls[0]?.args).toMatchObject({ p_name: "Bar do Zé", p_owner_user_id: U });
    expect(a.rpcCalls[0]?.args).toMatchObject({ p_slug: /^v-bar-do-ze-[0-9a-f]{8}$/ });
    expect(a.inserts).toHaveLength(0);
  });
  it("retries only a confirmed slug constraint collision", async () => {
    const a = fakeAdmin({ users: confirmed, rpcResults: [
      { data: null, error: { code: "23505", constraint: "venues_slug_key" } },
      { data: [{ account_id: A, venue_id: V, slug: "__sent_slug__" }], error: null },
    ] });
    expect((await createVenueWithOwner(a, "Bar", "dono@bar.com")).status).toBe("created");
    expect(a.rpcCalls).toHaveLength(2);
    expect((a.rpcCalls[0]?.args as { p_slug: string }).p_slug).not.toBe((a.rpcCalls[1]?.args as { p_slug: string }).p_slug);
  });
  it("does not retry an ambiguous RPC error or malformed success", async () => {
    for (const result of [{ data: null, error: { code: "500" } }, { data: [], error: null }]) {
      const a = fakeAdmin({ users: confirmed, rpcResults: [result] });
      await expect(createVenueWithOwner(a, "Bar", "dono@bar.com")).rejects.toThrow(/incerto/);
      expect(a.rpcCalls).toHaveLength(1);
    }
  });
  it("accepts only one complete RPC table row matching the requested slug", async () => {
    const invalidResults = [
      [],
      [{ account_id: A, venue_id: V, slug: "__sent_slug__" }, { account_id: A, venue_id: V, slug: "__sent_slug__" }],
      { account_id: A, venue_id: V, slug: "__sent_slug__" },
      [{ account_id: "bad", venue_id: V, slug: "__sent_slug__" }],
      [{ account_id: A, venue_id: "bad", slug: "__sent_slug__" }],
      [{ account_id: A, venue_id: V }],
      [{ account_id: A, venue_id: V, slug: "" }],
      [{ account_id: A, venue_id: V, slug: "different-slug" }],
    ];
    for (const data of invalidResults) {
      const a = fakeAdmin({ users: confirmed, rpcResults: [{ data, error: null }] });
      await expect(createVenueWithOwner(a, "Bar", "dono@bar.com")).rejects.toThrow(/incerto/);
      expect(a.rpcCalls).toHaveLength(1);
    }
    const a = fakeAdmin({ users: confirmed });
    const result = await createVenueWithOwner(a, "Bar", "dono@bar.com");
    expect(result.slug).toBe((a.rpcCalls[0]?.args as { p_slug: string }).p_slug);
  });
  it("recognizes only 23505 errors explicitly naming venues_slug_key", async () => {
    for (const error of [
      { code: "23505", message: "duplicate key venues_slug_key" },
      { code: "23505", details: "constraint venues_slug_key violated" },
    ]) {
      const a = fakeAdmin({ users: confirmed, rpcResults: [
        { data: null, error },
        { data: [{ account_id: A, venue_id: V, slug: "__sent_slug__" }], error: null },
      ] });
      await expect(createVenueWithOwner(a, "Bar", "dono@bar.com")).resolves.toMatchObject({ status: "created" });
      expect(a.rpcCalls).toHaveLength(2);
    }
    for (const error of [
      { code: "23505", message: "duplicate key other_constraint" },
      { code: "500", message: "venues_slug_key" },
      { code: "ETIMEDOUT", message: "timeout" },
      { message: "ambiguous network error" },
    ]) {
      const a = fakeAdmin({ users: confirmed, rpcResults: [{ data: null, error }] });
      await expect(createVenueWithOwner(a, "Bar", "dono@bar.com")).rejects.toThrow(/incerto/);
      expect(a.rpcCalls).toHaveLength(1);
    }
  });
  it("rejects missing or unconfirmed owners before RPC", async () => {
    const missing = fakeAdmin({ users: [] });
    await expect(createVenueWithOwner(missing, "Bar", "no@x.com")).rejects.toThrow(/não encontrada/);
    expect(missing.rpcCalls).toHaveLength(0);
    const unconfirmed = fakeAdmin({ users: [{ id: U, email: "a@x.com", email_confirmed_at: null }] });
    await expect(createVenueWithOwner(unconfirmed, "Bar", "a@x.com")).rejects.toThrow(/confirmou/);
    expect(unconfirmed.rpcCalls).toHaveLength(0);
  });
  it("12 duplicate link refused without modifying existing", async () => {
    const a = fakeAdmin({ users: confirmed, existingLink: true });
    await expect(linkOperator(a, V, "dono@bar.com", "owner")).rejects.toThrow(/já está vinculada/);
    expect(a.inserts).toHaveLength(0);
  });
  it("rejects invalid role", async () => {
    await expect(
      linkOperator(fakeAdmin({ users: confirmed }), V, "dono@bar.com", "superadmin"),
    ).rejects.toThrow(/Papel/);
  });
});
