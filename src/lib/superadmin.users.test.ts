import { describe, expect, it, vi } from "vitest";
import { createUser, setUserBanned, updateUser, sendPasswordRecovery } from "./superadmin.server";

const id = "11111111-1111-4111-8111-111111111111";
const authUser = {
  id,
  email: "person@example.com",
  created_at: "2026-01-01",
  user_metadata: {},
  app_metadata: { platform_role: "superadmin" },
};

describe("superadmin user operations", () => {
  it("invites without a password and never writes a platform role", async () => {
    const inviteUserByEmail = vi.fn(async () => ({ data: { user: authUser }, error: null }));
    const admin = { auth: { admin: { inviteUserByEmail } } };
    await createUser(
      admin,
      { name: "Person", email: "PERSON@example.com" },
      "https://example.com/login",
    );
    expect(inviteUserByEmail).toHaveBeenCalledWith("person@example.com", {
      data: { full_name: "Person" },
      redirectTo: "https://example.com/login",
    });
    expect(JSON.stringify(inviteUserByEmail.mock.calls)).not.toContain("platform_role");
  });

  it("updates name and email without accepting privileged metadata", async () => {
    const updateUserById = vi.fn(async (_id, payload) => ({
      data: { user: { ...authUser, email: payload.email } },
      error: null,
    }));
    await updateUser(
      { auth: { admin: { updateUserById } } },
      { id, name: "New Name", email: "new@example.com" },
    );
    expect(updateUserById).toHaveBeenCalledWith(id, {
      email: "new@example.com",
      user_metadata: { full_name: "New Name" },
    });
    expect(JSON.stringify(updateUserById.mock.calls)).not.toContain("platform_role");
  });

  it("refuses self lock and uses Auth ban durations for lock and unlock", async () => {
    const updateUserById = vi.fn(async () => ({ data: { user: authUser }, error: null }));
    const admin = {
      auth: { admin: { updateUserById } },
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {};
        chain.select = chain.eq = () => chain;
        chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        return chain;
      },
    };
    await expect(setUserBanned(admin, id, id, true)).rejects.toThrow(/bloquear/);
    expect(updateUserById).not.toHaveBeenCalled();
    await setUserBanned(admin, "22222222-2222-4222-8222-222222222222", id, true);
    await setUserBanned(admin, "22222222-2222-4222-8222-222222222222", id, false);
    expect(updateUserById).toHaveBeenNthCalledWith(1, id, { ban_duration: "876000h" });
    expect(updateUserById).toHaveBeenNthCalledWith(2, id, { ban_duration: "none" });
  });

  it("sends password recovery through Supabase Auth", async () => {
    const resetPasswordForEmail = vi.fn(async () => ({ error: null }));
    await sendPasswordRecovery(
      { auth: { resetPasswordForEmail } },
      " PERSON@example.com ",
      "https://example.com/login",
    );
    expect(resetPasswordForEmail).toHaveBeenCalledWith("person@example.com", {
      redirectTo: "https://example.com/login",
    });
  });

  it("protects the last account owner before banning", async () => {
    const updateUserById = vi.fn();
    const from = (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      chain.select = chain.eq = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data: table === "account_members" ? [{ account_id: "account-1" }] : [],
          error: null,
        });
      return chain;
    };
    const admin = { auth: { admin: { updateUserById } }, from };
    await expect(
      setUserBanned(admin, "22222222-2222-4222-8222-222222222222", id, true),
    ).rejects.toThrow(/propriet/);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("rejects invalid user data before calling Auth", async () => {
    const inviteUserByEmail = vi.fn();
    await expect(
      createUser({ auth: { admin: { inviteUserByEmail } } }, { name: " ", email: "bad" }, "/login"),
    ).rejects.toThrow();
    expect(inviteUserByEmail).not.toHaveBeenCalled();
  });
});
