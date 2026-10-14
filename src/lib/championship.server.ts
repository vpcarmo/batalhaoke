// Championship event domain (Etapa 2). SERVER-ONLY: every function receives a
// privileged client and must only be called after the caller is authorized.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { isValidPlaybackSource } from "./playback/registry";

type Db = SupabaseClient<Database>;

export const CHAMPIONSHIP_STATUSES = [
  "draft", "registration_open", "registration_closed", "drawn", "group_stage",
  "group_stage_completed", "quarter_finals", "semi_finals", "final", "completed", "cancelled",
] as const;
export type ChampionshipStatus = (typeof CHAMPIONSHIP_STATUSES)[number];
export const CHAMPIONSHIP_FORMATS = [8, 12, 16] as const;

/** Basic data may be edited only while the event is a draft. */
export const EDITABLE_STATUSES: readonly ChampionshipStatus[] = ["draft"];
/** The stage session can be prepared any time before the event ends. */
export const STAGE_PREPARABLE_STATUSES: readonly ChampionshipStatus[] = CHAMPIONSHIP_STATUSES.filter((s) => s !== "completed" && s !== "cancelled");
/** Competition can only start after the draw (implemented in a later stage). */
export const STAGE_ACTIVATABLE_STATUSES: readonly ChampionshipStatus[] = ["drawn", "group_stage", "group_stage_completed", "quarter_finals", "semi_finals", "final"];

export class ChampionshipError extends Error {}
const fail = (message: string): never => { throw new ChampionshipError(message); };

export function canEditChampionship(status: string) {
  return EDITABLE_STATUSES.includes(status as ChampionshipStatus);
}
export function canActivateStage(status: string) {
  return STAGE_ACTIVATABLE_STATUSES.includes(status as ChampionshipStatus);
}
/** Returns why the format cannot change, or null when it can. Any entry (waitlist included) locks it. */
export function formatChangeBlockReason(status: string, entryCount: number): string | null {
  if (status !== "draft") return "O formato só pode ser alterado enquanto o Campeonato está em rascunho.";
  if (entryCount > 0) return "O formato não pode ser alterado porque já existem inscrições.";
  return null;
}
export function assertCoherentDates(registrationDeadline: string | null | undefined, eventStartsAt: string | null | undefined) {
  if (registrationDeadline && eventStartsAt && new Date(registrationDeadline) > new Date(eventStartsAt)) {
    fail("O prazo de inscrição deve ser anterior ou igual ao início do evento.");
  }
}

const Text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const DateTime = z.string().datetime({ offset: true }).nullable().optional();
const Format = z.union([z.literal(8), z.literal(12), z.literal(16)]);
const EntrySong = z
  .object({
    type: z.enum(["main", "reserve"]),
    order: z.number().int().min(1).max(4),
    provider: z.string().trim().min(1).max(40),
    externalId: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    channelName: z.string().trim().max(200).nullable().optional(),
    thumbnailUrl: z.string().url().max(2048).refine((value) => value.startsWith("https://")).nullable().optional(),
    duration: z.string().trim().max(32).nullable().optional(),
  })
  .strict()
  .superRefine((song, context) => {
    if (song.type === "reserve" && song.order > 2) {
      context.addIssue({
        code: "custom",
        message: "As músicas reserva devem ocupar as posições 1 ou 2.",
      });
    }
  });

const EntryInput = z
  .object({
    championshipId: z.string().uuid(),
    name: z.string().trim().min(1, "Informe seu nome").max(120),
    stageName: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .optional()
      .transform((value) => value || null),
    contactPhone: z.preprocess(
      (value) => (typeof value === "string" && !value.trim() ? null : value),
      z.string().trim().min(1).max(40).nullable().optional(),
    ),
    contactEmail: z.preprocess(
      (value) => (typeof value === "string" && !value.trim() ? null : value),
      z.string().trim().email("Informe um e-mail válido").max(320).nullable().optional(),
    ),
    songs: z.array(EntrySong).max(6, "Informe no máximo seis músicas.").default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.songs.some((song) => song.type === "main")) {
      context.addIssue({
        code: "custom",
        path: ["songs"],
        message: "Escolha ao menos uma música principal.",
      });
    }
    if (!input.contactPhone && !input.contactEmail) {
      context.addIssue({
        code: "custom",
        path: ["contactPhone"],
        message: "Informe um telefone ou e-mail.",
      });
    }
    if (input.songs.filter((song) => song.type === "main").length > 4) {
      context.addIssue({
        code: "custom",
        path: ["songs"],
        message: "Informe no máximo quatro músicas principais.",
      });
    }
    if (input.songs.filter((song) => song.type === "reserve").length > 2) {
      context.addIssue({
        code: "custom",
        path: ["songs"],
        message: "Informe no máximo duas músicas reserva.",
      });
    }
    const slots = new Set<string>();
    for (const song of input.songs) {
      const slot = `${song.type}:${song.order}`;
      if (slots.has(slot)) {
        context.addIssue({
          code: "custom",
          path: ["songs"],
          message: "Cada posição de música deve ser única.",
        });
      }
      slots.add(slot);
    }
  });

export const CreateChampionshipInput = z.object({
  venueId: z.string().uuid(),
  title: z.string().trim().min(1, "Informe o título").max(120),
  format: Format,
  eventStartsAt: DateTime,
  registrationDeadline: DateTime,
  location: Text(200),
  rules: Text(5000),
  prizeInfo: Text(1000),
  feeInfo: Text(1000),
}).strict();

export const UpdateChampionshipInput = z.object({
  championshipId: z.string().uuid(),
  patch: z.object({
    title: z.string().trim().min(1, "Informe o título").max(120).optional(),
    format: Format.optional(),
    eventStartsAt: DateTime,
    registrationDeadline: DateTime,
    location: Text(200),
    rules: Text(5000),
    prizeInfo: Text(1000),
    feeInfo: Text(1000),
  }).strict(),
}).strict();

const CHAMPIONSHIP_COLUMNS = "id, venue_id, title, format, status, event_starts_at, registration_deadline, location, rules, prize_info, fee_info, created_at, updated_at";
const STAGE_COLUMNS = "id, name, public_code, status, session_type, voting_mode, venue_id, championship_id, tv_enabled, show_qr_on_tv, started_at, created_at";

async function loadChampionship(db: Db, id: string) {
  const { data, error } = await db.from("championships").select(CHAMPIONSHIP_COLUMNS).eq("id", id).maybeSingle();
  if (error) fail("Não foi possível carregar o Campeonato.");
  if (!data) fail("Campeonato não encontrado.");
  return data!;
}

async function countEntries(db: Db, championshipId: string) {
  const { count, error } = await db.from("championship_entries").select("id", { count: "exact", head: true }).eq("championship_id", championshipId);
  if (error) fail("Não foi possível verificar as inscrições.");
  return count ?? 0;
}

