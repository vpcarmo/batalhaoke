/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase query builders are dynamically composed. */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const Id = z.string().uuid();
const Email = z.string().trim().email().max(254);
const PUBLIC_FIELDS =
  "id, venue_id, email_normalized, role, status, invited_by, accepted_by, created_at, expires_at, sent_at, accepted_at, cancelled_at";
const DAY_MS = 7 * 24 * 60 * 60 * 1000;
// The database grants a 15-minute lease, longer than the Auth email request timeout.

type Db = any;
type InviteDeps = {
  db: Db;
  auth: {
    assertVenueOperator(db: Db, userId: string, venueId: string): Promise<string>;
  };
  admin: any;
  sendLink(email: string, redirectTo: string): Promise<void>;
  now(): Date;
  randomToken(): string;
  hashToken(token: string): Promise<string>;
};

export class OperatorInviteError extends Error {
  override name = "OperatorInviteError";
}
function fail(message: string): never {
  throw new OperatorInviteError(message);
}

export async function createInvite(
  deps: InviteDeps,
  userId: string,
  raw: { venueId: string; email: string },
) {
  const venueId = Id.parse(raw.venueId);
  const email = Email.parse(raw.email).toLowerCase();
  if ((await deps.auth.assertVenueOperator(deps.db, userId, venueId)) !== "owner")
    fail("Somente o proprietário pode convidar operadores.");
  const token = deps.randomToken();
  const tokenHash = await deps.hashToken(token);
  const expiresAt = new Date(deps.now().getTime() + DAY_MS).toISOString();
  const expired = await deps.db
    .from("venue_operator_invites")
    .update({ status: "expired" })
    .eq("venue_id", venueId)
    .eq("email_normalized", email)
    .eq("status", "pending")
    .lte("expires_at", deps.now().toISOString());
  if (expired.error) fail("NÃ£o foi possível atualizar o convite expirado.");
  const { data, error } = await deps.db
    .from("venue_operator_invites")
    .insert({
      venue_id: venueId,
      email_normalized: email,
      role: "operator",
      token_hash: tokenHash,
      status: "pending",
      invited_by: userId,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data)
    fail("Já existe um convite pendente para este e-mail ou não foi possível criar o convite.");
  const claimId = crypto.randomUUID();
  const claimed = await deps.admin.rpc("claim_venue_operator_invite_resend", {
    p_invite_id: data.id,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
    p_claim_id: claimId,
  });
  if (claimed.error || claimed.data !== claimId)
    fail("Nao foi possivel preparar o envio do convite.");
  try {
    await deps.sendLink(email, inviteRedirect(token));
  } catch {
    const marked = await finishDelivery(deps, data.id, tokenHash, claimId, false);
    if (marked.error || marked.data !== true)
      fail("O envio falhou e o estado ficou inconsistente; reconcilie o convite.");
    fail("O envio falhou. O convite continua pendente para nova tentativa.");
  }
  const marked = await finishDelivery(deps, data.id, tokenHash, claimId, true);
  if (marked.error || marked.data !== true)
    fail(
      "O link foi enviado, mas nao foi possivel registrar o envio; reconcilie antes de reenviar.",
    );
  return { id: data.id };
}

export async function listInvites(deps: InviteDeps, userId: string, venueId: string) {
  venueId = Id.parse(venueId);
  if ((await deps.auth.assertVenueOperator(deps.db, userId, venueId)) !== "owner")
    fail("Somente o proprietário pode consultar convites.");
  const expired = await deps.db
    .from("venue_operator_invites")
    .update({ status: "expired" })
    .eq("venue_id", venueId)
    .eq("status", "pending")
    .lte("expires_at", deps.now().toISOString());
  if (expired.error) fail("Nao foi possivel atualizar os convites expirados.");
  const { data, error } = await deps.db
    .from("venue_operator_invites")
    .select(PUBLIC_FIELDS)
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false });
  if (error) fail("Não foi possível consultar os convites.");
  return data ?? [];
}

