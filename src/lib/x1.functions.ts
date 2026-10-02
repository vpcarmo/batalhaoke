import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Id = z.string().uuid();
const MatchInput = z.object({ sessionId: Id, participantAId: Id, participantBId: Id });
const MatchIdInput = z.object({ matchId: Id });
const Slot = z.enum(["a", "b"]);
const Playback = z.object({
  provider: z.string().trim().min(1),
  externalId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  channelName: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
});

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
    const { error } = await supabaseAdmin
      .from("matches")
      .update({ status: "in_progress" })
      .eq("id", match.id)
      .eq("status", "scheduled");
    if (error?.code === "23505") fail("Já existe um confronto em andamento nesta sessão");
    if (error) fail("Não foi possível iniciar o confronto");
  });

export const createMatchPerformance = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ matchId: Id, slot: Slot, playback: Playback }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match } = await getX1Match(data.matchId);
    if (match.status !== "in_progress") fail("O confronto precisa estar em andamento");
    const { count: activeCount } = await supabaseAdmin
      .from("performances")
      .select("id", { count: "exact", head: true })
      .eq("session_id", match.session_id)
      .eq("status", "active");
    if ((activeCount ?? 0) > 0) fail("Encerre a apresentação ativa antes de criar outra");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: performance } = await supabaseAdmin
      .from("performances")
      .select("*")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (!performance?.match_id || performance.status !== "queued")
      fail("Apresentação X1 agendada não encontrada");
    const { match } = await getX1Match(performance.match_id);
    if (match.status !== "in_progress") fail("O confronto não está em andamento");
    if (performance.match_slot === "b") {
      const { data: first } = await supabaseAdmin
        .from("performances")
        .select("status")
        .eq("match_id", match.id)
        .eq("match_slot", "a")
        .maybeSingle();
      if (first?.status !== "completed") fail("A apresentação A precisa terminar antes da B");
    }
    const { error } = await supabaseAdmin
      .from("performances")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", performance.id)
      .eq("status", "queued");
    if (error) fail("Não foi possível iniciar a apresentação");
  });

export const completeMatchPerformance = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ performanceId: Id }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: performance } = await supabaseAdmin
      .from("performances")
      .select("id, match_id, status")
      .eq("id", data.performanceId)
      .maybeSingle();
    if (!performance?.match_id || performance.status !== "active")
      fail("Apresentação X1 ativa não encontrada");
    const { match } = await getX1Match(performance.match_id);
    if (match.status !== "in_progress") fail("O confronto não está em andamento");
    const { error } = await supabaseAdmin
      .from("performances")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", performance.id)
      .eq("status", "active");
    if (error) fail("Não foi possível encerrar a apresentação");
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
  .inputValidator((d) => MatchIdInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, match } = await getX1Match(data.matchId);
    if (match.status !== "scheduled" && match.status !== "in_progress")
      fail("Um confronto concluído não pode ser cancelado");
    const { error } = await supabaseAdmin
      .from("matches")
      .update({ status: "cancelled", winner_participant_id: null })
      .eq("id", match.id)
      .in("status", ["scheduled", "in_progress"]);
    if (error) fail("Não foi possível cancelar o confronto");
  });