async function findStageSession(db: Db, championshipId: string) {
  const { data, error } = await db.from("sessions").select(STAGE_COLUMNS).eq("championship_id", championshipId).maybeSingle();
  if (error) fail("Não foi possível carregar a sessão de palco.");
  return data;
}

export async function createChampionship(db: Db, raw: unknown) {
  const input = CreateChampionshipInput.parse(raw);
  assertCoherentDates(input.registrationDeadline, input.eventStartsAt);
  const { data: venue, error: venueError } = await db.from("venues").select("id").eq("id", input.venueId).maybeSingle();
  if (venueError) fail("Não foi possível verificar o estabelecimento.");
  if (!venue) fail("Estabelecimento não encontrado.");
  const { data, error } = await db.from("championships").insert({
    venue_id: input.venueId, title: input.title, format: input.format, status: "draft",
    event_starts_at: input.eventStartsAt ?? null, registration_deadline: input.registrationDeadline ?? null,
    location: input.location, rules: input.rules, prize_info: input.prizeInfo, fee_info: input.feeInfo,
  }).select(CHAMPIONSHIP_COLUMNS).single();
  if (error || !data) fail("Não foi possível criar o Campeonato.");
  return data!;
}

export async function listChampionships(db: Db, venueId: unknown) {
  const id = z.string().uuid().parse(venueId);
  const { data, error } = await db.from("championships").select(CHAMPIONSHIP_COLUMNS)
    .eq("venue_id", id).order("created_at", { ascending: false });
  if (error) fail("Não foi possível listar os Campeonatos.");
  return data ?? [];
}

/** Administrative view: event data + stage session summary. Never includes entry contacts. */
export async function getChampionship(db: Db, championshipId: string) {
  const championship = await loadChampionship(db, z.string().uuid().parse(championshipId));
  const [entryCount, stageSession] = await Promise.all([countEntries(db, championship.id), findStageSession(db, championship.id)]);
  return { championship, entryCount, stageSession };
}

function assertRegistrationOpen(
  championship: { status: string; registration_deadline: string | null },
  now: Date,
) {
  if (championship.status !== "registration_open")
    fail("As inscrições deste Campeonato não estão abertas.");
  if (
    championship.registration_deadline &&
    new Date(championship.registration_deadline).getTime() <= now.getTime()
  ) {
    fail("O prazo de inscrição deste Campeonato terminou.");
  }
}

/** Public event details are only available while registration is open; no private entry data is selected. */
export async function getPublicChampionshipRegistration(
  db: Db,
  championshipId: string,
  now = new Date(),
) {
  const championship = await loadChampionship(db, z.string().uuid().parse(championshipId));
  assertRegistrationOpen(championship, now);
  const { count, error } = await db
    .from("championship_entries")
    .select("id", { count: "exact", head: true })
    .eq("championship_id", championship.id)
    .eq("status", "confirmed");
  if (error) fail("Não foi possível verificar as vagas disponíveis.");
  return {
    championship: {
      id: championship.id,
      title: championship.title,
      format: championship.format,
      event_starts_at: championship.event_starts_at,
      registration_deadline: championship.registration_deadline,
      location: championship.location,
      rules: championship.rules,
      prize_info: championship.prize_info,
      fee_info: championship.fee_info,
    },
    confirmedEntries: count ?? 0,
  };
}

function registrationRpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  const message = error.message ?? "";
  if (error.code === "23505" && /championship_entries_(phone|email)_unique/.test(message)) {
    fail("Já existe uma inscrição usando este telefone ou e-mail neste Campeonato.");
  }
  if (error.code === "P0002") fail("Campeonato não encontrado.");
  if (error.code === "P0001" || error.code === "22023") {
    if (message.includes("prazo")) fail("O prazo de inscrição deste Campeonato terminou.");
    if (message.includes("não estão abertas")) fail("As inscrições deste Campeonato não estão abertas.");
    if (message.includes("música") || message.includes("Fonte")) fail(message);
    if (message.includes("telefone") || message.includes("e-mail") || message.includes("nome")) fail(message);
  }
  console.error("[championship] atomic registration failed", error);
  fail("Não foi possível registrar a inscrição.");
}

const EntryResult = z.object({
  id: z.string().uuid(),
  status: z.enum(["confirmed", "waitlist"]),
}).strict();

/** Public registration. The database function locks the event and writes the entry and songs atomically. */
export async function registerChampionshipEntry(db: Db, raw: unknown) {
  const input = EntryInput.parse(raw);
  if (input.songs.some((song) => !isValidPlaybackSource(song.provider, song.externalId))) {
    fail("Fonte de música inválida.");
  }
  const { data, error } = await db.rpc("register_championship_entry", {
    p_championship_id: input.championshipId,
    p_name: input.name,
    p_stage_name: input.stageName ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_contact_email: input.contactEmail ?? null,
    p_songs: input.songs.map((song) => ({
      song_type: song.type,
      song_order: song.order,
      provider: song.provider,
      external_id: song.externalId,
      title: song.title,
      channel_name: song.channelName ?? null,
      thumbnail_url: song.thumbnailUrl ?? null,
      duration: song.duration ?? null,
    })),
  });
  if (error) registrationRpcError(error);
  const result = EntryResult.safeParse(data);
  if (!result.success) {
    console.error("[championship] atomic registration returned an invalid result", result.error);
    return fail("Não foi possível registrar a inscrição.");
  }
  return result.data;
}

const DrawResult = z.object({
  championship_id: z.string().uuid(),
  format: Format,
  status: z.literal("drawn"),
  entry_count: z.number().int(),
}).strict();

function drawRpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "P0002") fail("Campeonato não encontrado.");
  if (error.code === "P0001") {
    if (error.message?.includes("encerramento das inscrições")) {
      fail("O sorteio só pode ser realizado após o encerramento das inscrições.");
    }
    if (error.message?.includes("inscrições confirmadas")) {
      fail("A quantidade de inscrições confirmadas deve corresponder ao formato do Campeonato.");
    }
    if (error.message?.includes("já foi realizado")) {
      fail("O sorteio deste Campeonato já foi realizado.");
    }
    if (error.message?.includes("Formato")) fail("Formato de Campeonato inválido.");
  }
  console.error("[championship] draw failed", error);
  fail("Não foi possível realizar o sorteio.");
}

/** Administrative draw. The database performs the complete operation atomically. */
export async function drawChampionship(db: Db, championshipId: string) {
  const id = z.string().uuid().parse(championshipId);
  const { data, error } = await db.rpc("draw_championship", { p_championship_id: id });
  if (error) drawRpcError(error);
  const result = DrawResult.safeParse(data);
  if (!result.success || result.data.championship_id !== id || result.data.entry_count !== result.data.format) {
    console.error("[championship] draw returned an invalid result", result.success ? result.data : result.error);
    return fail("Não foi possível realizar o sorteio.");
  }
  return result.data;
}