export async function cancelInvite(deps: InviteDeps, userId: string, inviteId: string) {
  inviteId = Id.parse(inviteId);
  const { data: invite, error: readError } = await deps.db
    .from("venue_operator_invites")
    .select("venue_id")
    .eq("id", inviteId)
    .maybeSingle();
  if (readError || !invite) fail("Convite não encontrado.");
  if ((await deps.auth.assertVenueOperator(deps.db, userId, invite.venue_id)) !== "owner")
    fail("Somente o proprietário pode cancelar convites.");
  const { data, error } = await deps.db
    .from("venue_operator_invites")
    .update({ status: "cancelled", cancelled_at: deps.now().toISOString() })
    .eq("id", inviteId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error || !data) fail("O convite não está mais pendente.");
}

export async function resendInvite(deps: InviteDeps, userId: string, inviteId: string) {
  inviteId = Id.parse(inviteId);
  const { data: invite, error } = await deps.db
    .from("venue_operator_invites")
    .select("venue_id, email_normalized, status")
    .eq("id", inviteId)
    .maybeSingle();
  if (error || !invite) fail("Convite não encontrado.");
  if ((await deps.auth.assertVenueOperator(deps.db, userId, invite.venue_id)) !== "owner")
    fail("Somente o proprietário pode reenviar convites.");
  if (invite.status !== "pending") fail("O convite não está mais pendente.");
  const token = deps.randomToken();
  const expiresAt = new Date(deps.now().getTime() + DAY_MS).toISOString();
  const tokenHash = await deps.hashToken(token);
  const claimId = crypto.randomUUID();
  const { data: updated, error: updateError } = await deps.admin.rpc(
    "claim_venue_operator_invite_resend",
    {
      p_invite_id: inviteId,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_claim_id: claimId,
    },
  );
  if (updateError || updated !== claimId)
    fail("O convite esta sendo enviado ou nao esta mais pendente.");
  try {
    await deps.sendLink(invite.email_normalized, inviteRedirect(token));
  } catch {
    const marked = await finishDelivery(deps, inviteId, tokenHash, claimId, false);
    if (marked.error || marked.data !== true)
      fail("O reenvio falhou e o estado ficou inconsistente; reconcilie o convite.");
    fail("O envio falhou. O token anterior foi invalidado e o convite pode ser reenviado.");
  }
  const marked = await finishDelivery(deps, inviteId, tokenHash, claimId, true);
  if (marked.error || marked.data !== true)
    fail(
      "O link foi enviado, mas nao foi possivel registrar o envio; reconcilie antes de reenviar.",
    );
}

function finishDelivery(
  deps: InviteDeps,
  inviteId: string,
  tokenHash: string,
  claimId: string,
  sent: boolean,
) {
  return deps.admin.rpc("finish_venue_operator_invite_delivery", {
    p_invite_id: inviteId,
    p_token_hash: tokenHash,
    p_claim_id: claimId,
    p_sent: sent,
  });
}
export async function acceptInvite(deps: InviteDeps, userId: string, token: string) {
  Id.parse(userId);
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) fail("Convite inválido ou expirado.");
  const { data, error } = await deps.admin.auth.admin.getUserById(userId);
  const user = data?.user;
  if (error || !user || !user.email || !user.email_confirmed_at)
    fail("Confirme o e-mail da sua conta antes de aceitar o convite.");
  const result = await deps.admin.rpc("accept_venue_operator_invite", {
    p_token_hash: await deps.hashToken(token),
    p_user_id: userId,
    p_email_normalized: Email.parse(user.email).toLowerCase(),
  });
  if (result.error?.message?.includes("invite email mismatch"))
    fail("Este convite foi enviado para outro e-mail.");
  if (result.error || !result.data?.[0])
    fail("Convite inválido, expirado, cancelado ou já aceito.");
  return { venueId: result.data[0].venue_id, role: "operator" as const };
}

function inviteRedirect(token: string) {
  const base = process.env["APP_ORIGIN"] || "https://batalhaoke.lovable.app";
  const url = new URL("/login", base);
  url.searchParams.set("operator_invite", token);
  return url.toString();
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDefaultInviteDeps(
  db: Db,
  auth: InviteDeps["auth"],
  admin: InviteDeps["admin"],
): InviteDeps {
  return {
    db,
    auth,
    admin,
    now: () => new Date(),
    randomToken,
    hashToken,
    sendLink: async (email, redirectTo) => {
      const url = process.env["SUPABASE_URL"];
      const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
      if (!url || !key) throw new Error("Supabase Auth is not configured");
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },
  };
}
