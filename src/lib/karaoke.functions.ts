import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

const Id = z.string().uuid();
const PublicCode = z
  .string()
  .trim()
  .min(4)
  .max(40)
  .regex(/^[a-zA-Z0-9_-]+$/);
const DeviceToken = z
  .string()
  .min(48)
  .max(128)
  .regex(/^[a-f0-9]+$/i);
const SessionType = z.enum(["free", "x1", "championship"]);
const VotingMode = z.enum(["like_only", "like_dislike"]);
const X1VotingMode = z.enum(["during_performance", "after_both_performances"]);
const Playback = z.object({
  provider: z.string().trim().min(1).max(40),
  externalId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  channelName: z.string().trim().max(200).nullable().optional(),
  thumbnailUrl: z.string().url().max(2048).nullable().optional(),
  duration: z.string().trim().max(32).nullable().optional(),
});

export type KaraokeLiveSnapshot = {
  kind: "venue" | "legacy" | "operator" | "tv" | "development";
  venueId: string | null;
  session: Tables<"sessions"> | null;
  participants: Tables<"participants">[];
  performances: (Tables<"performances"> & {
    participant: Tables<"participants"> | null;
    source: Tables<"playback_sources"> | null;
  })[];
  matches: Tables<"matches">[];
};

async function loadOperatorDeps() {
  const [{ supabaseAdmin }, auth] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./auth.server"),
  ]);
  return { db: supabaseAdmin, auth };
}

async function loadLiveSnapshot(
  db: Awaited<ReturnType<typeof loadOperatorDeps>>["db"],
  kind: KaraokeLiveSnapshot["kind"],
  venueId: string | null,
  session: Tables<"sessions"> | null,
): Promise<KaraokeLiveSnapshot> {
  if (!session)
    return { kind, venueId, session: null, participants: [], performances: [], matches: [] };

  const [participantsResult, performancesResult, matchesResult] = await Promise.all([
    db.from("participants").select("*").eq("session_id", session.id).order("participant_number"),
    db
      .from("performances")
      .select("*, participant:participants(*), source:playback_sources(*)")
      .eq("session_id", session.id)
      .order("created_at"),
    db.from("matches").select("*").eq("session_id", session.id).order("created_at"),
  ]);
  if (participantsResult.error) throw new Error("Não foi possível carregar os cantores.");
  if (performancesResult.error) throw new Error("Não foi possível carregar as apresentações.");
  if (matchesResult.error) throw new Error("Não foi possível carregar os confrontos.");

  return {
    kind,
    venueId,
    session,
    participants: participantsResult.data ?? [],
    performances: performancesResult.data ?? [],
    matches: matchesResult.data ?? [],
  };
}

export const getPublicKaraokeSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ code: PublicCode }).strict().parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: venue, error: venueError } = await supabaseAdmin
      .from("venues")
      .select("id")
      .eq("slug", data.code)
      .maybeSingle();
    if (venueError) throw new Error("Não foi possível localizar o estabelecimento.");

    if (venue) {
      const { data: session, error } = await supabaseAdmin
        .from("sessions")
        .select("*")
        .eq("venue_id", venue.id)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error("Não foi possível carregar a sessão ativa.");
      return loadLiveSnapshot(supabaseAdmin, "venue", venue.id, session);
    }

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .select("*")
      .eq("public_code", data.code)
      .in("status", ["active", "finished"])
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a sessão.");
    return loadLiveSnapshot(supabaseAdmin, "legacy", null, session);
  });

export const getOperatorKaraokeSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ sessionId: Id }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { db, auth } = await loadOperatorDeps();
    await auth.assertSessionOperator(db, context.userId, data.sessionId);
    const { data: row, error } = await db
      .from("sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a sessão.");
    if (!row) throw new Error("Sessão não encontrada.");
    return loadLiveSnapshot(db, "operator", row.venue_id, row);
  });

async function hashDeviceToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const getTvKaraokeSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ deviceToken: DeviceToken }).strict().parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = await hashDeviceToken(data.deviceToken);
    const { data: device, error: deviceError } = await supabaseAdmin
      .from("venue_devices")
      .select("venue_id, status")
      .eq("device_token_hash", tokenHash)
      .maybeSingle();
    if (deviceError) throw new Error("Não foi possível verificar esta TV.");
    if (!device || device.status !== "paired" || !device.venue_id)
      return loadLiveSnapshot(supabaseAdmin, "tv", null, null);

    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .select("*")
      .eq("venue_id", device.venue_id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a sessão ativa da TV.");
    return loadLiveSnapshot(supabaseAdmin, "tv", device.venue_id, session);
  });