export const GroupStageTieDecisionInput = z.object({
  championshipId: z.string().uuid(),
  groupLetter: z.string().trim().transform((value) => value || null).pipe(z.enum(["A", "B", "C", "D"]).nullable()),
  tiedEntryIds: z.array(z.string().uuid()).min(2),
  criteriaApplied: z.array(z.enum(["approval", "likes", "dislikes", "manual"])).min(1),
  chosenOrder: z.array(z.string().uuid()).min(2),
  rationale: z.string().trim().max(1000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  const setA = new Set(value.tiedEntryIds);
  const setB = new Set(value.chosenOrder);
  if (setA.size !== value.tiedEntryIds.length || setB.size !== value.chosenOrder.length) {
    ctx.addIssue({ code: "custom", path: ["tiedEntryIds"], message: "Cada participante deve aparecer uma única vez." });
  }
  if (setA.size !== setB.size || [...setA].some((entryId) => !setB.has(entryId))) {
    ctx.addIssue({ code: "custom", path: ["chosenOrder"], message: "A ordem escolhida deve conter exatamente os mesmos participantes." });
  }

  const approvalIndex = value.criteriaApplied.indexOf("approval");
  const likesIndex = value.criteriaApplied.indexOf("likes");
  const dislikesIndex = value.criteriaApplied.indexOf("dislikes");
  if (
    approvalIndex === -1 ||
    likesIndex === -1 ||
    dislikesIndex === -1 ||
    approvalIndex > likesIndex ||
    likesIndex > dislikesIndex
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["criteriaApplied"],
      message: "A decisão manual deve respeitar aprovação, likes e dislikes na ordem correta antes da escolha final.",
    });
  }
});

const GroupStageAdvanceInput = z.object({ championshipId: z.string().uuid() }).strict();

export async function recordGroupStageTieBreakDecision(db: Db, raw: unknown, userId: string) {
  const input = GroupStageTieDecisionInput.parse(raw);
  const championship = await loadChampionship(db, input.championshipId);
  if (championship.format !== 12 && championship.format !== 16) {
    fail("A fase de grupos só é válida para os formatos 12 e 16.");
  }
  if (!(["group_stage", "group_stage_completed"] as const).includes(championship.status as "group_stage" | "group_stage_completed")) {
    fail("A decisão manual só pode ser registrada durante a fase de grupos.");
  }
  if (input.tiedEntryIds.length !== input.chosenOrder.length) {
    fail("A ordem escolhida deve conter exatamente os mesmos participantes empatados.");
  }

  const { data, error } = await (db.rpc as any)("record_group_stage_tie_break", {
    p_championship_id: input.championshipId,
    p_group_letter: input.groupLetter ?? null,
    p_tied_entry_ids: input.tiedEntryIds,
    p_criteria_applied: input.criteriaApplied,
    p_decision_order: input.chosenOrder,
    p_rationale: input.rationale ?? null,
    p_operator_user_id: userId,
  });
  if (error) {
    console.error("[championship] group-stage tie decision failed", error);
    fail(error?.message ?? "Não foi possível registrar a decisão manual.");
  }
  return data;
}

export async function finalizeGroupStageAndGenerateQuarterFinals(db: Db, raw: unknown, userId: string) {
  const input = GroupStageAdvanceInput.parse(raw);
  const championship = await loadChampionship(db, input.championshipId);
  if (championship.status !== "group_stage") {
    fail("A classificação por grupos só pode ser finalizada enquanto o Campeonato estiver em group_stage.");
  }
  if (championship.format === 8) {
    fail("O formato 8 não possui fase de grupos.");
  }
  if (championship.format !== 12 && championship.format !== 16) {
    fail("Formato de Campeonato inválido.");
  }

  const { data, error } = await (db.rpc as any)("finalize_group_stage_and_generate_quarters", {
    p_championship_id: input.championshipId,
    p_operator_user_id: userId,
  });
  if (error) {
    console.error("[championship] group-stage finalization failed", error);
    fail(error?.message ?? "Não foi possível finalizar a fase de grupos.");
  }
  return data;
}

const DrawEntryColumns = "id, name, stage_name, group_letter, seed_number";

async function loadDrawEntries(db: Db, championshipId: string) {
  const id = z.string().uuid().parse(championshipId);
  const championship = await loadChampionship(db, id);
  if (["draft", "registration_open", "registration_closed"].includes(championship.status)) {
    fail("O sorteio deste Campeonato ainda não foi realizado.");
  }
  const { data, error } = await db
    .from("championship_entries")
    .select(DrawEntryColumns)
    .eq("championship_id", id)
    .not("seed_number", "is", null)
    .order("seed_number", { ascending: true });
  if (error) fail("Não foi possível carregar o resultado do sorteio.");
  if (!data || data.length !== championship.format || data.some((entry) => entry.seed_number === null)) {
    fail("O resultado do sorteio está incompleto.");
  }
  return { championship, entries: data };
}

/** Administrative draw result; only public participant identity and draw positions are selected. */
export async function getChampionshipDraw(db: Db, championshipId: string) {
  const { championship, entries } = await loadDrawEntries(db, championshipId);
  if (championship.format === 8) {
    return { championshipId: championship.id, format: championship.format, groups: [], entries };
  }
  const groupCount = championship.format / 4;
  const groups = Array.from({ length: groupCount }, (_, index) => {
    const letter = String.fromCharCode(65 + index);
    return {
      groupLetter: letter,
      entries: entries.filter((entry) => entry.group_letter === letter),
    };
  });
  if (groups.some((group) => group.entries.length !== 4)) {
    fail("O resultado do sorteio está incompleto.");
  }
  return { championshipId: championship.id, format: championship.format, groups, entries };
}

/** Presentation order is encoded by seed_number, interleaving each group's relative position. */
export async function getChampionshipSchedule(db: Db, championshipId: string) {
  const { championship, entries } = await loadDrawEntries(db, championshipId);
  const groupCount = championship.format === 8 ? null : championship.format / 4;
  const presentations = entries.map((entry) => ({
    ...entry,
    presentation_number: entry.seed_number!,
    group_position: groupCount === null ? null : Math.floor((entry.seed_number! - 1) / groupCount) + 1,
  }));

  if (championship.format !== 8) {
    if (entries.some((entry) => !entry.group_letter)) fail("O resultado do sorteio está incompleto.");
    return { championshipId: championship.id, format: championship.format, presentations, matches: [] };
  }

  const { data: matches, error } = await db
    .from("championship_matches")
    .select("id, match_number, entry_a_id, entry_b_id, status")
    .eq("championship_id", championship.id)
    .eq("stage", "quarter_final")
    .order("match_number", { ascending: true });
  if (error) fail("Não foi possível carregar o calendário das quartas de final.");
  if (!matches || matches.length !== 4 || matches.some((match) => !match.entry_a_id || !match.entry_b_id)) {
    fail("O calendário das quartas de final está incompleto.");
  }
  return { championshipId: championship.id, format: championship.format, presentations, matches };
}

