// Championship event domain (Etapa 2). SERVER-ONLY: every function receives a
// privileged client and must only be called after the caller is authorized.
// It is intentionally NOT exposed through createServerFn yet — the project has
// no verifiable operator authorization (MVP without login), so publishing these
// mutations as RPC endpoints would make them public and unrestricted.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export const CHAMPIONSHIP_STATUSES = [
  "draft", "registration_open", "registration_closed", "drawn", "group_stage",
  "group_stage_completed", "quarter_finals", "semi_finals", "final", "completed", "cancelled",
] as const;
export type ChampionshipStatus = (typeof CHAMPIONSHIP_STATUSES)[number];
export const CHAMPIONSHIP_FORMATS = [8, 12, 16] as const;

/** Basic data may be edited only before registrations close. */
export const EDITABLE_STATUSES: readonly ChampionshipStatus[] = ["draft", "registration_open"];
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
  const { data: venue } = await db.from("venues").select("id").eq("id", input.venueId).maybeSingle();
  if (!venue) fail("Estabelecimento não encontrado.");
  const { data, error } = await db.from("championships").insert({
    venue_id: input.venueId, title: input.title, format: input.format, status: "draft",
    event_starts_at: input.eventStartsAt ?? null, registration_deadline: input.registrationDeadline ?? null,
    location: input.location, rules: input.rules, prize_info: input.prizeInfo, fee_info: input.feeInfo,
  }).select(CHAMPIONSHIP_COLUMNS).single();
  if (error || !data) fail("Não foi possível criar o Campeonato.");
  return data!;
}

/** Administrative view: event data + stage session summary. Never includes entry contacts. */
export async function getChampionship(db: Db, championshipId: string) {
  const championship = await loadChampionship(db, z.string().uuid().parse(championshipId));
  const [entryCount, stageSession] = await Promise.all([countEntries(db, championship.id), findStageSession(db, championship.id)]);
  return { championship, entryCount, stageSession };
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
  const input = z.object({ championshipId: z.string().uuid(), sessionId: z.string().uuid(), venueId: z.string().uuid() }).strict().parse(raw);
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
  if (other?.length) fail("Já existe outra sessão ativa neste estabelecimento. Encerre-a antes de iniciar o Campeonato.");

  const { data, error } = await db.from("sessions").update({ status: "active", started_at: new Date().toISOString() })
    .eq("id", session!.id).eq("status", "draft").select(STAGE_COLUMNS).maybeSingle();
  if (error?.code === "23505") fail("Já existe outra sessão ativa neste estabelecimento. Encerre-a antes de iniciar o Campeonato.");
  if (error || !data) fail("Não foi possível iniciar a sessão de palco.");
  return data!;
}