export const getDevelopmentKaraokeSnapshot = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ sessionId: Id }).strict().parse(data))
  .handler(async ({ data }) => {
    if (!import.meta.env.DEV)
      throw new Error("A prévia por ID só está disponível em desenvolvimento.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error } = await supabaseAdmin
      .from("sessions")
      .select("*")
      .eq("id", data.sessionId)
      .in("status", ["active", "finished"])
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a sessão de prévia.");
    return loadLiveSnapshot(supabaseAdmin, "development", null, session);
  });

async function operatorSession(
  db: Awaited<ReturnType<typeof loadOperatorDeps>>["db"],
  userId: string,
  sessionId: string,
) {
  const { data: session, error } = await db
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível carregar a sessão.");
  if (!session) throw new Error("Sessão não encontrada.");
  const auth = await import("./auth.server");
  await auth.assertVenueOperator(db, userId, session.venue_id);
  return session;
}

export const authorizeKaraokeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: Id }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { db, auth } = await loadOperatorDeps();
    await auth.assertSessionOperator(db, context.userId, data.sessionId);
    return { authorized: true };
  });

export const getOperatorActiveSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await loadOperatorDeps();
    const { data: links, error: linksError } = await db
      .from("venue_operators")
      .select("venue_id")
      .eq("user_id", context.userId);
    if (linksError) throw new Error("Não foi possível carregar seus estabelecimentos.");
    const venueIds = links.map((link) => link.venue_id);
    if (venueIds.length === 0) return null;
    const { data, error } = await db
      .from("sessions")
      .select("*")
      .in("venue_id", venueIds)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar sua sessão ativa.");
    return data;
  });

export const createKaraokeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        venueId: Id,
        sessionType: SessionType.default("free"),
        votingMode: VotingMode.default("like_only"),
        x1VotingMode: X1VotingMode.default("during_performance"),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db, auth } = await loadOperatorDeps();
    await auth.assertVenueOperator(db, context.userId, data.venueId);
    if (data.sessionType !== "free" && data.votingMode !== "like_dislike")
      throw new Error("Este formato exige votação com Gostei / Não gostei.");
    const now = new Date().toISOString();
    const { data: session, error } = await db
      .from("sessions")
      .insert({
        name: data.name,
        status: "active",
        started_at: now,
        venue_id: data.venueId,
        session_type: data.sessionType,
        voting_mode: data.sessionType === "free" ? data.votingMode : "like_dislike",
        ...(data.sessionType === "x1" ? { x1_voting_mode: data.x1VotingMode } : {}),
      })
      .select("*")
      .single();
    if (error || !session) throw new Error("Não foi possível criar a sessão.");
    return session;
  });

export const finishKaraokeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: Id }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await loadOperatorDeps();
    const session = await operatorSession(db, context.userId, data.sessionId);
    if (session.status !== "active") throw new Error("Apenas sessões ativas podem ser encerradas.");
    const { data: updated, error } = await db
      .from("sessions")
      .update({ status: "finished", ended_at: new Date().toISOString() })
      .eq("id", session.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error || !updated) throw new Error("Não foi possível encerrar a sessão.");
  });

export const updateKaraokeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: Id,
        patch: z
          .object({
            tv_enabled: z.boolean().optional(),
            show_qr_on_tv: z.boolean().optional(),
            voting_mode: VotingMode.optional(),
          })
          .strict()
          .refine((patch) => Object.keys(patch).length > 0),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await loadOperatorDeps();
    const session = await operatorSession(db, context.userId, data.sessionId);
    if (session.status === "finished")
      throw new Error("A configuração de uma sessão encerrada não pode ser alterada.");
    if (data.patch.voting_mode !== undefined) {
      if (session.status !== "draft")
        throw new Error("O modo de votação não pode ser alterado após o início da sessão.");
      if (session.session_type !== "free" && data.patch.voting_mode !== "like_dislike")
        throw new Error("Este formato exige votação com Gostei / Não gostei.");
    }
    const { error } = await db.from("sessions").update(data.patch).eq("id", session.id);
    if (error) throw new Error("Não foi possível salvar a configuração da sessão.");
  });

export const addKaraokeParticipant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: Id,
        name: z.string().trim().min(1).max(120),
        stageName: z.string().trim().max(120).default(""),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await loadOperatorDeps();
    const session = await operatorSession(db, context.userId, data.sessionId);
    if (session.status !== "active")
      throw new Error("Só é possível cadastrar cantores em uma sessão ativa.");
    const { data: participant, error } = await db
      .from("participants")
      .insert({
        session_id: session.id,
        name: data.name,
        stage_name: data.stageName || null,
        participant_number: 0,
      })
      .select("*")
      .single();
    if (error || !participant) throw new Error("Não foi possível cadastrar o cantor.");
    return participant;
  });

