import type { Match, Participant } from "@/lib/karaoke";

export function getX1CompetitionState(matches: Match[], participants: Participant[]) {
  const byId = (participantId: string) => participants.find((participant) => participant.id === participantId);
  const completed = matches.filter((match) => match.status === "completed" && match.winner_participant_id);
  const eliminatedIds = new Set<string>();
  for (const match of completed) {
    if (match.participant_a_id !== match.winner_participant_id) eliminatedIds.add(match.participant_a_id);
    if (match.participant_b_id !== match.winner_participant_id) eliminatedIds.add(match.participant_b_id);
  }
  const withdrawnIds = new Set<string>();
  for (const match of matches) {
    if (match.status !== "cancelled") continue;
    if (match.withdrawn_slot === "a" || match.withdrawn_slot === "both") withdrawnIds.add(match.participant_a_id);
    if (match.withdrawn_slot === "b" || match.withdrawn_slot === "both") withdrawnIds.add(match.participant_b_id);
  }
  const latestCompleted = completed.at(-1);
  const currentChampion = latestCompleted?.winner_participant_id
    && !eliminatedIds.has(latestCompleted.winner_participant_id)
    && !withdrawnIds.has(latestCompleted.winner_participant_id)
    ? byId(latestCompleted.winner_participant_id)
    : undefined;
  const openMatches = matches.filter((match) => match.status === "scheduled" || match.status === "in_progress");
  const activeCompetitorIds = new Set(openMatches.flatMap((match) => [match.participant_a_id, match.participant_b_id]));
  const waitingQueue = [...participants]
    .filter((participant) => !eliminatedIds.has(participant.id)
      && !withdrawnIds.has(participant.id)
      && participant.id !== currentChampion?.id
      && !activeCompetitorIds.has(participant.id))
    .sort((a, b) => a.participant_number - b.participant_number);
  const [firstA, firstB] = waitingQueue;
  const firstPair = !currentChampion && openMatches.length === 0 && firstA && firstB
    ? { a: firstA, b: firstB, first: completed.length === 0 }
    : null;
  const nextChallenger = waitingQueue[0];
  const currentMatch = openMatches.find((match) => match.status === "in_progress")
    ?? openMatches.find((match) => match.status === "scheduled");
  let championWinStreak = 0;
  if (currentChampion) {
    for (const match of [...completed].reverse()) {
      if (match.winner_participant_id !== currentChampion.id) break;
      championWinStreak += 1;
    }
  }

  return {
    completed,
    currentChampion,
    championWinStreak,
    currentMatch,
    eliminatedIds,
    firstPair,
    latestCompleted,
    nextChallenger,
    openMatches,
    waitingQueue,
    activeCompetitorIds,
    withdrawnIds,
  };
}
