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
export async function assertVenueOperator(db: Db, userId: unknown, venueId: unknown): Promise<OperatorRole> {
  const ids = z.object({ userId: z.string().uuid(), venueId: z.string().uuid() }).safeParse({ userId, venueId });
  if (!ids.success) throw new AuthorizationError(DENIED);
  const { data, error } = await db.from("venue_operators").select("role")
    .eq("user_id", ids.data.userId).eq("venue_id", ids.data.venueId).maybeSingle();
  if (error) throw new AuthorizationError("Não foi possível verificar suas permissões.");
  if (!data || !isOperatorRole(data.role)) throw new AuthorizationError(DENIED);
  return data.role;
}