export async function getChampionshipStandings(db: Db, championshipId: string) {
  const id = z.string().uuid().parse(championshipId);
  const championship = await loadChampionship(db, id);
  if (championship.format === 8) return { format: 8 as const, groups: [], thirdPlace: [], unresolvedTies: [], tieDecisions: [] };
  if (championship.format !== 12 && championship.format !== 16) fail("Formato de Campeonato inválido.");

  const { data: entries, error: entriesError } = await db
    .from("championship_entries")
    .select("id, name, stage_name, group_letter, seed_number, participant_id")
    .eq("championship_id", id)
    .eq("status", "confirmed")
    .not("seed_number", "is", null)
    .order("seed_number", { ascending: true });
  if (entriesError) fail("Não foi possível carregar os participantes sorteados.");
  if (!entries?.length) return { format: championship.format, groups: [], thirdPlace: [], unresolvedTies: [], tieDecisions: [] };

  const stageSession = await findStageSession(db, id);
  const participantIds = [...new Set(entries.flatMap((entry) => entry.participant_id ? [entry.participant_id] : []))];
  let performances: { id: string; participant_id: string }[] = [];
  if (stageSession && participantIds.length) {
    const { data, error } = await db
      .from("performances")
      .select("id, participant_id")
      .eq("session_id", stageSession.id)
      .in("participant_id", participantIds);
    if (error) fail("Não foi possível carregar as apresentações da fase de grupos.");
    performances = data ?? [];
  }

  const { data: matches, error: matchesError } = await db
    .from("championship_matches")
    .select("performance_a_id, performance_b_id")
    .eq("championship_id", id);
  if (matchesError) fail("Não foi possível identificar as apresentações das eliminatórias.");
  const eliminationPerformanceIds = new Set(
    (matches ?? []).flatMap((match) => [match.performance_a_id, match.performance_b_id].filter((value): value is string => !!value)),
  );
  const groupPerformances = performances.filter((performance) => !eliminationPerformanceIds.has(performance.id));
  const votesByPerformance = new Map<string, { likes: number; dislikes: number }>();
  if (groupPerformances.length) {
    const { data: votes, error } = await db
      .from("votes")
      .select("performance_id, vote_type")
      .in("performance_id", groupPerformances.map((performance) => performance.id));
    if (error) fail("Não foi possível carregar os votos da fase de grupos.");
    for (const vote of votes ?? []) {
      const tally = votesByPerformance.get(vote.performance_id) ?? { likes: 0, dislikes: 0 };
      if (vote.vote_type === "like") tally.likes += 1;
      if (vote.vote_type === "dislike") tally.dislikes += 1;
      votesByPerformance.set(vote.performance_id, tally);
    }
  }

  const tallyByParticipant = new Map<string, { likes: number; dislikes: number }>();
  for (const performance of groupPerformances) {
    const tally = votesByPerformance.get(performance.id);
    if (!tally) continue;
    const total = tallyByParticipant.get(performance.participant_id) ?? { likes: 0, dislikes: 0 };
    total.likes += tally.likes;
    total.dislikes += tally.dislikes;
    tallyByParticipant.set(performance.participant_id, total);
  }

  const { data: decisions, error: decisionsError } = await db
    .from("championship_group_stage_tie_decisions")
    .select("group_letter, tied_entry_ids, criteria_applied, chosen_order, rationale")
    .eq("championship_id", id);
  if (decisionsError) fail("Não foi possível carregar as decisões de desempate.");

  const standings = entries.map((entry) => {
    const tally = entry.participant_id ? tallyByParticipant.get(entry.participant_id) : undefined;
    const likes = tally?.likes ?? 0;
    const dislikes = tally?.dislikes ?? 0;
    const totalVotes = likes + dislikes;
    return {
      id: entry.id,
      name: entry.name,
      stageName: entry.stage_name,
      groupLetter: entry.group_letter,
      seedNumber: entry.seed_number!,
      likes,
      dislikes,
      approval: totalVotes ? (likes / totalVotes) * 100 : null,
      noVotes: totalVotes === 0,
    };
  });
  const scoreKey = (entry: (typeof standings)[number]) =>
    `${entry.approval ?? 0}:${entry.likes}:${entry.dislikes}`;
  const sameScore = (left: (typeof standings)[number], right: (typeof standings)[number]) =>
    left.approval === right.approval && left.likes === right.likes && left.dislikes === right.dislikes;
  const decisionFor = (groupLetter: string | null, tiedEntryIds: string[]) =>
    (decisions ?? []).find((decision) =>
      decision.group_letter === groupLetter &&
      decision.tied_entry_ids.length === tiedEntryIds.length &&
      decision.tied_entry_ids.every((entryId) => tiedEntryIds.includes(entryId)),
    );
  const unresolvedTies: {
    groupLetter: string | null;
    tiedEntryIds: string[];
    entries: { id: string; name: string; stageName: string | null }[];
    criteriaApplied: string[];
    rationale: string | null;
  }[] = [];

  const groups = Array.from({ length: championship.format / 4 }, (_, index) => {
    const groupLetter = String.fromCharCode(65 + index);
    const group = standings.filter((entry) => entry.groupLetter === groupLetter);
    const tieBuckets = new Map<string, typeof group>();
    for (const entry of group) {
      const bucket = tieBuckets.get(scoreKey(entry)) ?? [];
      bucket.push(entry);
      tieBuckets.set(scoreKey(entry), bucket);
    }
    for (const bucket of tieBuckets.values()) {
      if (bucket.length < 2) continue;
      const tiedEntryIds = bucket.map((entry) => entry.id).sort();
      const decision = decisionFor(groupLetter, tiedEntryIds);
      if (!decision) {
        unresolvedTies.push({
          groupLetter,
          tiedEntryIds,
          entries: bucket.map(({ id, name, stageName }) => ({ id, name, stageName })),
          criteriaApplied: ["approval", "likes", "dislikes"],
          rationale: null,
        });
      }
    }
    group.sort((left, right) => {
      const score = (right.approval ?? 0) - (left.approval ?? 0) ||
        right.likes - left.likes || left.dislikes - right.dislikes;
      if (score) return score;
      const decision = decisionFor(groupLetter, tieBuckets.get(scoreKey(left))?.map((entry) => entry.id).sort() ?? []);
      const leftRank = decision?.chosen_order.indexOf(left.id) ?? -1;
      const rightRank = decision?.chosen_order.indexOf(right.id) ?? -1;
      if (leftRank >= 0 && rightRank >= 0) return leftRank - rightRank;
      return left.seedNumber - right.seedNumber;
    });
    return {
      groupLetter,
      entries: group.map((entry, index) => {
        const prior = group[index - 1];
        const next = group[index + 1];
        const tiesPrior = !!prior && sameScore(entry, prior) &&
          !decisionFor(groupLetter, tieBuckets.get(scoreKey(entry))?.map((item) => item.id).sort() ?? []);
        const tiesNext = !!next && sameScore(entry, next) &&
          !decisionFor(groupLetter, tieBuckets.get(scoreKey(entry))?.map((item) => item.id).sort() ?? []);
        const tiedRange = group.filter((item) => sameScore(entry, item));
        const firstPosition = group.findIndex((item) => sameScore(entry, item)) + 1;
        const lastPosition = firstPosition + tiedRange.length - 1;
        return {
          ...entry,
          position: tiesPrior ? firstPosition : index + 1,
          tied: tiesPrior || tiesNext,
            qualified: (!tiesPrior && !tiesNext)
              ? index < 2
              : lastPosition <= 2 ? true : firstPosition > 2 ? false : null,
        };
      }),
    };
  });

  let thirdPlace: ((typeof standings)[number] & { groupPosition: number; qualified: boolean | null; tied: boolean })[] = [];
  if (championship.format === 12) {
    const thirdEntries = groups.flatMap((group) => {
      const entry = group.entries.find((candidate) => candidate.position === 3);
      return entry ? [{ ...entry, groupPosition: entry.position }] : [];
    });
    thirdEntries.sort((left, right) =>
      (right.approval ?? 0) - (left.approval ?? 0) ||
      right.likes - left.likes ||
      left.dislikes - right.dislikes ||
      left.groupLetter!.localeCompare(right.groupLetter!),
    );
    const tieBuckets = new Map<string, typeof thirdEntries>();
    for (const entry of thirdEntries) {
      const bucket = tieBuckets.get(scoreKey(entry)) ?? [];
      bucket.push(entry);
      tieBuckets.set(scoreKey(entry), bucket);
    }
    for (const bucket of tieBuckets.values()) {
      if (bucket.length < 2) continue;
      const tiedEntryIds = bucket.map((entry) => entry.id).sort();
      const decision = decisionFor(null, tiedEntryIds);
      if (!decision) {
        unresolvedTies.push({
          groupLetter: null,
          tiedEntryIds,
          entries: bucket.map(({ id, name, stageName }) => ({ id, name, stageName })),
          criteriaApplied: ["approval", "likes", "dislikes"],
          rationale: null,
        });
      } else {
        const order = new Map(decision.chosen_order.map((entryId, position) => [entryId, position]));
        bucket.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
      }
    }
    thirdEntries.sort((left, right) =>
      (right.approval ?? 0) - (left.approval ?? 0) ||
      right.likes - left.likes ||
      left.dislikes - right.dislikes ||
      ((decisionFor(null, tieBuckets.get(scoreKey(left))?.map((entry) => entry.id).sort() ?? [])?.chosen_order.indexOf(left.id) ?? -1) -
        (decisionFor(null, tieBuckets.get(scoreKey(right))?.map((entry) => entry.id).sort() ?? [])?.chosen_order.indexOf(right.id) ?? -1)) ||
      left.groupLetter!.localeCompare(right.groupLetter!),
    );
    thirdPlace = thirdEntries.map((entry, index) => {
      const tiedRange = thirdEntries.filter((item) => sameScore(entry, item));
      const firstPosition = thirdEntries.findIndex((item) => sameScore(entry, item)) + 1;
      const lastPosition = firstPosition + tiedRange.length - 1;
      const hasDecision = !!decisionFor(null, tieBuckets.get(scoreKey(entry))?.map((item) => item.id).sort() ?? []);
      return {
        ...entry,
        groupPosition: 3,
        position: hasDecision || tiedRange.length === 1 ? index + 1 : firstPosition,
        tied: tiedRange.length > 1 && !hasDecision,
        qualified: hasDecision || tiedRange.length === 1
          ? index < 2
          : lastPosition <= 2 ? true : firstPosition > 2 ? false : null,
      };
    });
  }
  const tieDecisions = (decisions ?? []).map((decision) => ({
    groupLetter: decision.group_letter,
    criteriaApplied: decision.criteria_applied,
    tiedEntryIds: decision.tied_entry_ids,
    tiedEntries: decision.tied_entry_ids.map((entryId) => {
      const entry = standings.find((candidate) => candidate.id === entryId);
      return { id: entryId, name: entry?.name ?? "Participante" };
    }),
    chosenOrder: decision.chosen_order.map((entryId) => {
      const entry = standings.find((candidate) => candidate.id === entryId);
      return { id: entryId, name: entry?.name ?? "Participante" };
    }),
    rationale: decision.rationale,
  }));
  return { format: championship.format, groups, thirdPlace, unresolvedTies, tieDecisions };
}

