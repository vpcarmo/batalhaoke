import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { x1MatchVoteRejection } from "./voting-rules";

type AdminDb = SupabaseClient<Database>;
const Id = z.string().uuid();
const Playback = z.object({
  provider: z.string().trim().min(1),
  externalId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  channelName: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
});
const MatchInput = z.object({ sessionId: Id, participantAId: Id, participantBId: Id });
const MatchIdInput = z.object({ matchId: Id });
const CancelMatchInput = z.object({ matchId: Id, withdrawnSlot: z.enum(["a", "b", "both"]) });
const Slot = z.enum(["a", "b"]);

function fail(message: string): never {
  throw new Error(message);
}

async function getX1Match(matchId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: match, error } = await supabaseAdmin
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();
  if (error || !match) fail("Confronto não encontrado");
  const { data: session, error: sessionError } = await supabaseAdmin
    .from("sessions")
    .select("session_type, status, x1_voting_mode, venue_id")
    .eq("id", match.session_id)
    .maybeSingle();
  if (!session || session.session_type !== "x1") fail("Confronto indisponível para esta sessão");
  return { supabaseAdmin, match, session };
}

async function authorizedMatch(matchId: string, userId: string) {
  const ctx = await getX1Match(matchId);
  const auth = await import("./auth.server");
  await auth.assertVenueOperator(ctx.supabaseAdmin, userId, ctx.session.venue_id);
  return ctx;
}

async function authorizePerformance(performanceId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: performance, error } = await supabaseAdmin
    .from("performances")
    .select("session_id")
    .eq("id", performanceId)
    .maybeSingle();
  if (error) fail("Não foi possível verificar a apresentação");
  if (!performance) fail("Apresentação não encontrada");
  const auth = await import("./auth.server");
  await auth.assertSessionOperator(supabaseAdmin, userId, performance.session_id);
  return supabaseAdmin;
}

/** Creates a scheduled X1 confrontation. Participant availability is server-enforced. */
export const createMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MatchInput.parse(d))
  .handler(async ({ data, context }) => {
    if (data.participantAId === data.participantBId) fail("Escolha dois participantes diferentes");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("id, session_type, status, venue_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessionError) fail("Não foi possível carregar a sessão");
    if (!session) fail("Sessão não encontrada");
    const auth = await import("./auth.server");
    await auth.assertVenueOperator(supabaseAdmin, context.userId, session.venue_id);
    if (session.session_type !== "x1" || session.status !== "active")
      fail("A sessão X1 precisa estar ativa");

    const { data: participants, error: participantsError } = await supabaseAdmin
      .from("participants")
      .select("id")
      .eq("session_id", data.sessionId)
      .in("id", [data.participantAId, data.participantBId]);
    if (participantsError) fail("Não foi possível verificar os participantes");
    if ((participants?.length ?? 0) !== 2) fail("Os dois participantes devem pertencer à sessão");
    const { data: busy, error: busyError } = await supabaseAdmin
      .from("matches")
      .select("id")
      .eq("session_id", data.sessionId)
      .in("status", ["scheduled", "in_progress"])
      .or(
        `participant_a_id.eq.${data.participantAId},participant_b_id.eq.${data.participantAId},participant_a_id.eq.${data.participantBId},participant_b_id.eq.${data.participantBId}`,
      )
      .limit(1);
    if (busyError) fail("Não foi possível verificar a disponibilidade dos participantes");
    if (busy?.length) fail("Um dos participantes já está em outro confronto aberto");

    const { data: match, error } = await supabaseAdmin
      .from("matches")
      .insert({
        session_id: data.sessionId,
        participant_a_id: data.participantAId,
        participant_b_id: data.participantBId,
        status: "scheduled",
        winner_participant_id: null,
        withdrawn_slot: null,
      })
      .select()
      .single();
    if (error || !match) fail("Não foi possível criar o confronto");
    return match;
  });

export const startMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MatchIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, match, session } = await authorizedMatch(data.matchId, context.userId);
    if (session.status !== "active" || match.status !== "scheduled")
      fail("Apenas confrontos agendados podem iniciar");
    const { data: performances, error: performancesError } = await supabaseAdmin
      .from("performances")
      .select("id, match_slot, participant_id, playback_source_id, status")
      .eq("match_id", match.id);
    if (performancesError) fail("Não foi possível verificar a preparação do confronto");
    const performanceA = performances.find((performance) => performance.match_slot === "a");
    const performanceB = performances.find((performance) => performance.match_slot === "b");
    if (
      !performanceA ||
      performanceA.status !== "queued" ||
      performanceA.participant_id !== match.participant_a_id ||
      !performanceA.playback_source_id ||
      !performanceB ||
      performanceB.status !== "queued" ||
      performanceB.participant_id !== match.participant_b_id ||
      !performanceB.playback_source_id
    )
      fail("Prepare as músicas dos cantores A e B antes de iniciar o confronto");
    const { data: activePerformance, error: activePerformanceError } = await supabaseAdmin
      .from("performances")
      .select("id")
      .eq("session_id", match.session_id)
      .eq("status", "active")
      .maybeSingle();
    if (activePerformanceError) fail("Não foi possível verificar apresentações em andamento");
    if (activePerformance) fail("Encerre a apresentação ativa antes de iniciar este confronto");
    const { data: startedMatch, error } = await supabaseAdmin
      .from("matches")
      .update({ status: "in_progress" })
      .eq("id", match.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") fail("Já existe um confronto em andamento nesta sessão");
    if (error || !startedMatch) fail("Não foi possível iniciar o confronto");
    await activateMatchPerformance(performanceA.id, "a");
  });