export const createKaraokePerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sessionId: Id,
        participantId: Id,
        playback: Playback,
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await loadOperatorDeps();
    const session = await operatorSession(db, context.userId, data.sessionId);
    if (session.status !== "active" || session.session_type === "x1")
      throw new Error("A sessão não aceita novas apresentações neste estado.");
    const { data: participant, error: participantError } = await db
      .from("participants")
      .select("id")
      .eq("id", data.participantId)
      .eq("session_id", session.id)
      .maybeSingle();
    if (participantError) throw new Error("Não foi possível verificar o cantor.");
    if (!participant) throw new Error("O cantor não pertence a esta sessão.");

    const { data: existing, error: sourceError } = await db
      .from("playback_sources")
      .select("id")
      .eq("provider", data.playback.provider)
      .eq("external_id", data.playback.externalId)
      .maybeSingle();
    if (sourceError) throw new Error("Não foi possível localizar a fonte de reprodução.");
    let source = existing;
    if (!source) {
      const inserted = await db
        .from("playback_sources")
        .insert({
          provider: data.playback.provider,
          external_id: data.playback.externalId,
          title: data.playback.title,
          channel_name: data.playback.channelName ?? null,
          thumbnail_url: data.playback.thumbnailUrl ?? null,
          duration: data.playback.duration ?? null,
        })
        .select("id")
        .single();
      if (inserted.error?.code === "23505") {
        const raced = await db
          .from("playback_sources")
          .select("id")
          .eq("provider", data.playback.provider)
          .eq("external_id", data.playback.externalId)
          .single();
        if (raced.error || !raced.data)
          throw new Error("Não foi possível salvar a fonte de reprodução.");
        source = raced.data;
      } else {
        if (inserted.error || !inserted.data)
          throw new Error("Não foi possível salvar a fonte de reprodução.");
        source = inserted.data;
      }
    }

    const { data: performance, error } = await db
      .from("performances")
      .insert({
        session_id: session.id,
        participant_id: participant.id,
        playback_source_id: source.id,
        status: "queued",
      })
      .select("*")
      .single();
    if (error || !performance) throw new Error("Não foi possível criar a apresentação.");
    return performance;
  });

export const setKaraokePerformanceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        performanceId: Id,
        status: z.enum(["active", "completed", "cancelled"]),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { db } = await loadOperatorDeps();
    const { data: performance, error } = await db
      .from("performances")
      .select("id, session_id, match_id, status")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a apresentação.");
    if (!performance) throw new Error("Apresentação não encontrada.");
    const session = await operatorSession(db, context.userId, performance.session_id);
    if (session.status !== "active" || session.session_type === "x1" || performance.match_id)
      throw new Error("Esta apresentação deve ser gerenciada pelo fluxo de disputa.");

    if (data.status === "active" && performance.status !== "queued")
      throw new Error("Só apresentações na fila podem ser iniciadas.");
    if (data.status !== "active" && performance.status !== "active")
      throw new Error("Só apresentações ativas podem ser encerradas.");
    const now = new Date().toISOString();
    const patch =
      data.status === "active"
        ? { status: data.status, started_at: now }
        : { status: data.status, ended_at: now };
    const { data: updated, error: updateError } = await db
      .from("performances")
      .update(patch)
      .eq("id", performance.id)
      .eq("status", performance.status)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) throw new Error("Não foi possível atualizar a apresentação.");
  });

export const completePerformanceFromTv = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ performanceId: Id, deviceToken: DeviceToken }).strict().parse(d),
  )
  .handler(async ({ data }) => {
    const { db, auth } = await loadOperatorDeps();
    const { data: performance, error } = await db
      .from("performances")
      .select("id, session_id, match_id, status")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a apresentação.");
    if (!performance || performance.status !== "active" || performance.match_id)
      throw new Error("A apresentação ativa não está disponível para esta TV.");
    const { data: session, error: sessionError } = await db
      .from("sessions")
      .select("venue_id, status")
      .eq("id", performance.session_id)
      .maybeSingle();
    if (sessionError) throw new Error("Não foi possível verificar a sessão.");
    if (!session?.venue_id || session.status !== "active")
      throw new Error("A sessão não está ativa.");
    await auth.assertPairedVenueDevice(
      db,
      data.deviceToken,
      session.venue_id,
      performance.session_id,
    );
    const { data: updated, error: updateError } = await db
      .from("performances")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", performance.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (updateError || !updated) throw new Error("Não foi possível concluir a apresentação.");
  });

export const getAuthorizedApiStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sessionId: Id }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await loadOperatorDeps();
    await operatorSession(db, context.userId, data.sessionId);
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const {
      data: calls,
      count,
      error,
    } = await db
      .from("provider_api_calls")
      .select("*", { count: "exact" })
      .eq("provider", "youtube")
      .eq("endpoint", "search.list")
      .eq("cached", false)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error("Não foi possível carregar as estatísticas da API.");
    return { todayCalls: count ?? 0, last: calls?.[0] ?? null };
  });
