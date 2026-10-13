import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export const OPERATOR_ROLES = ["owner", "operator"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export class AuthorizationError extends Error {}

const DENIED = "Você não tem permissão para administrar este estabelecimento.";

export function isOperatorRole(role: unknown): role is OperatorRole {
  return typeof role === "string" && (OPERATOR_ROLES as readonly string[]).includes(role);
}

/**
 * Authoritative scope check: venue_operators is the only source of admin permissions.
 * Queried on every call, so revoking the row removes access on the next request.
 */
export async function assertVenueOperator(
  db: Db,
  userId: unknown,
  venueId: unknown,
): Promise<OperatorRole> {
  const ids = z
    .object({ userId: z.string().uuid(), venueId: z.string().uuid() })
    .safeParse({ userId, venueId });
  if (!ids.success) throw new AuthorizationError(DENIED);
  const { data, error } = await db
    .from("venue_operators")
    .select("role")
    .eq("user_id", ids.data.userId)
    .eq("venue_id", ids.data.venueId)
    .maybeSingle();
  if (error) throw new AuthorizationError("Não foi possível verificar suas permissões.");
  if (!data || !isOperatorRole(data.role)) throw new AuthorizationError(DENIED);
  return data.role;
}

export async function assertSessionOperator(
  db: Db,
  userId: unknown,
  sessionId: unknown,
): Promise<OperatorRole> {
  const id = z.string().uuid().safeParse(sessionId);
  if (!id.success) throw new AuthorizationError(DENIED);
  const { data, error } = await db
    .from("sessions")
    .select("venue_id")
    .eq("id", id.data)
    .maybeSingle();
  if (error)
    throw new AuthorizationError("Não foi possível verificar o estabelecimento da sessão.");
  if (!data?.venue_id) throw new AuthorizationError(DENIED);
  return assertVenueOperator(db, userId, data.venue_id);
}

export async function assertChampionshipOperator(
  db: Db,
  userId: unknown,
  championshipId: unknown,
): Promise<string> {
  const id = z.string().uuid().safeParse(championshipId);
  if (!id.success) throw new AuthorizationError(DENIED);
  const { data, error } = await db
    .from("championships")
    .select("venue_id")
    .eq("id", id.data)
    .maybeSingle();
  if (error) throw new AuthorizationError("Não foi possível verificar o estabelecimento do Campeonato.");
  if (!data?.venue_id) throw new AuthorizationError(DENIED);
  await assertVenueOperator(db, userId, data.venue_id);
  return data.venue_id;
}

export async function assertPairedVenueDevice(
  db: Db,
  deviceToken: string,
  venueId: string,
  sessionId: string,
) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceToken));
  const tokenHash = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const { data, error } = await db
    .from("venue_devices")
    .select("id")
    .eq("device_token_hash", tokenHash)
    .eq("venue_id", venueId)
    .eq("status", "paired")
    .maybeSingle();
  if (error) throw new AuthorizationError("Não foi possível verificar a TV.");
  if (!data) throw new AuthorizationError(DENIED);
  const { data: session, error: sessionError } = await db
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("venue_id", venueId)
    .eq("status", "active")
    .maybeSingle();
  if (sessionError) throw new AuthorizationError("Não foi possível verificar a sessão da TV.");
  if (!session) throw new AuthorizationError(DENIED);
}