export const createMatchPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ matchId: Id, slot: Slot, playback: Playback }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, match, session } = await authorizedMatch(data.matchId, context.userId);
    if (session.status !== "active") fail("A sessão X1 precisa estar ativa");
    if (match.status !== "scheduled" && match.status !== "in_progress")
      fail("O confronto precisa estar agendado ou em andamento");
    const { count: slotCount, error: slotError } = await supabaseAdmin
      .from("performances")
      .select("id", { count: "exact", head: true })
      .eq("match_id", match.id)
      .eq("match_slot", data.slot);
    if (slotError) fail("Não foi possível verificar a posição do confronto");
    if ((slotCount ?? 0) > 0) fail("Esta posição já possui apresentação");

    const { data: foundSource, error: sourceError } = await supabaseAdmin
      .from("playback_sources")
      .select("id")
      .eq("provider", data.playback.provider)
      .eq("external_id", data.playback.externalId)
      .maybeSingle();
    if (sourceError) fail("Não foi possível localizar a fonte de reprodução");
    let source = foundSource;
    if (!source) {
      const created = await supabaseAdmin
        .from("playback_sources")
        .insert({
          provider: data.playback.provider,
          external_id: data.playback.externalId,
          title: data.playback.title,
          channel_name: data.playback.channelName ?? null,
          thumbnail_url: data.playback.thumbnailUrl ?? null,
          duration: data.playback.duration ?? null,
          metadata: (data.playback.metadata ?? {}) as never,
        })
        .select("id")
        .single();
      if (created.error || !created.data) fail("Não foi possível salvar o playback");
      source = created.data;
    }
    const participantId = data.slot === "a" ? match.participant_a_id : match.participant_b_id;
    const { data: performance, error } = await supabaseAdmin
      .from("performances")
      .insert({
        session_id: match.session_id,
        participant_id: participantId,
        playback_source_id: source.id,
        match_id: match.id,
        match_slot: data.slot,
        status: "queued",
      })
      .select()
      .single();
    if (error || !performance) fail("Não foi possível criar a apresentação");
    return performance;
  });

export const startMatchPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ performanceId: Id }).parse(d))
  .handler(async ({ data, context }) => {
    await authorizePerformance(data.performanceId, context.userId);
    await activateMatchPerformance(data.performanceId);
  });