/** Elimination data is read only on the server after the championship operator check. */
export async function getChampionshipEliminationBoard(db: Db, championshipId: string) {
  const id = z.string().uuid().parse(championshipId);
  const championship = await loadChampionship(db, id);
  const { data: matches, error } = await db
    .from("championship_matches")
    .select("id, stage, match_number, entry_a_id, entry_b_id, performance_a_id, performance_b_id, status, voting_status, voting_ends_at, winner_entry_id")
    .eq("championship_id", id)
    .order("stage")
    .order("match_number");
  if (error) fail("Não foi possível carregar os confrontos eliminatórios.");
  const stageSession = await findStageSession(db, id);
  let participants: { id: string; name: string; stage_name: string | null; participant_number: number }[] = [];
  if (stageSession) {
    const { data, error: participantsError } = await db
      .from("participants")
      .select("id, name, stage_name, participant_number")
      .eq("session_id", stageSession.id)
      .order("participant_number", { ascending: true });
    if (participantsError) fail("Não foi possível carregar os cantores da sessão de palco.");
    participants = data ?? [];
  }
  let performances: { id: string; participant_id: string; status: string }[] = [];
  if (stageSession) {
    const { data, error: performanceError } = await db
      .from("performances")
      .select("id, participant_id, status")
      .eq("session_id", stageSession.id)
      .order("created_at", { ascending: true });
    if (performanceError) fail("Não foi possível carregar as apresentações da sessão de palco.");
    performances = data ?? [];
  }
  return { championship, stageSession, participants, matches: matches ?? [], performances };
}

async function countConfirmedEntries(db: Db, championshipId: string) {
  const { count, error } = await db
    .from("championship_entries")
    .select("id", { count: "exact", head: true })
    .eq("championship_id", championshipId)
    .eq("status", "confirmed");
  if (error) fail("Não foi possível verificar as vagas disponíveis.");
  return count ?? 0;
}

