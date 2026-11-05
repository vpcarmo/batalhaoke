/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase fluent query mock shapes are dynamic. */
import { describe, expect, it, vi } from "vitest";
import {
  acceptInvite,
  createInvite,
  resendInvite,
  OperatorInviteError,
} from "./operator-invites.server";

const USER = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(64);
const hash = async (value: string) => `hash:${value}`;

function deps(role = "owner", confirmedAt: string | null = "2026-01-01T00:00:00Z") {
  const insert = vi.fn(async (row: any) => ({ data: { id: "invite-id", ...row }, error: null }));
  const update = vi.fn(() => {
    const query: any = {
      eq: () => query,
      lte: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: { id: "invite-id" }, error: null }),
      then: (resolve: (v: any) => unknown) => resolve({ error: null }),
    };
    return query;
  });
  const from = vi.fn(() => ({
    insert: (row: any) => ({ select: () => ({ single: () => insert(row) }) }),
    update,
    delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
  }));
  const rpc = vi.fn(async (name: string, args: any) =>
    name === "accept_venue_operator_invite"
      ? { data: [{ venue_id: VENUE, role: "operator", ...args }], error: null }
      : name === "claim_venue_operator_invite_resend"
        ? { data: args.p_claim_id, error: null }
        : { data: true, error: null },
  );
  const sendLink = vi.fn(async () => {});
  const service = {
    db: { from },
    auth: { assertVenueOperator: vi.fn(async () => role) },
    admin: {
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: {
              user: { id: USER, email: "  Test@Example.com ", email_confirmed_at: confirmedAt },
            },
            error: null,
          })),
        },
      },
      rpc,
    },
    sendLink,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    randomToken: () => TOKEN,
    hashToken: hash,
  };
  return { service, insert, update, from, rpc, sendLink };
}