async function activateMatchPerformance(performanceId: string, expectedSlot?: "a" | "b") {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: performance, error: performanceError } = await supabaseAdmin
    .from("performances")
    .select("id, match_id, match_slot, participant_id, session_id, status")
    .eq("id", performanceId)
    .maybeSingle();
  if (performanceError) fail("Não foi possível verificar a apresentação X1");
  if (!performance?.match_id || performance.status !== "queued")
    fail("Apresentação X1 agendada não encontrada");
  if (expectedSlot && performance.match_slot !== expectedSlot)
    fail(`A apresentação do cantor ${expectedSlot.toUpperCase()} não corresponde ao confronto`);

  const { match, session } = await getX1Match(performance.match_id);
  if (session.status !== "active") fail("A sessão X1 não está ativa");
  if (match.status !== "in_progress") fail("O confronto não está em andamento");
  const participantId =
    performance.match_slot === "a"
      ? match.participant_a_id
      : performance.match_slot === "b"
        ? match.participant_b_id
        : null;
  if (
    !participantId ||
    performance.participant_id !== participantId ||
    performance.session_id !== match.session_id
  )
    fail("A apresentação não pertence à posição informada neste confronto");
  if (performance.match_slot === "b") {
    const { data: first, error: firstError } = await supabaseAdmin
      .from("performances")
      .select("status")
      .eq("match_id", match.id)
      .eq("match_slot", "a")
      .maybeSingle();
    if (firstError) fail("Não foi possível verificar a apresentação A");
    if (first?.status !== "completed") fail("A apresentação A precisa terminar antes da B");
  }

  const { data: activePerformance, error: activePerformanceError } = await supabaseAdmin
    .from("performances")
    .select("id")
    .eq("session_id", match.session_id)
    .eq("status", "active")
    .maybeSingle();
  if (activePerformanceError) fail("Não foi possível verificar apresentações em andamento");
  if (activePerformance) fail("Já existe uma apresentação ativa nesta sessão");

  const { data: activatedPerformance, error } = await supabaseAdmin
    .from("performances")
    .update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", performance.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") fail("Já existe uma apresentação ativa nesta sessão");
  if (error || !activatedPerformance) fail("Não foi possível iniciar a apresentação");
}

export const completeMatchPerformance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ performanceId: Id }).parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await authorizePerformance(data.performanceId, context.userId);
    await completeMatchPerformanceCore(supabaseAdmin, data.performanceId);
  });

export const completeMatchPerformanceFromTv = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        performanceId: Id,
        deviceToken: z
          .string()
          .min(48)
          .max(128)
          .regex(/^[a-f0-9]+$/i),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: performance, error } = await supabaseAdmin
      .from("performances")
      .select("session_id, status")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (error) fail("Não foi possível verificar a apresentação X1");
    if (!performance || performance.status !== "active")
      fail("Apresentação X1 ativa não encontrada");
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("venue_id, status")
      .eq("id", performance.session_id)
      .maybeSingle();
    if (sessionError) fail("Não foi possível verificar a sessão X1");
    if (!session?.venue_id || session.status !== "active") fail("A sessão X1 não está ativa");
    const auth = await import("./auth.server");
    await auth.assertPairedVenueDevice(
      supabaseAdmin,
      data.deviceToken,
      session.venue_id,
      performance.session_id,
    );
    await completeMatchPerformanceCore(supabaseAdmin, data.performanceId);
  });

async function completeMatchPerformanceCore(supabaseAdmin: AdminDb, performanceId: string) {
  const { data: performance, error: performanceError } = await supabaseAdmin
    .from("performances")
    .select("id, match_id, match_slot, participant_id, session_id, status")
    .eq("id", performanceId)
    .maybeSingle();
  if (performanceError) fail("Não foi possível verificar a apresentação X1");
  if (!performance?.match_id || performance.status !== "active")
    fail("Apresentação X1 ativa não encontrada");
  const { match, session } = await getX1Match(performance.match_id);
  if (session.status !== "active") fail("A sessão X1 não está ativa");
  if (match.status !== "in_progress") fail("O confronto não está em andamento");
  const participantId =
    performance.match_slot === "a"
      ? match.participant_a_id
      : performance.match_slot === "b"
        ? match.participant_b_id
        : null;
  if (
    !participantId ||
    performance.participant_id !== participantId ||
    performance.session_id !== match.session_id
  )
    fail("A apresentação não pertence à posição informada neste confronto");
  const { data: completedPerformance, error } = await supabaseAdmin
    .from("performances")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", performance.id)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error || !completedPerformance) fail("Não foi possível encerrar a apresentação");

  if (performance.match_slot === "a") {
    const { data: performanceB, error: performanceBError } = await supabaseAdmin
      .from("performances")
      .select("id, match_slot, participant_id, session_id, status")
      .eq("match_id", match.id)
      .eq("match_slot", "b")
      .maybeSingle();
    if (performanceBError) fail("Não foi possível verificar a apresentação B");
    if (
      performanceB?.status === "queued" &&
      performanceB.match_slot === "b" &&
      performanceB.participant_id === match.participant_b_id &&
      performanceB.session_id === match.session_id
    ) {
      await activateMatchPerformance(performanceB.id, "b");
    }
  }
}

