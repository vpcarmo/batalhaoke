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
  championship: ChampionshipLiveSnapshot | null;
};

export type ChampionshipLiveSnapshot = {
  title: string;
  status: string;
  format: number;
  entries: {
    id: string;
    displayName: string;
    groupLetter: string | null;
    seedNumber: number | null;
    participantId: string | null;
  }[];
  matches: {
    id: string;
    stage: string;
    matchNumber: number;
    entryAId: string | null;
    entryBId: string | null;
    winnerEntryId: string | null;
    status: string;
    votingStatus: string;
    votingEndsAt: string | null;
    votesA: number;
    votesB: number;
    resultSource: "votes" | "operator" | null;
    performanceA: { title: string; status: string } | null;
    performanceB: { title: string; status: string } | null;
  }[];
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
    return {
      kind,
      venueId,
      session: null,
      participants: [],
      performances: [],
      matches: [],
      championship: null,
    };

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

  let championship: ChampionshipLiveSnapshot | null = null;
  if (session.session_type === "championship" && session.championship_id) {
    const [championshipResult, entriesResult, championshipMatchesResult] = await Promise.all([
      db
        .from("championships")
        .select("id, title, status, format")
        .eq("id", session.championship_id)
        .maybeSingle(),
      db
        .from("championship_entries")
        .select("id, stage_name, group_letter, seed_number, participant_id")
        .eq("championship_id", session.championship_id)
        .in("status", ["confirmed", "withdrawn", "disqualified"])
        .order("seed_number"),
      db
        .from("championship_matches")
        .select(
          "id, stage, match_number, entry_a_id, entry_b_id, winner_entry_id, status, voting_status, voting_ends_at, performance_a_id, performance_b_id",
        )
        .eq("championship_id", session.championship_id)
        .order("created_at"),
    ]);
    if (championshipResult.error)
      throw new Error("Não foi possível carregar o Campeonato da sessão.");
    if (entriesResult.error)
      throw new Error("Não foi possível carregar os participantes do Campeonato.");
    if (championshipMatchesResult.error)
      throw new Error("Não foi possível carregar os confrontos do Campeonato.");
    const championshipMatches = championshipMatchesResult.data ?? [];
    const matchIds = championshipMatches.map((match) => match.id);
    let resolvedMatchIds = new Set<string>();
    if (matchIds.length) {
      const { data: resolutions, error: resolutionsError } = await db
        .from("championship_match_resolution_audit")
        .select("match_id")
        .in("match_id", matchIds);
      if (resolutionsError)
        throw new Error("Não foi possível carregar as decisões dos confrontos do Campeonato.");
      resolvedMatchIds = new Set((resolutions ?? []).map((resolution) => resolution.match_id));
    }

    const countVotesForEntry = async (matchId: string, entryId: string | null) => {
      if (!entryId) return 0;
      const { count, error } = await db
        .from("championship_match_votes")
        .select("id", { count: "exact", head: true })
        .eq("match_id", matchId)
        .eq("chosen_entry_id", entryId);
      if (error) throw new Error("Não foi possível carregar a apuração do Campeonato.");
      return count ?? 0;
    };
    const championshipStatus = championshipResult.data?.status;
    const currentStage =
      championshipStatus === "drawn" || championshipStatus === "quarter_finals"
        ? "quarter_final"
        : championshipStatus === "semi_finals"
          ? "semi_final"
          : championshipStatus === "final" || championshipStatus === "completed"
            ? "final"
            : null;
    const stageMatches = championshipMatches.filter(
      (match) => match.stage === currentStage,
    );
    const scoredMatch =
      stageMatches.find((match) => match.status === "in_progress") ??
      [...stageMatches].reverse().find(
        (match) => match.status === "completed" || match.status === "wo",
      );
    const tallyResults = scoredMatch
      ? await Promise.all([
          countVotesForEntry(scoredMatch.id, scoredMatch.entry_a_id),
          countVotesForEntry(scoredMatch.id, scoredMatch.entry_b_id),
        ])
      : [];

    const participantsById = new Map(
      (participantsResult.data ?? []).map((participant) => [participant.id, participant]),
    );
    const performancesById = new Map(
      (performancesResult.data ?? []).map((performance) => [performance.id, performance]),
    );
    const tallies = new Map<string, { a: number; b: number }>();
    if (scoredMatch)
      tallies.set(scoredMatch.id, { a: tallyResults[0] ?? 0, b: tallyResults[1] ?? 0 });

    if (championshipResult.data) {
      championship = {
        title: championshipResult.data.title,
        status: championshipResult.data.status,
        format: championshipResult.data.format,
        entries: (entriesResult.data ?? []).map((entry) => {
          const participant = entry.participant_id
            ? participantsById.get(entry.participant_id)
            : undefined;
          return {
            id: entry.id,
            displayName:
              entry.stage_name?.trim() ||
              participant?.stage_name?.trim() ||
              participant?.name ||
              "Participante",
            groupLetter: entry.group_letter,
            seedNumber: entry.seed_number,
            participantId: entry.participant_id,
          };
        }),
        matches: championshipMatches.map((match) => {
          const tally = tallies.get(match.id) ?? { a: 0, b: 0 };
          const performanceA = match.performance_a_id
            ? performancesById.get(match.performance_a_id)
            : undefined;
          const performanceB = match.performance_b_id
            ? performancesById.get(match.performance_b_id)
            : undefined;
          return {
            id: match.id,
            stage: match.stage,
            matchNumber: match.match_number,
            entryAId: match.entry_a_id,
            entryBId: match.entry_b_id,
            winnerEntryId: match.winner_entry_id,
            status: match.status,
            votingStatus: match.voting_status,
            votingEndsAt: match.voting_ends_at,
            votesA: tally.a,
            votesB: tally.b,
            resultSource: resolvedMatchIds.has(match.id)
              ? "operator"
              : match.status === "completed" && match.winner_entry_id
                ? "votes"
                : null,
            performanceA: performanceA
              ? { title: performanceA.source?.title ?? "", status: performanceA.status }
              : null,
            performanceB: performanceB
              ? { title: performanceB.source?.title ?? "", status: performanceB.status }
              : null,
          };
        }),
      };
    }
  }

  return {
    kind,
    venueId,
    session,
    participants: participantsResult.data ?? [],
    performances: performancesResult.data ?? [],
    matches: matchesResult.data ?? [],
    championship,
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
        // Championship stage sessions are created only by prepareStageSessionFn.
        sessionType: z.enum(["free", "x1"]).default("free"),
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
    const patch = {
      ...(data.patch.tv_enabled !== undefined && { tv_enabled: data.patch.tv_enabled }),
      ...(data.patch.show_qr_on_tv !== undefined && { show_qr_on_tv: data.patch.show_qr_on_tv }),
      ...(data.patch.voting_mode !== undefined && { voting_mode: data.patch.voting_mode }),
    };
    const { error } = await db.from("sessions").update(patch).eq("id", session.id);
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

export const CHAMPIONSHIP_ADMIN_ONLY_MESSAGE =
  "Esta apresentação pertence a um confronto do Campeonato e deve ser concluída pela tela administrativa do Campeonato.";

/**
 * Generic performance paths may never touch championship elimination presentations
 * (linked via championship_matches.performance_a_id/performance_b_id — performances.match_id is X1-only).
 * In a championship session they are allowed only during the group stage.
 */
async function assertGenericPerformanceAllowed(
  db: Awaited<ReturnType<typeof loadOperatorDeps>>["db"],
  performanceId: string,
  session: { session_type: string; championship_id: string | null },
) {
  const { data: linked, error } = await db
    .from("championship_matches")
    .select("id")
    .or(`performance_a_id.eq.${performanceId},performance_b_id.eq.${performanceId}`)
    .limit(1);
  if (error) throw new Error("Não foi possível verificar a apresentação.");
  if (linked && linked.length > 0) throw new Error(CHAMPIONSHIP_ADMIN_ONLY_MESSAGE);
  if (session.session_type !== "championship") return;
  if (!session.championship_id) throw new Error(CHAMPIONSHIP_ADMIN_ONLY_MESSAGE);
  const { data: championship, error: championshipError } = await db
    .from("championships")
    .select("status")
    .eq("id", session.championship_id)
    .maybeSingle();
  if (championshipError) throw new Error("Não foi possível verificar a fase do Campeonato.");
  if (championship?.status !== "group_stage") throw new Error(CHAMPIONSHIP_ADMIN_ONLY_MESSAGE);
}

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
    await assertGenericPerformanceAllowed(db, performance.id, session);


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
      .select("venue_id, status, session_type, championship_id")
      .eq("id", performance.session_id)
      .maybeSingle();
    if (sessionError) throw new Error("Não foi possível verificar a sessão.");
    if (!session?.venue_id || session.status !== "active")
      throw new Error("A sessão não está ativa.");
    await assertGenericPerformanceAllowed(db, performance.id, session);
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
