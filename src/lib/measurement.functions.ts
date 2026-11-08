import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const Id = z.string().uuid();
const State = z.enum(["unstarted", "playing", "paused", "buffering", "ended", "error"]);

export const acquirePerformanceMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ performanceId: Id, instanceId: Id }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as SupabaseClient<Database>;
    const { data: performance, error } = await supabaseAdmin
      .from("performances")
      .select("session_id, playback_source_id, status")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (error || !performance || performance.status !== "active")
      throw new Error("Apresentação indisponível para medição.");
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("venue_id")
      .eq("id", performance.session_id)
      .maybeSingle();
    if (!session?.venue_id) throw new Error("Sessão sem estabelecimento não pode iniciar medição.");
    const auth = await import("./auth.server");
    await auth.assertVenueOperator(supabaseAdmin, context.userId, session.venue_id);
    const { data: source } = await supabaseAdmin
      .from("playback_sources")
      .select("provider")
      .eq("id", performance.playback_source_id)
      .single();
    const { data: lease, error: leaseError } = await (db as any).rpc(
      "acquire_performance_measurement",
      {
        p_performance_id: data.performanceId,
        p_instance_id: data.instanceId,
        p_provider: source?.provider ?? "unknown",
        p_lease_kind: "local",
        p_device_id: null,
      },
    );
    if (leaseError || !lease?.[0])
      throw new Error("Não foi possível obter a autorização de medição.");
    return (lease as any[])[0];
  });

async function authorizeTvMeasurement(performanceId: string, deviceToken: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const auth = await import("./auth.server");
  const device = await auth.resolvePairedVenueDevice(supabaseAdmin, deviceToken);
  const { data: performance, error } = await supabaseAdmin.from("performances")
    .select("session_id, playback_source_id, status").eq("id", performanceId).maybeSingle();
  if (error || !performance || performance.status !== "active") throw new Error("ApresentaÃ§Ã£o indisponÃ­vel para mediÃ§Ã£o.");
  const { data: session } = await supabaseAdmin.from("sessions").select("venue_id,status")
    .eq("id", performance.session_id).maybeSingle();
  if (!session || session.status !== "active" || session.venue_id !== device.venueId) throw new Error("TV nÃ£o autorizada para esta apresentaÃ§Ã£o.");
  return { supabaseAdmin, device, performance };
}

export const acquireTvPerformanceMeasurement = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ performanceId: Id, instanceId: Id, deviceToken: z.string().min(48).max(128).regex(/^[a-f0-9]+$/i) }).strict().parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, device, performance } = await authorizeTvMeasurement(data.performanceId, data.deviceToken);
    const { data: source } = await supabaseAdmin.from("playback_sources").select("provider").eq("id", performance.playback_source_id).maybeSingle();
    const { data: lease, error } = await (supabaseAdmin as any).rpc("acquire_performance_measurement", {
      p_performance_id: data.performanceId, p_instance_id: data.instanceId,
      p_provider: source?.provider ?? "unknown", p_lease_kind: "tv", p_device_id: device.id,
    });
    if (error || !lease?.[0]) throw new Error("NÃ£o foi possÃ­vel obter a autorizaÃ§Ã£o de mediÃ§Ã£o da TV.");
    return lease[0];
  });

export const sendTvPerformanceHeartbeat = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ performanceId: Id, instanceId: Id, epochId: Id, sequence: z.number().int().nonnegative(), state: State, positionSeconds: z.number().finite().nonnegative(), deviceToken: z.string().min(48).max(128).regex(/^[a-f0-9]+$/i) }).strict().parse(d))
  .handler(async ({ data }) => {
    await authorizeTvMeasurement(data.performanceId, data.deviceToken);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await (supabaseAdmin as any).rpc("record_performance_heartbeat", {
      p_performance_id: data.performanceId, p_instance_id: data.instanceId, p_epoch_id: data.epochId,
      p_sequence: data.sequence, p_state: data.state, p_position_seconds: data.positionSeconds,
    });
    if (error || !result?.[0]) throw new Error("Heartbeat rejeitado pela autorizaÃ§Ã£o de mediÃ§Ã£o.");
    return result[0];
  });

export const sendPerformanceHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        performanceId: Id,
        instanceId: Id,
        epochId: Id,
        sequence: z.number().int().nonnegative(),
        state: State,
        positionSeconds: z.number().finite().nonnegative(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as SupabaseClient<Database>;
    const { data: measurement, error: loadError } = await (db as any)
      .from("performance_measurements")
      .select("session_id")
      .eq("performance_id", data.performanceId)
      .maybeSingle();
    if (loadError || !measurement) throw new Error("Medição não encontrada.");
    const auth = await import("./auth.server");
    await auth.assertSessionOperator(supabaseAdmin, context.userId, measurement.session_id);
    const { data: result, error } = await (db as any).rpc("record_performance_heartbeat", {
      p_performance_id: data.performanceId,
      p_instance_id: data.instanceId,
      p_epoch_id: data.epochId,
      p_sequence: data.sequence,
      p_state: data.state,
      p_position_seconds: data.positionSeconds,
    });
    if (error || !result?.[0]) throw new Error("Heartbeat rejeitado pela autorização de medição.");
    return (result as any[])[0];
  });

export const getPerformanceMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ performanceId: Id }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as SupabaseClient<Database>;
    const { data: measurement, error } = await (db as any)
      .from("performance_measurements")
      .select("*")
      .eq("performance_id", data.performanceId)
      .maybeSingle();
    if (error || !measurement) throw new Error("Medição não encontrada.");
    const auth = await import("./auth.server");
    await auth.assertSessionOperator(supabaseAdmin, context.userId, measurement.session_id);
    return measurement;
  });

export const finalizePerformanceMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ performanceId: Id }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as SupabaseClient<Database>;
    const { data: performance } = await db
      .from("performances")
      .select("session_id")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (!performance) throw new Error("Apresentação não encontrada.");
    const auth = await import("./auth.server");
    await auth.assertSessionOperator(supabaseAdmin, context.userId, performance.session_id);
    const { error } = await (db as any).rpc("finalize_performance_measurement", {
      p_performance_id: data.performanceId,
    });
    if (error) throw new Error("Não foi possível finalizar a medição.");
  });