export const confirmMatchWinner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ matchId: Id, winnerParticipantId: Id }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, match, session } = await authorizedMatch(data.matchId, context.userId);
    if (session.status !== "active") fail("A sessão X1 não está ativa");
    if (match.status !== "in_progress") fail("O confronto não está pronto para resultado");
    if (![match.participant_a_id, match.participant_b_id].includes(data.winnerParticipantId))
      fail("O vencedor deve participar do confronto");
    const { data: performances, error: performanceError } = await supabaseAdmin
      .from("performances")
      .select("match_slot, status")
      .eq("match_id", match.id);
    if (performanceError) fail("Não foi possível verificar as apresentações do confronto");
    if (
      performances?.length !== 2 ||
      !performances.every((performance) => performance.status === "completed")
    )
      fail("As duas apresentações precisam estar concluídas");
    if (session.x1_voting_mode === "after_both_performances") {
      // Direct A/B vote must be finished before a winner can be confirmed.
      if (match.voting_status === "idle") fail("A votação direta ainda não foi aberta");
      if (match.voting_status === "open") {
        if (match.voting_ends_at && new Date(match.voting_ends_at).getTime() > Date.now())
          fail("Aguarde o encerramento da votação");
        const { error: closeError } = await supabaseAdmin
          .from("matches")
          .update({ voting_status: "closed" })
          .eq("id", match.id)
          .eq("voting_status", "open");
        if (closeError) fail("Não foi possível encerrar a votação");
      }
    }
    const { error } = await supabaseAdmin
      .from("matches")
      .update({ status: "completed", winner_participant_id: data.winnerParticipantId })
      .eq("id", match.id)
      .eq("status", "in_progress");
    if (error) fail("Não foi possível confirmar o vencedor");
  });

export const cancelMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CancelMatchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, match, session } = await authorizedMatch(data.matchId, context.userId);
    if (session.status !== "active") fail("A sessão X1 não está ativa");
    if (match.status !== "scheduled")
      fail("Apenas confrontos agendados podem ser cancelados por desistência");
    const { data: cancelledMatch, error: matchError } = await supabaseAdmin
      .from("matches")
      .update({
        status: "cancelled",
        winner_participant_id: null,
        withdrawn_slot: data.withdrawnSlot,
      })
      .eq("id", match.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (matchError || !cancelledMatch) fail("Não foi possível cancelar o confronto");

    const { data: removedPerformances, error: performancesError } = await supabaseAdmin
      .from("performances")
      .delete()
      .eq("match_id", match.id)
      .eq("status", "queued")
      .select("id");
    if (performancesError || !removedPerformances)
      fail("Não foi possível remover as apresentações preparadas do confronto");
  });

// ---------------------------------------------------------------------------
// X1 "after_both_performances" voting model. Fully separate from `votes`:
// the direct A/B vote lives in `x1_match_votes`. The window opens atomically in
// the database when performance B completes (trigger open_x1_vote_on_b_complete),
// and a DB trigger rejects any vote after `voting_ends_at`.
// ---------------------------------------------------------------------------
const X1VotingModeInput = z.enum(["during_performance", "after_both_performances"]);
const VoterCode = z
  .string()
  .trim()
  .min(4)
  .max(40)
  .regex(/^[a-zA-Z0-9_-]+$/);
const VoterToken = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