describe("venue operator invites", () => {
  it("permits an owner, normalizes email, and uses the same Auth OTP for existing and new accounts", async () => {
    for (const email of ["Existing@Example.com", "new@Example.com"]) {
      const d = deps();
      await expect(createInvite(d.service, USER, { venueId: VENUE, email })).resolves.toEqual({
        id: "invite-id",
      });
      expect(d.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          email_normalized: email.toLowerCase(),
          role: "operator",
          token_hash: `hash:${TOKEN}`,
        }),
      );
      expect(d.update).toHaveBeenCalledWith({ status: "expired" });
      expect(d.sendLink).toHaveBeenCalledOnce();
    }
  });
  it("denies operators and account administrators without an owner venue link", async () => {
    for (const role of ["operator", null]) {
      const d = deps(role as string);
      await expect(
        createInvite(d.service, USER, { venueId: VENUE, email: "a@example.com" }),
      ).rejects.toBeInstanceOf(OperatorInviteError);
      expect(d.sendLink).not.toHaveBeenCalled();
    }
  });
  it("never sends success when Auth rejects the email", async () => {
    const d = deps();
    d.sendLink.mockRejectedValueOnce(new Error("Auth failure"));
    await expect(
      createInvite(d.service, USER, { venueId: VENUE, email: "a@example.com" }),
    ).rejects.toThrow(/falhou/);
    expect(d.rpc).toHaveBeenCalledWith(
      "finish_venue_operator_invite_delivery",
      expect.objectContaining({ p_sent: false }),
    );
  });
  it("accepts only a currently confirmed Auth identity and sends normalized identity to atomic RPC", async () => {
    const d = deps();
    await expect(acceptInvite(d.service, USER, TOKEN)).resolves.toEqual({
      venueId: VENUE,
      role: "operator",
    });
    expect(d.rpc).toHaveBeenCalledWith("accept_venue_operator_invite", {
      p_token_hash: `hash:${TOKEN}`,
      p_user_id: USER,
      p_email_normalized: "test@example.com",
    });
  });
  it("rejects unconfirmed users before consuming a token", async () => {
    const d = deps("owner", null);
    await expect(acceptInvite(d.service, USER, TOKEN)).rejects.toThrow(/Confirme/);
    expect(d.rpc).not.toHaveBeenCalled();
  });
  it.each(["invalid", "expired", "cancelled", "reused", "different-email"])(
    "rejects %s at the transactional RPC boundary",
    async () => {
      const d = deps();
      d.rpc.mockResolvedValueOnce({ data: null, error: new Error("denied") } as never);
      await expect(acceptInvite(d.service, USER, TOKEN)).rejects.toThrow(/Convite inválido/);
    },
  );
  it("keeps the venue scope supplied by the invite RPC, never a caller venue/account", async () => {
    const d = deps();
    await acceptInvite(d.service, USER, TOKEN);
    expect(d.rpc.mock.calls[0]?.[1]).not.toHaveProperty("venue_id");
  });
  it("keeps a failed invitation pending for retry and never reports delivery success if sent state persistence fails", async () => {
    const d = deps();
    d.rpc.mockImplementation(async (name: string, args: any) =>
      name === "finish_venue_operator_invite_delivery"
        ? ({ data: null, error: new Error("database unavailable") } as never)
        : name === "claim_venue_operator_invite_resend"
          ? { data: args.p_claim_id, error: null }
          : { data: true, error: null },
    );
    await expect(
      createInvite(d.service, USER, { venueId: VENUE, email: "a@example.com" }),
    ).rejects.toThrow(/registrar o envio/);
  });
  it("serializes resend through the database claim and rotates the token before delivery", async () => {
    const d = deps();
    const read = { venue_id: VENUE, email_normalized: "a@example.com", status: "pending" };
    d.from.mockImplementation(
      () =>
        ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: read, error: null }) }),
          }),
        }) as never,
    );
    await resendInvite(d.service, USER, "33333333-3333-4333-8333-333333333333");
    expect(d.rpc).toHaveBeenCalledWith(
      "claim_venue_operator_invite_resend",
      expect.objectContaining({ p_token_hash: `hash:${TOKEN}` }),
    );
    expect(d.sendLink).toHaveBeenCalledOnce();
    d.rpc.mockImplementationOnce(async () => ({ data: null, error: null }));
    await expect(
      resendInvite(d.service, USER, "33333333-3333-4333-8333-333333333333"),
    ).rejects.toThrow(/sendo/);
  });
  it("uses the same unique claim id for fencing the delivery result", async () => {
    const d = deps();
    d.from.mockImplementation(
      () =>
        ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { venue_id: VENUE, email_normalized: "a@example.com", status: "pending" },
                error: null,
              }),
            }),
          }),
        }) as never,
    );
    await resendInvite(d.service, USER, "33333333-3333-4333-8333-333333333333");
    const claim = d.rpc.mock.calls.find(
      ([name]) => name === "claim_venue_operator_invite_resend",
    )?.[1];
    const finish = d.rpc.mock.calls.find(
      ([name]) => name === "finish_venue_operator_invite_delivery",
    )?.[1];
    expect(claim?.p_claim_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(finish?.p_claim_id).toBe(claim?.p_claim_id);
  });
  it("does not report success when a cancelled or expired invite rejects completion", async () => {
    const d = deps();
    d.from.mockImplementation(
      () =>
        ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { venue_id: VENUE, email_normalized: "a@example.com", status: "pending" },
                error: null,
              }),
            }),
          }),
        }) as never,
    );
    d.rpc.mockImplementation(async (name: string, args: any) =>
      name === "claim_venue_operator_invite_resend"
        ? { data: args.p_claim_id, error: null }
        : { data: false, error: null },
    );
    await expect(
      resendInvite(d.service, USER, "33333333-3333-4333-8333-333333333333"),
    ).rejects.toThrow(/registrar o envio/);
  });
  it("leaves an unpersisted failed provider result unconfirmed", async () => {
    const d = deps();
    d.sendLink.mockRejectedValueOnce(new Error("provider failure"));
    d.rpc.mockImplementation(async (name: string, args: any) =>
      name === "claim_venue_operator_invite_resend"
        ? { data: args.p_claim_id, error: null }
        : ({ data: null, error: new Error("database unavailable") } as never),
    );
    await expect(
      createInvite(d.service, USER, { venueId: VENUE, email: "a@example.com" }),
    ).rejects.toThrow(/estado ficou inconsistente/);
  });
});