/** Administrative listing; caller must authorize against the championship's actual venue. */
export async function listChampionshipEntries(db: Db, championshipId: string) {
  const id = z.string().uuid().parse(championshipId);
  const { data, error } = await db
    .from("championship_entries")
    .select(
      "*, songs:championship_entry_songs(song_type, song_order, source:playback_sources(id, provider, external_id, title, channel_name, thumbnail_url, duration))",
    )
    .eq("championship_id", id)
    .order("created_at", { ascending: true });
  if (error) fail("Não foi possível carregar as inscrições.");
  return data ?? [];
}

export async function updateChampionship(db: Db, raw: unknown) {
  const { championshipId, patch } = UpdateChampionshipInput.parse(raw);
  const current = await loadChampionship(db, championshipId);
  if (!canEditChampionship(current.status)) fail("Este Campeonato não pode mais ser editado neste estado.");

  const formatChanges = patch.format !== undefined && patch.format !== current.format;
  if (formatChanges) {
    const reason = formatChangeBlockReason(current.status, await countEntries(db, championshipId));
    if (reason) fail(reason);
  }
  const deadline = patch.registrationDeadline !== undefined ? patch.registrationDeadline : current.registration_deadline;
  const starts = patch.eventStartsAt !== undefined ? patch.eventStartsAt : current.event_starts_at;
  assertCoherentDates(deadline, starts);

  // Whitelisted columns only: status is never writable here; format only when explicitly changed.
  const update: Database["public"]["Tables"]["championships"]["Update"] = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (formatChanges && patch.format !== undefined) update.format = patch.format;
  if (patch.eventStartsAt !== undefined) update.event_starts_at = patch.eventStartsAt;
  if (patch.registrationDeadline !== undefined) update.registration_deadline = patch.registrationDeadline;
  if (patch.location !== undefined) update.location = patch.location;
  if (patch.rules !== undefined) update.rules = patch.rules;
  if (patch.prizeInfo !== undefined) update.prize_info = patch.prizeInfo;
  if (patch.feeInfo !== undefined) update.fee_info = patch.feeInfo;
  if (Object.keys(update).length === 0) return current;

  // Optimistic guard: the row must still be in the state we validated against.
  const { data, error } = await db.from("championships").update(update)
    .eq("id", championshipId).eq("status", current.status).eq("format", current.format)
    .select(CHAMPIONSHIP_COLUMNS).maybeSingle();
  if (error) fail("Não foi possível atualizar o Campeonato.");
  if (!data) fail("O Campeonato foi alterado por outra operação. Recarregue e tente novamente.");
  return data!;
}

export const RegistrationTransitionInput = z.object({
  championshipId: z.string().uuid(),
}).strict();

const REGISTRATION_TRANSITIONS = {
  open: { from: "draft", to: "registration_open" },
  close: { from: "registration_open", to: "registration_closed" },
} as const;

export async function transitionChampionshipRegistration(
  db: Db,
  raw: unknown,
  action: keyof typeof REGISTRATION_TRANSITIONS,
) {
  const { championshipId } = RegistrationTransitionInput.parse(raw);
  const { from, to } = REGISTRATION_TRANSITIONS[action];
  const current = await loadChampionship(db, championshipId);
  if (current.status !== from) {
    fail(action === "open"
      ? "As inscrições só podem ser abertas para um Campeonato em rascunho."
      : "As inscrições só podem ser encerradas quando estiverem abertas.",
    );
  }

  const { data, error } = await db.from("championships").update({ status: to })
    .eq("id", championshipId).eq("status", from)
    .select(CHAMPIONSHIP_COLUMNS).maybeSingle();
  if (error) fail("Não foi possível alterar o estado das inscrições.");
  if (!data) fail("O Campeonato foi alterado por outra operação. Recarregue e tente novamente.");
  return data;
}

export async function startChampionshipGroupStage(db: Db, raw: unknown) {
  const input = z.object({
    championshipId: z.string().uuid(),
    venueId: z.string().uuid(),
  }).strict().parse(raw);
  const championship = await loadChampionship(db, input.championshipId);
  if (championship.venue_id !== input.venueId)
    fail("Este Campeonato pertence a outro estabelecimento.");
  if (championship.format !== 12 && championship.format !== 16)
    fail("A fase de grupos só existe nos formatos 12 e 16.");
  if (championship.status !== "drawn")
    fail("A fase de grupos só pode ser iniciada após o sorteio e uma única vez.");

  const stageSession = await findStageSession(db, championship.id);
  if (!stageSession)
    fail("Prepare a sessão de palco do Campeonato antes de iniciar a fase de grupos.");
  if (stageSession.status !== "draft" && stageSession.status !== "active")
    fail("A sessão de palco deste Campeonato já foi encerrada.");

  const { data: entries, error: entriesError } = await db
    .from("championship_entries")
    .select("id, group_letter, seed_number, participant_id")
    .eq("championship_id", championship.id)
    .eq("status", "confirmed");
  if (entriesError) fail("Não foi possível validar o sorteio do Campeonato.");

  const confirmedEntries = entries ?? [];
  const validGroups = new Set(["A", "B", "C", "D"].slice(0, championship.format / 4));
  const validDraw =
    confirmedEntries.length === championship.format &&
    confirmedEntries.every(
      (entry) =>
        !!entry.group_letter &&
        validGroups.has(entry.group_letter) &&
        !!entry.participant_id &&
        entry.seed_number !== null &&
        entry.seed_number >= 1 &&
        entry.seed_number <= championship.format,
    ) &&
    new Set(confirmedEntries.map((entry) => entry.seed_number)).size === championship.format &&
    new Set(confirmedEntries.map((entry) => entry.participant_id)).size === championship.format &&
    [...validGroups].every(
      (group) => confirmedEntries.filter((entry) => entry.group_letter === group).length === 4,
    );
  if (!validDraw)
    fail("O sorteio está incompleto ou inválido. Verifique os grupos e as posições antes de continuar.");

  const participantIds = confirmedEntries.flatMap((entry) =>
    entry.participant_id ? [entry.participant_id] : [],
  );
  const { count: linkedParticipants, error: participantError } = await db
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", stageSession.id)
    .in("id", participantIds);
  if (participantError) fail("Não foi possível verificar os cantores da sessão de palco.");
  if (linkedParticipants !== championship.format) {
    fail("Associe cada inscrição confirmada a um cantor da sessão de palco antes de iniciar os grupos.");
  }

  const { data, error } = await db
    .from("championships")
    .update({ status: "group_stage" })
    .eq("id", championship.id)
    .eq("venue_id", input.venueId)
    .eq("status", "drawn")
    .eq("format", championship.format)
    .select(CHAMPIONSHIP_COLUMNS)
    .maybeSingle();
  if (error) fail("Não foi possível iniciar a fase de grupos.");
  if (!data)
    fail("O Campeonato foi alterado por outra operação. Recarregue e tente novamente.");
  return data;
}

