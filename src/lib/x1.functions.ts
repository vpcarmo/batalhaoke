import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  const { data: session } = await supabaseAdmin
    .from("sessions")
    .select("session_type, status")
    .eq("id", match.session_id)
    .maybeSingle();
  if (!session || session.session_type !== "x1") fail("Confronto indisponível para esta sessão");
  return { supabaseAdmin, match, session };
}

/** Creates a scheduled X1 confrontation. Participant availability is server-enforced. */
export const createMatch = createServerFn({ method: "POST" })
  .inputValidator((d) => MatchInput.parse(d))
  .handler(async ({ data }) => {
    if (data.participantAId === data.participantBId) fail("Escolha dois participantes diferentes");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id, session_type, status")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session) fail("Sessão não encontrada");
    if (session.session_type !== "x1" || session.status !== "active")
      fail("A sessão X1 precisa estar ativa");

    const { data: participants } = await supabaseAdmin
      .from("participants")
      .select("id")
      .eq("session_id", data.sessionId)
      .in("id", [data.participantAId, data.participantBId]);
    if ((participants?.length ?? 0) !== 2) fail("Os dois participantes devem pertencer à sessão");
    const { data: busy } = await supabaseAdmin
      .from("matches")
      .select("id")
      .eq("session_id", data.sessionId)
      .in("status", ["scheduled", "in_progress"])
      .or(
        `participant_a_id.eq.${data.participantAId},participant_b_id.eq.${data.participantAId},participant_a_id.eq.${data.participantBId},participant_b_id.eq.${data.participantBId}`,
      )
      .limit(1);
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
  .inputValidator((d) => MatchIdInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match, session } = await getX1Match(data.matchId);
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
      !performanceA || performanceA.status !== "queued" ||
      performanceA.participant_id !== match.participant_a_id || !performanceA.playback_source_id ||
      !performanceB || performanceB.status !== "queued" ||
      performanceB.participant_id !== match.participant_b_id || !performanceB.playback_source_id
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
  .inputValidator((d) => z.object({ matchId: Id, slot: Slot, playback: Playback }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match } = await getX1Match(data.matchId);
    if (match.status !== "scheduled" && match.status !== "in_progress")
      fail("O confronto precisa estar agendado ou em andamento");
    const { count: slotCount } = await supabaseAdmin
      .from("performances")
      .select("id", { count: "exact", head: true })
      .eq("match_id", match.id)
      .eq("match_slot", data.slot);
    if ((slotCount ?? 0) > 0) fail("Esta posição já possui apresentação");

    let { data: source } = await supabaseAdmin
      .from("playback_sources")
      .select("id")
      .eq("provider", data.playback.provider)
      .eq("external_id", data.playback.externalId)
      .maybeSingle();
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
  .inputValidator((d) => z.object({ performanceId: Id }).parse(d))
  .handler(async ({ data }) => {
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

  const { match } = await getX1Match(performance.match_id);
  if (match.status !== "in_progress") fail("O confronto não está em andamento");
  const participantId = performance.match_slot === "a" ? match.participant_a_id
    : performance.match_slot === "b" ? match.participant_b_id
      : null;
  if (
    !participantId || performance.participant_id !== participantId ||
    performance.session_id !== match.session_id
  ) fail("A apresentação não pertence à posição informada neste confronto");
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
  .inputValidator((d) => z.object({ performanceId: Id }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: performance, error: performanceError } = await supabaseAdmin
      .from("performances")
      .select("id, match_id, match_slot, participant_id, session_id, status")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (performanceError) fail("Não foi possível verificar a apresentação X1");
    if (!performance?.match_id || performance.status !== "active")
      fail("Apresentação X1 ativa não encontrada");
    const { match } = await getX1Match(performance.match_id);
    if (match.status !== "in_progress") fail("O confronto não está em andamento");
    const participantId = performance.match_slot === "a" ? match.participant_a_id
      : performance.match_slot === "b" ? match.participant_b_id
        : null;
    if (
      !participantId || performance.participant_id !== participantId ||
      performance.session_id !== match.session_id
    ) fail("A apresentação não pertence à posição informada neste confronto");
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
  });

export const confirmMatchWinner = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ matchId: Id, winnerParticipantId: Id }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match } = await getX1Match(data.matchId);
    if (match.status !== "in_progress") fail("O confronto não está pronto para resultado");
    if (![match.participant_a_id, match.participant_b_id].includes(data.winnerParticipantId))
      fail("O vencedor deve participar do confronto");
    const { data: performances } = await supabaseAdmin
      .from("performances")
      .select("match_slot, status")
      .eq("match_id", match.id);
    if (
      performances?.length !== 2 ||
      !performances.every((performance) => performance.status === "completed")
    )
      fail("As duas apresentações precisam estar concluídas");
    const { error } = await supabaseAdmin
      .from("matches")
      .update({ status: "completed", winner_participant_id: data.winnerParticipantId })
      .eq("id", match.id)
      .eq("status", "in_progress");
    if (error) fail("Não foi possível confirmar o vencedor");
  });

export const cancelMatch = createServerFn({ method: "POST" })
  .inputValidator((d) => CancelMatchInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match } = await getX1Match(data.matchId);
    if (match.status !== "scheduled")
      fail("Apenas confrontos agendados podem ser cancelados por desistência");
    const { data: cancelledMatch, error: matchError } = await supabaseAdmin
      .from("matches")
      .update({ status: "cancelled", winner_participant_id: null, withdrawn_slot: data.withdrawnSlot })
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
    if (performancesError || !removedPerformances) fail("Não foi possível remover as apresentações preparadas do confronto");
  });
