import { describe, expect, it, vi } from "vitest";
import { assertPlatformAdmin, AuthorizationError } from "./auth.server";
import { createVenueWithOwner, findUserByEmail, linkOperator, toClientError } from "./superadmin.server";

const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const authWith = (user: unknown, error: unknown = null) => ({
  auth: { admin: { getUserById: vi.fn(async () => ({ data: { user }, error })) } },
});

describe("assertPlatformAdmin", () => {
  it("1/14 denies missing identity", async () => {
    await expect(assertPlatformAdmin(authWith({}), undefined)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("2 denies user without app_metadata", async () => {
    await expect(assertPlatformAdmin(authWith({}), U)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("3 denies user_metadata-only superadmin", async () => {
    await expect(
      assertPlatformAdmin(authWith({ app_metadata: {}, user_metadata: { platform_role: "superadmin" } }), U),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("4/5 denies venue owner/operator without global role", async () => {
    for (const r of ["owner", "operator"])
      await expect(assertPlatformAdmin(authWith({ app_metadata: { role: r } }), U)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("6 denies other platform_role values", async () => {
    await expect(assertPlatformAdmin(authWith({ app_metadata: { platform_role: "admin" } }), U)).rejects.toThrow();
  });
  it("7 allows confirmed superadmin", async () => {
    await expect(assertPlatformAdmin(authWith({ app_metadata: { platform_role: "superadmin" } }), U)).resolves.toBeUndefined();
  });
  it("8 denies on auth server error or throw", async () => {
    await expect(assertPlatformAdmin(authWith(null, new Error("x")), U)).rejects.toThrow();
    const t = { auth: { admin: { getUserById: async () => { throw new Error("net"); } } } };
    await expect(assertPlatformAdmin(t as never, U)).rejects.toBeInstanceOf(AuthorizationError);
  });
  it("9 revocation applies on next request (live lookup each call)", async () => {
    let role: string | undefined = "superadmin";
    const a = { auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { app_metadata: { platform_role: role } } }, error: null })) } } };
    await assertPlatformAdmin(a, U);
    role = undefined;
    await expect(assertPlatformAdmin(a, U)).rejects.toThrow();
    expect(a.auth.admin.getUserById).toHaveBeenCalledTimes(2);
  });
  it("denial message is generic", () => {
    expect(toClientError(new AuthorizationError("internal detail")).message).not.toContain("internal");
  });
});

type Users = { id: string; email: string; email_confirmed_at: string | null }[];
function fakeAdmin(opts: { users: Users; existingLink?: boolean; venueInsertErrors?: unknown[]; linkError?: unknown }) {
  const venueErrors = [...(opts.venueInsertErrors ?? [])];
  const inserts: { table: string; row: unknown }[] = [];
  const updates: unknown[] = [];
  const admin = {
    inserts, updates,
    auth: { admin: { listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => ({
      data: { users: opts.users.slice((page - 1) * perPage, page * perPage) }, error: null })) } },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, order: self,
        update: (r: unknown) => { updates.push(r); return chain; },
        maybeSingle: async () => ({
          data: table === "venues" ? { id: V } : opts.existingLink ? { id: "l" } : null, error: null }),
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return { select: () => ({ single: async () => {
            if (table === "venues") {
              const err = venueErrors.shift();
              return err ? { data: null, error: err } : { data: { id: V, slug: (row as { slug: string }).slug }, error: null };
            }
            return opts.linkError ? { data: null, error: opts.linkError } : { data: { id: "link1" }, error: null };
          } }) };
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
    const many: Users = Array.from({ length: 450 }, (_, i) => ({ id: `id${i}`, email: `u${i}@x.com`, email_confirmed_at: "d" }));
    const a = fakeAdmin({ users: many });
    expect((await findUserByEmail(a, " U420@X.com "))?.id).toBe("id420");
  });
  it("10 refuses missing or unconfirmed email", async () => {
    await expect(linkOperator(fakeAdmin({ users: [] }), V, "no@x.com", "operator")).rejects.toThrow(/não encontrada/);
    const un = fakeAdmin({ users: [{ id: U, email: "a@x.com", email_confirmed_at: null }] });
    await expect(linkOperator(un, V, "a@x.com", "operator")).rejects.toThrow(/confirmou/);
    expect(un.inserts).toHaveLength(0);
  });
  it("11 slug collision retried with new slug, single venue created", async () => {
    const a = fakeAdmin({ users: confirmed, venueInsertErrors: [{ code: "23505" }] });
    const r = await createVenueWithOwner(a, "Bar do Zé", "dono@bar.com");
    expect(r.status).toBe("linked");
    const venueInserts = a.inserts.filter((i) => i.table === "venues");
    expect(venueInserts).toHaveLength(2);
    expect((venueInserts[0].row as { slug: string }).slug).not.toBe((venueInserts[1].row as { slug: string }).slug);
    expect((venueInserts[1].row as { slug: string }).slug).toMatch(/^v-bar-do-ze-[0-9a-f]{8}$/);
  });
  it("uncertain venue insert is not retried", async () => {
    const a = fakeAdmin({ users: confirmed, venueInsertErrors: [{ code: "500" }] });
    await expect(createVenueWithOwner(a, "Bar", "dono@bar.com")).rejects.toThrow(/incerto/);
    expect(a.inserts).toHaveLength(1);
  });
  it("12 duplicate link refused without modifying existing", async () => {
    const a = fakeAdmin({ users: confirmed, existingLink: true });
    await expect(linkOperator(a, V, "dono@bar.com", "owner")).rejects.toThrow(/já está vinculada/);
    expect(a.inserts).toHaveLength(0);
    expect(a.updates).toHaveLength(0);
  });
  it("13 partial failure keeps venue and reports pending", async () => {
    const a = fakeAdmin({ users: confirmed, linkError: { code: "500" } });
    const r = await createVenueWithOwner(a, "Bar", "dono@bar.com");
    expect(r).toMatchObject({ status: "link_pending", venueId: V });
  });
  it("rejects invalid role", async () => {
    await expect(linkOperator(fakeAdmin({ users: confirmed }), V, "dono@bar.com", "superadmin")).rejects.toThrow(/Papel/);
  });
});