/** Idempotent: returns the existing stage session or creates exactly one (draft, never active). */
export async function prepareStageSession(db: Db, raw: unknown) {
  const input = z.object({ championshipId: z.string().uuid(), venueId: z.string().uuid() }).strict().parse(raw);
  const championship = await loadChampionship(db, input.championshipId);
  if (championship.venue_id !== input.venueId) fail("Este Campeonato pertence a outro estabelecimento.");
  if (!STAGE_PREPARABLE_STATUSES.includes(championship.status as ChampionshipStatus)) fail("Não é possível preparar o palco de um Campeonato concluído ou cancelado.");

  const existing = await findStageSession(db, championship.id);
  if (existing) return { session: existing, created: false };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    // public_code comes from the column default, the same mechanism used by every session.
    const { data, error } = await db.from("sessions").insert({
      name: `Campeonato · ${championship.title}`.slice(0, 120), status: "draft",
      session_type: "championship", voting_mode: "like_dislike",
      venue_id: championship.venue_id, championship_id: championship.id,
    }).select(STAGE_COLUMNS).single();
    if (!error && data) return { session: data, created: true };
    if (error?.code !== "23505") fail("Não foi possível preparar a sessão de palco.");
    // Unique conflict: either a concurrent call won (sessions_championship_unique) or a public_code collision.
    const winner = await findStageSession(db, championship.id);
    if (winner) return { session: winner, created: false };
  }
  return fail("Não foi possível preparar a sessão de palco. Tente novamente.");
}

/** Explicit start of the stage session. Never ends another session; never changes the event status. */
export async function activateStageSession(db: Db, raw: unknown) {
  const input = z.object({ championshipId: z.string().uuid(), sessionId: z.string().uuid(), venueId: z.string().uuid(),
    }).strict().parse(raw);
  const championship = await loadChampionship(db, input.championshipId);
  if (championship.venue_id !== input.venueId) fail("Este Campeonato pertence a outro estabelecimento.");

  const { data: session } = await db.from("sessions").select(STAGE_COLUMNS).eq("id", input.sessionId).maybeSingle();
  if (!session) fail("Sessão de palco não encontrada.");
  if (session!.session_type !== "championship" || session!.championship_id !== championship.id || session!.venue_id !== championship.venue_id) {
    fail("Esta sessão não é a sessão de palco deste Campeonato.");
  }
  if (session!.status === "active") return session!;
  if (session!.status !== "draft") fail("A sessão de palco já foi encerrada.");
  if (!canActivateStage(championship.status)) fail("A competição ainda não pode começar: o sorteio não foi realizado.");

  const { data: other } = await db.from("sessions").select("id").eq("venue_id", championship.venue_id).eq("status", "active").neq("id", session!.id).limit(1);
  if (other?.length) fail("Já existe outra sessão ativa neste estabelecimento. Encerre-a antes de iniciar o Campeonato.",
    );

  const { data, error } = await db.from("sessions").update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", session!.id).eq("status", "draft").select(STAGE_COLUMNS).maybeSingle();
  if (error?.code === "23505") fail("Já existe outra sessão ativa neste estabelecimento. Encerre-a antes de iniciar o Campeonato.",
    );
  if (error || !data) fail("Não foi possível iniciar a sessão de palco.");
  return data!;
}

const MatchIdInput = z.object({ matchId: z.string().uuid() }).strict();
const MatchSlotInput = z.object({
  matchId: z.string().uuid(),
  slot: z.enum(["a", "b"]),
}).strict();
const MatchPerformancesInput = z.object({
  matchId: z.string().uuid(),
  performanceAId: z.string().uuid(),
  performanceBId: z.string().uuid(),
}).strict();
const MatchWoInput = z.object({
  matchId: z.string().uuid(),
  withdrawnEntryId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
}).strict();
const MatchVoteInput = z.object({
  code: z.string().trim().min(4).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  chosenEntryId: z.string().uuid(),
  token: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
}).strict();

function championshipRpcError(error: { message?: string } | null, fallback: string) {
  if (error) fail(error.message || fallback);
}