/** Same hash format as votes.functions so voter_sessions rows are shared. */
async function hashVoterToken(sessionId: string, token: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${sessionId}:${token}`),
  );
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Resolves a public code (venue slug or legacy session code) to its session. */
async function resolveX1VotingSession(code: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: venue, error: venueError } = await supabaseAdmin
    .from("venues")
    .select("id")
    .eq("slug", code)
    .maybeSingle();
  if (venueError) fail("Não foi possível localizar o estabelecimento");
  const query = supabaseAdmin.from("sessions").select("id, status, session_type, x1_voting_mode");
  const { data: session, error } = venue
    ? await query.eq("venue_id", venue.id).eq("status", "active").maybeSingle()
    : await query.eq("public_code", code).maybeSingle();
  if (error) fail("Não foi possível carregar a sessão de votação");
  return { supabaseAdmin, session };
}

async function getAfterBothMatch(matchId: string) {
  const ctx = await getX1Match(matchId);
  if (ctx.session.x1_voting_mode !== "after_both_performances")
    fail("Este confronto não usa votação direta");
  return ctx;
}

/** Changes the X1 voting model; only allowed while the session has no matches (also DB-enforced). */
export const updateX1VotingMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: Id, mode: X1VotingModeInput }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("sessions")
      .select("session_type, status, venue_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sessionError) fail("Não foi possível carregar a sessão X1");
    if (!session || session.session_type !== "x1" || session.status !== "active")
      fail("Disponível apenas para sessões X1 ativas");
    const auth = await import("./auth.server");
    await auth.assertVenueOperator(supabaseAdmin, context.userId, session.venue_id);
    const { count, error: countError } = await supabaseAdmin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("session_id", data.sessionId);
    if (countError) fail("Não foi possível verificar os confrontos existentes");
    if ((count ?? 0) > 0) fail("O modelo de votação fica bloqueado após o primeiro confronto");
    const { error } = await supabaseAdmin
      .from("sessions")
      .update({ x1_voting_mode: data.mode })
      .eq("id", data.sessionId);
    if (error) fail("Não foi possível alterar o modelo de votação");
  });

/** Fallback/manual opening. Idempotent: never creates a second window. */
export const openX1MatchVoting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MatchIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, match, session } = await authorizedMatch(data.matchId, context.userId);
    if (session.status !== "active") fail("A sessão X1 não está ativa");
    if (session.x1_voting_mode !== "after_both_performances")
      fail("Este confronto não usa votação direta");
    if (match.status !== "in_progress") fail("O confronto não está em andamento");
    if (match.voting_status !== "idle") return { opened: false };
    const { data: performances, error: performanceError } = await supabaseAdmin
      .from("performances")
      .select("match_slot, status")
      .eq("match_id", match.id);
    if (performanceError) fail("Não foi possível verificar as apresentações do confronto");
    const done = (slot: string) =>
      performances?.some((p) => p.match_slot === slot && p.status === "completed");
    if (!done("a") || !done("b")) fail("As duas apresentações precisam estar concluídas");
    const { data: opened, error } = await supabaseAdmin
      .from("matches")
      .update({
        voting_status: "open",
        voting_ends_at: new Date(Date.now() + 30_000).toISOString(),
      })
      .eq("id", match.id)
      .eq("voting_status", "idle")
      .eq("status", "in_progress")
      .select("id")
      .maybeSingle();
    if (error) fail("Não foi possível abrir a votação");
    return { opened: !!opened };
  });

export const closeX1MatchVoting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MatchIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, match, session } = await authorizedMatch(data.matchId, context.userId);
    if (session.status !== "active") fail("A sessão X1 não está ativa");
    if (session.x1_voting_mode !== "after_both_performances")
      fail("Este confronto não usa votação direta");
    if (match.voting_status !== "open") fail("A votação não está aberta");
    const { error } = await supabaseAdmin
      .from("matches")
      .update({ voting_status: "closed", voting_ends_at: new Date().toISOString() })
      .eq("id", match.id)
      .eq("voting_status", "open");
    if (error) fail("Não foi possível encerrar a votação");
  });

/** Direct A/B counts, read only from x1_match_votes (never like/dislike). */
export const getX1MatchTally = createServerFn({ method: "POST" })
  .inputValidator((d) => MatchIdInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match, session } = await getAfterBothMatch(data.matchId);
    if (!["active", "finished"].includes(session.status)) fail("Esta disputa não está publicada");
    if (match.voting_status === "idle") return { a: 0, b: 0, serverNow: Date.now() };
    const count = async (participantId: string) => {
      const { count: c, error } = await supabaseAdmin
        .from("x1_match_votes")
        .select("id", { count: "exact", head: true })
        .eq("match_id", match.id)
        .eq("chosen_participant_id", participantId);
      if (error) fail("Não foi possível carregar a contagem da votação");
      return c ?? 0;
    };
    const [a, b] = await Promise.all([
      count(match.participant_a_id),
      count(match.participant_b_id),
    ]);
    return { a, b, serverNow: Date.now() };
  });

/** The device's view of the current direct vote: which match, its window and whether it voted. */
export const getX1MatchVoteStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: VoterCode, token: VoterToken }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, session } = await resolveX1VotingSession(data.code);
    const none = {
      match: null,
      hasVoted: false,
      chosenParticipantId: null as string | null,
      serverNow: Date.now(),
    };
    if (
      !session ||
      session.status !== "active" ||
      session.session_type !== "x1" ||
      session.x1_voting_mode !== "after_both_performances"
    )
      return none;
    const { data: match, error: matchError } = await supabaseAdmin
      .from("matches")
      .select("id, participant_a_id, participant_b_id, voting_status, voting_ends_at")
      .eq("session_id", session.id)
      .eq("status", "in_progress")
      .maybeSingle();
    if (matchError) fail("Não foi possível carregar o confronto ativo");
    if (!match) return none;
    const hash = await hashVoterToken(session.id, data.token);
    const { data: voter, error: voterError } = await supabaseAdmin
      .from("voter_sessions")
      .select("id")
      .eq("session_id", session.id)
      .eq("voter_token_hash", hash)
      .maybeSingle();
    if (voterError) fail("Não foi possível verificar o dispositivo votante");
    let chosen: string | null = null;
    if (voter) {
      const { data: vote, error: voteError } = await supabaseAdmin
        .from("x1_match_votes")
        .select("chosen_participant_id")
        .eq("match_id", match.id)
        .eq("voter_session_id", voter.id)
        .maybeSingle();
      if (voteError) fail("Não foi possível verificar o voto");
      chosen = vote?.chosen_participant_id ?? null;
    }
    return { match, hasVoted: !!chosen, chosenParticipantId: chosen, serverNow: Date.now() };
  });

export const castX1MatchVote = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ code: VoterCode, token: VoterToken, matchId: Id, chosenParticipantId: Id }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin, session } = await resolveX1VotingSession(data.code);
    if (!session || session.status !== "active") return { result: "session_closed" as const };
    if (session.session_type !== "x1" || session.x1_voting_mode !== "after_both_performances")
      return { result: "vote_not_allowed" as const };
    const { data: match, error: matchError } = await supabaseAdmin
      .from("matches")
      .select(
        "id, session_id, status, participant_a_id, participant_b_id, voting_status, voting_ends_at",
      )
      .eq("id", data.matchId)
      .maybeSingle();
    if (matchError) fail("Não foi possível verificar o confronto");
    if (!match || match.session_id !== session.id) return { result: "invalid_match" as const };
    const rejection = x1MatchVoteRejection(match, data.chosenParticipantId, Date.now());
    if (rejection) return { result: rejection };

    const hash = await hashVoterToken(session.id, data.token);
    const { data: voter, error: vErr } = await supabaseAdmin
      .from("voter_sessions")
      .upsert(
        { session_id: session.id, voter_token_hash: hash, last_seen_at: new Date().toISOString() },
        { onConflict: "session_id,voter_token_hash" },
      )
      .select("id")
      .single();
    if (vErr || !voter) throw new Error("Não foi possível registrar o voto. Tente novamente.");
    // The DB trigger re-checks the window with the database clock (authoritative).
    const { error } = await supabaseAdmin.from("x1_match_votes").insert({
      match_id: match.id,
      voter_session_id: voter.id,
      chosen_participant_id: data.chosenParticipantId,
    });
    if (error) {
      if (error.code === "23505") return { result: "already_voted" as const };
      if (error.code === "P0001") return { result: "voting_closed" as const };
      throw new Error("Não foi possível registrar o voto. Tente novamente.");
    }
    return { result: "ok" as const };
  });
