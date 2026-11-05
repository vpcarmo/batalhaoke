import { describe, expect, it, vi } from "vitest";
import {
  authRedirectUrl,
  isPasswordSetupEvent,
  isPasswordSetupLink,
  updatePassword,
} from "./authRedirect";

describe("auth email redirects", () => {
  it("uses the explicit production app origin regardless of the current host", () => {
    expect(authRedirectUrl({ localOrigin: "https://lovable.dev" })).toBe(
      "https://batalhaoke.lovable.app/login",
    );
  });

  it("preserves local development on loopback hosts", () => {
    expect(authRedirectUrl({ development: true, localOrigin: "http://localhost:3000" })).toBe(
      "http://localhost:3000/login",
    );
    expect(authRedirectUrl({ development: true, localOrigin: "https://attacker.example" })).toBe(
      "https://batalhaoke.lovable.app/login",
    );
  });

  it("preserves the invite query through auth confirmation and recovery redirects", () => {
    const search = "?operator_invite=" + "a".repeat(64);
    expect(authRedirectUrl({ search, localOrigin: "https://lovable.dev" })).toBe(
      `https://batalhaoke.lovable.app/login${search}`,
    );
    expect(
      authRedirectUrl({ search, development: true, localOrigin: "http://localhost:3000" }),
    ).toBe(`http://localhost:3000/login${search}`);
  });

  it("recognizes recovery and invite links and the recovery auth event", () => {
    expect(isPasswordSetupLink("#access_token=secret&type=recovery")).toBe(true);
    expect(isPasswordSetupLink("#type=invite")).toBe(true);
    expect(isPasswordSetupEvent("PASSWORD_RECOVERY")).toBe(true);
    expect(isPasswordSetupEvent("SIGNED_IN")).toBe(false);
    expect(isPasswordSetupLink("#type=signup")).toBe(false);
  });

  it("updates the authenticated user password through Supabase Auth", async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    await updatePassword({ updateUser }, "new-safe-password");
    expect(updateUser).toHaveBeenCalledWith({ password: "new-safe-password" });
  });
});