export async function linkChampionshipEntryParticipant(db: Db, raw: unknown, operatorUserId: string) {
  const input = z.object({
    championshipId: z.string().uuid(),
    entryId: z.string().uuid(),
    participantId: z.string().uuid(),
  }).strict().parse(raw);
  const { data, error } = await db.rpc("link_championship_entry_participant", {
    p_entry_id: input.entryId,
    p_participant_id: input.participantId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível associar o cantor à inscrição.");
  return data;
}

export async function getChampionshipMatchChampionshipId(db: Db, rawMatchId: unknown) {
  const { matchId } = MatchIdInput.parse({ matchId: rawMatchId });
  const { data, error } = await db
    .from("championship_matches")
    .select("championship_id")
    .eq("id", matchId)
    .maybeSingle();
  if (error) fail("Não foi possível carregar o confronto do Campeonato.");
  if (!data) fail("Confronto do Campeonato não encontrado.");
  return data.championship_id;
}

export async function setChampionshipMatchPerformances(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchPerformancesInput.parse(raw);
  const { data, error } = await db.rpc("set_championship_match_performances", {
    p_match_id: input.matchId,
    p_performance_a_id: input.performanceAId,
    p_performance_b_id: input.performanceBId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível associar as apresentações ao confronto.");
  return data;
}

export async function startChampionshipMatch(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchIdInput.parse(raw);
  const { data, error } = await db.rpc("start_championship_match", {
    p_match_id: input.matchId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível iniciar o confronto.");
  return data;
}

export async function startChampionshipPresentation(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchSlotInput.parse(raw);
  const { data, error } = await db.rpc("start_championship_presentation", {
    p_match_id: input.matchId,
    p_slot: input.slot,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível iniciar a apresentação.");
  return data;
}

export async function completeChampionshipPresentation(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchSlotInput.parse(raw);
  const { data, error } = await db.rpc("complete_championship_presentation", {
    p_match_id: input.matchId,
    p_slot: input.slot,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível concluir a apresentação.");
  return data;
}

export async function openChampionshipMatchVoting(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchIdInput.parse(raw);
  const { data, error } = await db.rpc("open_championship_match_voting", {
    p_match_id: input.matchId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível abrir a votação do confronto.");
  return data;
}

export async function closeChampionshipMatchVoting(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchIdInput.parse(raw);
  const { data, error } = await db.rpc("close_championship_match_voting", {
    p_match_id: input.matchId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível encerrar a votação do confronto.");
  return data;
}

async function hashChampionshipVoterToken(sessionId: string, token: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${sessionId}:${token}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolvePublicChampionshipSession(db: Db, code: string) {
  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id")
    .eq("slug", code)
    .maybeSingle();
  if (venueError) fail("Não foi possível localizar o estabelecimento.");

  const sessionQuery = db
    .from("sessions")
    .select("id, status, session_type, championship_id")
    .eq("status", "active");
  const { data: session, error: sessionError } = venue
    ? await sessionQuery.eq("venue_id", venue.id).maybeSingle()
    : await sessionQuery.eq("public_code", code).maybeSingle();
  if (sessionError) fail("Não foi possível localizar a sessão do Campeonato.");
  if (
    !session ||
    session.session_type !== "championship" ||
    !session.championship_id
  )
    return null;

  const { data: championship, error: championshipError } = await db
    .from("championships")
    .select("status")
    .eq("id", session.championship_id)
    .maybeSingle();
  if (championshipError) fail("Não foi possível verificar a fase do Campeonato.");
  if (!championship) fail("Campeonato não encontrado.");
  return { session, championshipId: session.championship_id, championshipStatus: championship.status };
}

async function currentPublicEliminationMatch(db: Db, code: string) {
  const resolved = await resolvePublicChampionshipSession(db, code);
  if (!resolved) return null;
  const stage =
    resolved.championshipStatus === "quarter_finals"
      ? "quarter_final"
      : resolved.championshipStatus === "semi_finals"
        ? "semi_final"
        : resolved.championshipStatus === "final"
          ? "final"
          : null;
  if (!stage) return null;

  const { data: match, error } = await db
    .from("championship_matches")
    .select("id, entry_a_id, entry_b_id, voting_status, voting_ends_at, status")
    .eq("championship_id", resolved.championshipId)
    .eq("stage", stage)
    .eq("status", "in_progress")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("Não foi possível localizar o confronto atual.");
  return match ? { ...resolved, match } : null;
}

export async function getPublicChampionshipVoterStatus(db: Db, raw: unknown) {
  const input = z.object({
    code: z.string().trim().min(4).max(40).regex(/^[a-zA-Z0-9_-]+$/),
    token: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  }).strict().parse(raw);
  const current = await currentPublicEliminationMatch(db, input.code);
  if (!current) return { matchId: null, hasVoted: false, serverNow: Date.now() };

  const tokenHash = await hashChampionshipVoterToken(current.session.id, input.token);
  const { data: voter, error: voterError } = await db
    .from("voter_sessions")
    .select("id")
    .eq("session_id", current.session.id)
    .eq("voter_token_hash", tokenHash)
    .maybeSingle();
  if (voterError) fail("Não foi possível verificar o dispositivo votante.");
  if (!voter)
    return { matchId: current.match.id, hasVoted: false, serverNow: Date.now() };

  const { count, error: voteError } = await db
    .from("championship_match_votes")
    .select("id", { count: "exact", head: true })
    .eq("match_id", current.match.id)
    .eq("voter_session_id", voter.id);
  if (voteError) fail("Não foi possível verificar o voto do confronto.");
  return { matchId: current.match.id, hasVoted: (count ?? 0) > 0, serverNow: Date.now() };
}

export async function castChampionshipMatchVote(db: Db, raw: unknown) {
  const input = MatchVoteInput.parse(raw);
  const current = await currentPublicEliminationMatch(db, input.code);
  if (!current) fail("Não há votação eliminatória disponível nesta sessão.");

  const tokenHash = await hashChampionshipVoterToken(current.session.id, input.token);
  const { data, error } = await db.rpc("cast_championship_match_vote", {
    p_match_id: current.match.id,
    p_chosen_entry_id: input.chosenEntryId,
    p_voter_token_hash: tokenHash,
  });
  championshipRpcError(error, "Não foi possível registrar o voto.");
  const result = z.object({
    result: z.enum(["ok", "already_voted"]),
    match_id: z.string().uuid(),
  }).strict().safeParse(data);
  if (!result.success || result.data.match_id !== current.match.id) {
    console.error("[championship] public match vote returned an invalid result", result.success ? data : result.error);
    return fail("Não foi possível confirmar o voto.");
  }
  return { result: result.data.result, matchId: result.data.match_id };
}

const MatchScoreResult = z.object({
  match_id: z.string().uuid(),
  stage: z.enum(["quarter_final", "semi_final", "final"]),
  match_number: z.number().int(),
  entry_a_id: z.string().uuid(),
  entry_b_id: z.string().uuid(),
  winner_entry_id: z.string().uuid().nullable(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "wo"]),
  voting_status: z.enum(["idle", "open", "closed"]),
  voting_ends_at: z.string().datetime({ offset: true }).nullable(),
  votes_a: z.number().int().nonnegative(),
  votes_b: z.number().int().nonnegative(),
  result: z.enum(["pending", "winner", "tie", "no_votes"]),
  is_final: z.boolean(),
  venue_id: z.string().uuid(),
}).strict();

export async function getChampionshipMatchScore(db: Db, raw: unknown, operatorUserId: string) {
  const { matchId } = MatchIdInput.parse({ matchId: raw });
  const { data, error } = await db.rpc("get_championship_match_score", {
    p_match_id: matchId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível carregar o placar do confronto.");
  const result = MatchScoreResult.safeParse(data);
  if (!result.success) {
    console.error("[championship] match score returned an invalid result", result.error);
    return fail("Não foi possível carregar o placar do confronto.");
  }
  return {
    matchId: result.data.match_id,
    stage: result.data.stage,
    matchNumber: result.data.match_number,
    entryAId: result.data.entry_a_id,
    entryBId: result.data.entry_b_id,
    votesA: result.data.votes_a,
    votesB: result.data.votes_b,
    votingStatus: result.data.voting_status,
    votingEndsAt: result.data.voting_ends_at,
    status: result.data.status,
    result: result.data.result,
    winnerEntryId: result.data.winner_entry_id,
    isFinal: result.data.is_final,
  };
}

export async function advanceChampionshipElimination(db: Db, raw: unknown, operatorUserId: string) {
  const { championshipId } = GroupStageAdvanceInput.parse(raw);
  const { data, error } = await db.rpc("advance_championship_elimination", {
    p_championship_id: championshipId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível gerar a próxima fase.");
  return data;
}

export async function recordChampionshipMatchWo(db: Db, raw: unknown, operatorUserId: string) {
  const input = MatchWoInput.parse(raw);
  const { data, error } = await db.rpc("record_championship_match_wo", {
    p_match_id: input.matchId,
    p_withdrawn_entry_id: input.withdrawnEntryId,
    p_reason: input.reason,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível registrar o WO.");
  return data;
}

export async function completeChampionship(db: Db, raw: unknown, operatorUserId: string) {
  const { championshipId } = GroupStageAdvanceInput.parse(raw);
  const { data, error } = await db.rpc("complete_championship", {
    p_championship_id: championshipId,
    p_operator_user_id: operatorUserId,
  });
  championshipRpcError(error, "Não foi possível encerrar o Campeonato.");
  return data;
}
