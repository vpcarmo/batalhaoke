import type { SupabaseClient } from "@supabase/supabase-js";
import { commercialPlaybackError } from "./commercial-playback";

/** Called only after the operator/device was authorized against the resolved session. */
export async function requireCommercialPlayback(db: SupabaseClient, performanceId: string) {
  const result = await db.rpc("authorize_commercial_playback", { p_performance_id: performanceId });
  if (result.error || typeof result.data !== "boolean")
    throw new Error(
      commercialPlaybackError(
        new Error(result.error?.message ?? "commercial_authorization_required"),
      ),
    );
  return result.data;
}
