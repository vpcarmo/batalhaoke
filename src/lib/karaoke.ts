import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

// Narrowed DB enums (values are enforced by database CHECK constraints).
export type SessionType = "free" | "x1" | "championship";
type DatabaseVotingMode = "like_only" | "like_dislike";
type DatabaseMatchStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
import type { PlaybackSearchResult } from "@/lib/playback/types";

export type Session = Omit<Tables<"sessions">, "session_type" | "voting_mode"> & { session_type: SessionType; voting_mode: DatabaseVotingMode };
export type VotingMode = DatabaseVotingMode;
export type Participant = Tables<"participants">;
export type Match = Tables<"matches">;
export type MatchStatus = DatabaseMatchStatus;
export type MatchSlot = "a" | "b";
export type PlaybackSource = Tables<"playback_sources">;
export type Performance = Tables<"performances"> & { participant: Participant | null; source: PlaybackSource | null };

export const displayName = (p: Pick<Participant, "name" | "stage_name">) => (p.stage_name?.trim() || p.name).toUpperCase();

function fail(error: { message: string } | null, what: string): asserts error is null {
  if (error) throw new Error(`${what}: ${error.message.includes("fetch") ? "servidor indisponível" : error.message}`);
}

export async function getActiveSession(): Promise<Session | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("status", "active").order("started_at", { ascending: false }).limit(1).maybeSingle();
  fail(error, "Erro ao carregar sessão");
  return data as Session | null;
}

export async function createSession(name: string, options: { sessionType?: SessionType; votingMode?: VotingMode } = {}): Promise<Session> {
  const sessionType = options.sessionType ?? "free";
  if (sessionType !== "free" && options.votingMode === "like_only") {
    throw new Error("Este formato exige votação com Gostei / Não gostei");
  }
  const votingMode = sessionType === "free" ? options.votingMode ?? "like_only" : "like_dislike";
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("sessions").insert({ name, status: "active", started_at: now, session_type: sessionType, voting_mode: votingMode }).select().single();
  fail(error, "Erro ao criar sessão");
  return data as Session;
}

export async function finishSession(id: string) {
  const { error } = await supabase.from("sessions").update({ status: "finished", ended_at: new Date().toISOString() }).eq("id", id);
  fail(error, "Erro ao encerrar sessão");
}

export async function getSession(id: string): Promise<Session | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
  fail(error, "Erro ao carregar sessão");
  return data as Session | null;
}

/** Public lookup by the permanent QR code (unique per session → establishments never mix). */
export async function getSessionByCode(code: string): Promise<Session | null> {
  const { data, error } = await supabase.from("sessions").select("*").eq("public_code", code).maybeSingle();
  fail(error, "Erro ao carregar sessão");
  return data as Session | null;
}

export async function updateSessionDisplay(id: string, patch: { tv_enabled?: boolean; show_qr_on_tv?: boolean; voting_mode?: VotingMode }) {
  if (patch.voting_mode) {
    const { data: session, error: sessionError } = await supabase.from("sessions").select("session_type, status").eq("id", id).maybeSingle();
    fail(sessionError, "Erro ao carregar sessão");
    if (!session) throw new Error("Sessão não encontrada");
    if (session.status !== "draft") throw new Error("O modo de votação não pode ser alterado após o início da sessão");
    if (session.session_type !== "free" && patch.voting_mode !== "like_dislike") {
      throw new Error("Este formato exige votação com Gostei / Não gostei");
    }
  }
  const { error } = await supabase.from("sessions").update(patch).eq("id", id);
  fail(error, "Erro ao salvar configuração");
}

/** Anonymous per-browser voter token (no personal data). */
export function getVoterToken(): string {
  const k = "ka-voter-token";
  let t = localStorage.getItem(k);
  if (!t) { t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""); localStorage.setItem(k, t); }
  return t;
}

export async function listParticipants(sessionId: string): Promise<Participant[]> {
  const { data, error } = await supabase.from("participants").select("*").eq("session_id", sessionId).order("participant_number");
  fail(error, "Erro ao carregar cantores");
  return data ?? [];
}

/** X1 confrontations are read directly by the operator panel; writes stay server-side. */
export async function listMatches(sessionId: string): Promise<Match[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at");
  fail(error, "Erro ao carregar confrontos");
  return data ?? [];
}

export async function addParticipant(sessionId: string, name: string, stageName: string): Promise<Participant> {
  const { data, error } = await supabase
    .from("participants")
    .insert({ session_id: sessionId, name: name.trim(), stage_name: stageName.trim() || null, participant_number: 0 })
    .select()
    .single();
  fail(error, "Erro ao cadastrar cantor");
  return data!;
}

export async function listPerformances(sessionId: string): Promise<Performance[]> {
  const { data, error } = await supabase
    .from("performances")
    .select("*, participant:participants(*), source:playback_sources(*)")
    .eq("session_id", sessionId)
    .order("created_at");
  fail(error, "Erro ao carregar apresentações");
  return (data ?? []) as Performance[];
}

async function ensurePlaybackSource(r: PlaybackSearchResult): Promise<PlaybackSource> {
  const found = await supabase.from("playback_sources").select("*").eq("provider", r.provider).eq("external_id", r.externalId).maybeSingle();
  fail(found.error, "Erro ao buscar playback");
  if (found.data) return found.data;
  const { data, error } = await supabase
    .from("playback_sources")
    .insert({ provider: r.provider, external_id: r.externalId, title: r.title, channel_name: r.channelName, thumbnail_url: r.thumbnailUrl, duration: r.duration, metadata: r.metadata as never })
    .select()
    .single();
  fail(error, "Erro ao salvar playback");
  return data!;
}

export async function createPerformance(sessionId: string, participantId: string, r: PlaybackSearchResult) {
  const src = await ensurePlaybackSource(r);
  const { data, error } = await supabase.from("performances").insert({ session_id: sessionId, participant_id: participantId, playback_source_id: src.id, status: "queued" }).select().single();
  fail(error, "Erro ao criar apresentação");
  return data!;
}

export async function setPerformanceStatus(id: string, status: "active" | "completed" | "cancelled") {
  const now = new Date().toISOString();
  const patch = status === "active" ? { status, started_at: now } : { status, ended_at: now };
  let q = supabase.from("performances").update(patch).eq("id", id);
  if (status !== "active") q = q.eq("status", "active"); // idempotent: only close an active one
  const { error } = await q;
  fail(error, "Erro ao atualizar apresentação");
}

export async function getApiStats() {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { data, count } = await supabase
    .from("provider_api_calls")
    .select("*", { count: "exact" })
    .eq("provider", "youtube").eq("endpoint", "search.list").eq("cached", false)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false }).limit(1);
  return { todayCalls: count ?? 0, last: data?.[0] ?? null };
}

/** Realtime broadcast channel for operator → TV playback commands. */
export const commandChannel = (sessionId: string) => `session-cmd:${sessionId}`;
