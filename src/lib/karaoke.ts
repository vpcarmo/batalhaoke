import type { Tables } from "@/integrations/supabase/types";
import {
  addKaraokeParticipant,
  createKaraokePerformance,
  createKaraokeSession,
  finishKaraokeSession,
  getAuthorizedApiStats,
  getOperatorActiveSession,
  setKaraokePerformanceStatus,
  updateKaraokeSession,
} from "@/lib/karaoke.functions";

// Narrowed DB enums (values are enforced by database CHECK constraints).
export type SessionType = "free" | "x1" | "championship";
type DatabaseVotingMode = "like_only" | "like_dislike";
export type X1VotingMode = "during_performance" | "after_both_performances";
type DatabaseMatchStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
import type { PlaybackSearchResult } from "@/lib/playback/types";

export type Session = Omit<
  Tables<"sessions">,
  "session_type" | "voting_mode" | "x1_voting_mode"
> & { session_type: SessionType; voting_mode: DatabaseVotingMode; x1_voting_mode: X1VotingMode };
export type VotingMode = DatabaseVotingMode;
export type Participant = Tables<"participants">;
export type Match = Tables<"matches">;
export type MatchStatus = DatabaseMatchStatus;
export type MatchSlot = "a" | "b";
export type PlaybackSource = Tables<"playback_sources">;
export type Performance = Tables<"performances"> & {
  participant: Participant | null;
  source: PlaybackSource | null;
};

export const displayName = (p: Pick<Participant, "name" | "stage_name">) =>
  (p.stage_name?.trim() || p.name).toUpperCase();

export async function getActiveSession(): Promise<Session | null> {
  return (await getOperatorActiveSession()) as Session | null;
}

export async function createSession(
  name: string,
  options: {
    sessionType?: SessionType;
    votingMode?: VotingMode;
    venueId: string;
    x1VotingMode?: X1VotingMode;
  },
): Promise<Session> {
  const venueId = options.venueId.trim();
  if (!venueId) throw new Error("Selecione ou crie um estabelecimento antes de iniciar a sessão.");
  const sessionType = options.sessionType ?? "free";
  if (sessionType !== "free" && options.votingMode === "like_only") {
    throw new Error("Este formato exige votação com Gostei / Não gostei");
  }
  return (await createKaraokeSession({
    data: {
      name,
      venueId,
      sessionType,
      votingMode: sessionType === "free" ? (options.votingMode ?? "like_only") : "like_dislike",
      x1VotingMode: options.x1VotingMode ?? "during_performance",
    },
  })) as Session;
}

export async function finishSession(id: string) {
  await finishKaraokeSession({ data: { sessionId: id } });
}

export async function updateSessionDisplay(
  id: string,
  patch: { tv_enabled?: boolean; show_qr_on_tv?: boolean; voting_mode?: VotingMode },
) {
  await updateKaraokeSession({ data: { sessionId: id, patch } });
}

/** Anonymous per-browser voter token (no personal data). */
export function getVoterToken(): string {
  const k = "ka-voter-token";
  let t = localStorage.getItem(k);
  if (!t) {
    t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem(k, t);
  }
  return t;
}

export async function addParticipant(
  sessionId: string,
  name: string,
  stageName: string,
): Promise<Participant> {
  return await addKaraokeParticipant({ data: { sessionId, name, stageName } });
}

export async function createPerformance(
  sessionId: string,
  participantId: string,
  r: PlaybackSearchResult,
) {
  return await createKaraokePerformance({ data: { sessionId, participantId, playback: r } });
}

export async function setPerformanceStatus(
  id: string,
  status: "active" | "completed" | "cancelled",
) {
  await setKaraokePerformanceStatus({ data: { performanceId: id, status } });
}

export async function getApiStats(sessionId: string) {
  return await getAuthorizedApiStats({ data: { sessionId } });
}

/** Realtime broadcast channel for operator → TV playback commands. */
export const commandChannel = (sessionId: string) => `session-cmd:${sessionId}`;
