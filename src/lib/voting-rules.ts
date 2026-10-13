import type { SessionType, VotingMode, X1VotingMode } from "./karaoke";

type PublicVoteContext = {
  status: string;
  session_type: SessionType;
  x1_voting_mode: X1VotingMode;
  voting_mode: VotingMode;
};

export function publicVoteRejection(
  session: PublicVoteContext,
  voteType: "like" | "dislike",
): "session_closed" | "voting_disabled" | "vote_not_allowed" | null {
  if (session.status !== "active") return "session_closed";
  if (session.session_type === "x1" && session.x1_voting_mode === "after_both_performances")
    return "voting_disabled";
  if (voteType === "dislike" && session.voting_mode !== "like_dislike") return "vote_not_allowed";
  return null;
}

type X1MatchVoteContext = {
  status: string;
  voting_status: string;
  voting_ends_at: string | null;
  participant_a_id: string;
  participant_b_id: string;
};

export function x1MatchVoteRejection(
  match: X1MatchVoteContext,
  chosenParticipantId: string,
  now: number,
): "invalid_choice" | "voting_closed" | null {
  if (![match.participant_a_id, match.participant_b_id].includes(chosenParticipantId))
    return "invalid_choice";
  if (
    match.status !== "in_progress" ||
    match.voting_status !== "open" ||
    !match.voting_ends_at ||
    new Date(match.voting_ends_at).getTime() <= now
  )
    return "voting_closed";
  return null;
}
