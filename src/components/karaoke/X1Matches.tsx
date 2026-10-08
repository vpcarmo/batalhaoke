import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Swords, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { displayName, getSession, type Match, type Participant, type Performance } from "@/lib/karaoke";
import { cancelMatch, closeX1MatchVoting, confirmMatchWinner, createMatch, createMatchPerformance, getX1MatchTally, openX1MatchVoting, startMatch, updateX1VotingMode } from "@/lib/x1.functions";
import { useVoteCountdown } from "@/hooks/use-vote-countdown";
import { getX1CompetitionState } from "@/lib/x1-state";
import { MusicSearch } from "@/components/karaoke/MusicSearch";
import type { PlaybackSearchResult } from "@/lib/playback/types";

const statusLabel: Record<string, string> = { scheduled: "Agendado", in_progress: "Em andamento", completed: "Concluído", cancelled: "Cancelado" };

export const matchesKey = (sessionId: string) => ["matches", sessionId];

/** X1 confrontations panel. Reads matches; all writes go through x1 server functions. */
export function X1Matches(props: {
  sessionId: string; sessionStatus: string; participants: Participant[]; perfs: Performance[]; hasActive: boolean; busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
}) {
  const { sessionId, participants, perfs } = props;
  const [matchToCancel, setMatchToCancel] = useState<Match | null>(null);
  const byId = (pid: string) => participants.find((participant) => participant.id === pid);
  const matches = useQuery({
    queryKey: matchesKey(sessionId),
    queryFn: async () => {
      const { data, error } = await supabase.from("matches").select("*").eq("session_id", sessionId).order("created_at");
      if (error) throw error;
      return data as Match[];
    },
  });
  const list = matches.data ?? [];
  const session = useQuery({ queryKey: ["session", sessionId], queryFn: () => getSession(sessionId) });
  const afterBoth = session.data?.x1_voting_mode === "after_both_performances";
  const { completed, eliminatedIds, withdrawnIds, currentChampion, openMatches, activeCompetitorIds, waitingQueue, nextChallenger, firstPair } =
    getX1CompetitionState(list, participants);
  const sessionActive = props.sessionStatus === "active";
  const sessionFinished = props.sessionStatus === "finished";

  return (
    <section aria-labelledby="x1" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="x1" className="font-display text-3xl">Confrontos X1</h2>
      </div>
      {session.data && (
        <div className="rounded-xl border bg-card p-3 text-sm">
          <p className="font-medium">Modelo de votação: {afterBoth ? "Após as apresentações" : "Durante as apresentações"}</p>
          {matches.isSuccess && list.length === 0 && sessionActive ? (
            <Button variant="ghost" size="sm" className="mt-1 h-8 px-2" disabled={props.busy}
              onClick={() => props.act(() => updateX1VotingMode({ data: { sessionId, mode: afterBoth ? "during_performance" : "after_both_performances" } }), "Modelo de votação alterado")}>
              Trocar para {afterBoth ? "Durante as apresentações" : "Após as apresentações"}
            </Button>
          ) : <p className="mt-1 text-xs text-muted-foreground">🔒 Bloqueado após o primeiro confronto.</p>}
        </div>
      )}
      {participants.length < 2 && <p className="text-sm text-muted-foreground">Cadastre pelo menos dois cantores para criar um confronto.</p>}
      <QueueSummary participants={participants} currentChampion={currentChampion} activeCompetitorIds={activeCompetitorIds} eliminatedIds={eliminatedIds} withdrawnIds={withdrawnIds} waitingQueue={waitingQueue} />
      {sessionActive && firstPair && (
        <section className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Primeiro confronto</p>
          <p className="mt-2 text-center font-display text-2xl">{displayName(firstPair.a)} <span className="text-accent">×</span> {displayName(firstPair.b)}</p>
          <Button className="mt-4 h-12 w-full" disabled={props.busy} onClick={() => props.act(() => createMatch({ data: { sessionId, participantAId: firstPair.a.id, participantBId: firstPair.b.id } }), "Confronto criado — prepare as músicas")}><Swords className="size-4" /> Iniciar 1º confronto</Button>
        </section>
      )}
      {sessionActive && currentChampion && openMatches.length === 0 && nextChallenger && (
        <section className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Próximo confronto</p>
          <p className="mt-2 text-center font-display text-2xl">{displayName(currentChampion)} <span className="text-accent">×</span> {displayName(nextChallenger)}</p>
          <Button className="mt-4 h-12 w-full" disabled={props.busy} onClick={() => props.act(() => createMatch({ data: { sessionId, participantAId: currentChampion.id, participantBId: nextChallenger.id } }), "Confronto criado — prepare as músicas")}><Swords className="size-4" /> Preparar próximo confronto</Button>
        </section>
      )}
      {sessionActive && currentChampion && openMatches.length === 0 && waitingQueue.length === 0 && <section className="rounded-2xl border border-accent/50 bg-accent/10 p-5 text-center"><p className="font-display text-2xl">👑 Campeão atual: {displayName(currentChampion)}</p><p className="mt-2 text-muted-foreground">Fila de espera vazia. Cadastre novos cantores para continuar a disputa.</p></section>}
      {sessionFinished && currentChampion && <section className="rounded-2xl border border-accent/50 bg-accent/10 p-5 text-center"><p className="font-display text-2xl">🏆 Campeão da noite: {displayName(currentChampion)}</p></section>}
      {list.length === 0 && !firstPair && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Nenhum confronto ainda.</p>}
      <ol className="flex flex-col gap-3">
        {[...list].reverse().map((m) => {
          const a = byId(m.participant_a_id), b = byId(m.participant_b_id);
          const pa = perfs.find((p) => p.match_id === m.id && p.match_slot === "a");
          const pb = perfs.find((p) => p.match_id === m.id && p.match_slot === "b");
          const done = pa?.status === "completed" && pb?.status === "completed";
          return (
            <li key={m.id} className={`rounded-2xl border bg-card p-4 ${m.status === "in_progress" ? "border-primary" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><Swords className="size-4" /> Confronto X1</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${m.status === "in_progress" ? "bg-primary/20 text-primary" : "bg-secondary"}`}>{statusLabel[m.status]}</span>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
                <p className="truncate font-semibold">{a ? displayName(a) : "—"}</p>
                <span className="font-display text-2xl text-accent">VS</span>
                <p className="truncate font-semibold">{b ? displayName(b) : "—"}</p>
              </div>
              {m.status === "in_progress" && (
                <div className="mt-4 flex flex-col gap-2">
                  <SlotRow label="A" p={a} perf={pa} />
                  <SlotRow label="B" p={b} perf={pb} />
                  {done && afterBoth ? (
                    <DirectVotePanel match={m} participantA={a} participantB={b} busy={props.busy} act={props.act} />
                  ) : done ? (
                    <MatchResult match={m} participantA={a} participantB={b} performanceA={pa} performanceB={pb} busy={props.busy}
                      onConfirm={(winnerParticipantId) => props.act(() => confirmMatchWinner({ data: { matchId: m.id, winnerParticipantId } }), "Vencedor confirmado")} />
                  ) : null}
                </div>
              )}
              {m.status === "completed" && done && (
                <div className="mt-4 flex flex-col gap-2">
                  <SlotRow label="A" p={a} perf={pa} />
                  <SlotRow label="B" p={b} perf={pb} />
                  {afterBoth ? <DirectVotePanel match={m} participantA={a} participantB={b} busy={props.busy} act={props.act} />
                    : <MatchResult match={m} participantA={a} participantB={b} performanceA={pa} performanceB={pb} busy={props.busy} />}
                </div>
              )}
              {m.status === "scheduled" && sessionActive && (
                <div className="mt-4 flex flex-col gap-3">
                  <SongPreparation label="A" participant={a} performance={pa} busy={props.busy}
                    onPick={(playback) => props.act(() => createMatchPerformance({ data: { matchId: m.id, slot: "a", playback } }), "Música do cantor A preparada")} />
                  <SongPreparation label="B" participant={b} performance={pb} busy={props.busy}
                    onPick={(playback) => props.act(() => createMatchPerformance({ data: { matchId: m.id, slot: "b", playback } }), "Música do cantor B preparada")} />
                  {(!pa || pa.status !== "queued" || !pb || pb.status !== "queued") && (
                    <p className="text-sm text-muted-foreground">
                      Para iniciar o duelo, prepare as músicas pendentes de A e B.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" className="h-12" disabled={props.busy} onClick={() => setMatchToCancel(m)}><X className="size-4" /> Cancelar confronto</Button>
                    <Button className="h-12" disabled={props.busy || props.hasActive || pa?.status !== "queued" || pb?.status !== "queued" || list.some((other) => other.id !== m.id && other.status === "in_progress")} onClick={() => props.act(() => startMatch({ data: { matchId: m.id } }), "Duelo iniciado — cantor A no palco")}><Swords className="size-4" /> Iniciar duelo</Button>
                  </div>
                </div>
              )}
              {m.status === "scheduled" && list.some((other) => other.id !== m.id && other.status === "in_progress") && <p className="mt-2 text-xs text-muted-foreground">Termine o confronto em andamento antes de iniciar este.</p>}
            </li>
          );
        })}
      </ol>
      <CancelMatchDialog match={matchToCancel} participantA={matchToCancel ? byId(matchToCancel.participant_a_id) : undefined} participantB={matchToCancel ? byId(matchToCancel.participant_b_id) : undefined}
        busy={props.busy} onOpenChange={(open) => !open && setMatchToCancel(null)}
        onConfirm={(withdrawnSlot) => matchToCancel && props.act(async () => {
          await cancelMatch({ data: { matchId: matchToCancel.id, withdrawnSlot } });
          setMatchToCancel(null);
        }, "Desistência confirmada")} />
    </section>
  );
}

function MatchResult({ match, participantA, participantB, performanceA, performanceB, busy, onConfirm }: {
  match: Match; participantA: Participant | undefined; participantB: Participant | undefined;
  performanceA: Performance; performanceB: Performance; busy: boolean;
  onConfirm?: (winnerParticipantId: string) => void;
}) {
  const totalA = performanceA.like_count + performanceA.dislike_count;
  const saldoA = performanceA.like_count - performanceA.dislike_count;
  const totalB = performanceB.like_count + performanceB.dislike_count;
  const saldoB = performanceB.like_count - performanceB.dislike_count;
  const totalGeral = totalA + totalB;
  const tied = totalGeral > 0 && saldoA === saldoB;
  const suggestedA = saldoA > saldoB;
  const suggested = suggestedA ? participantA : participantB;
  const other = suggestedA ? participantB : participantA;
  const saldo = (value: number) => value > 0 ? `+${value}` : String(value);
  const winner = match.winner_participant_id ? (match.winner_participant_id === participantA?.id ? participantA : participantB) : undefined;

  return (
    <div className="mt-1 rounded-lg bg-secondary px-3 py-3 text-center">
      {match.status === "completed" ? <p className="font-semibold">Vencedor: {winner ? displayName(winner) : "—"}</p>
        : totalGeral === 0 ? <p className="font-semibold">Nenhum voto registrado pelo público</p>
        : tied ? <p className="font-semibold">Empate no saldo</p>
        : <p className="font-semibold">Vencedor sugerido: {suggested ? displayName(suggested) : "—"}</p>}
      <div className="mt-2 text-sm text-muted-foreground">
        <p>Cantor A: 👍 {performanceA.like_count} · 👎 {performanceA.dislike_count} · Saldo {saldo(saldoA)}</p>
        <p>Cantor B: 👍 {performanceB.like_count} · 👎 {performanceB.dislike_count} · Saldo {saldo(saldoB)}</p>
      </div>
      {onConfirm && (totalGeral === 0 || tied ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button disabled={busy || !participantA} onClick={() => participantA && onConfirm(participantA.id)}>Declarar Cantor A vencedor</Button>
          <Button disabled={busy || !participantB} onClick={() => participantB && onConfirm(participantB.id)}>Declarar Cantor B vencedor</Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <Button disabled={busy || !suggested} onClick={() => suggested && onConfirm(suggested.id)}>Confirmar vitória de {suggested ? displayName(suggested) : "—"}</Button>
          <Button variant="secondary" disabled={busy || !other} onClick={() => other && onConfirm(other.id)}>Declarar vitória de {other ? displayName(other) : "—"}</Button>
        </div>
      ))}
    </div>
  );
}

function SlotRow({ label, p, perf }: { label: string; p: Participant | undefined; perf: Performance | undefined }) {
  const state = perf?.status === "completed" ? "concluído" : perf?.status === "active" ? "em apresentação" : "aguardando";
  return (
    <p className="flex items-center gap-2 text-sm">
      {perf?.status === "completed" ? <Check className="size-4 text-success" /> : <span className={`size-2.5 rounded-full ${perf?.status === "active" ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />}
      <span className="font-semibold">Cantor {label}</span> · <span className="truncate">{p ? displayName(p) : "—"}</span>
      <span className={`ml-auto shrink-0 ${perf?.status === "active" ? "text-primary" : "text-muted-foreground"}`}>{state}</span>
    </p>
  );
}

function QueueSummary({ participants, currentChampion, activeCompetitorIds, eliminatedIds, withdrawnIds, waitingQueue }: {
  participants: Participant[]; currentChampion: Participant | undefined; activeCompetitorIds: Set<string>; eliminatedIds: Set<string>; withdrawnIds: Set<string>; waitingQueue: Participant[];
}) {
  const queuePositions = new Map(waitingQueue.map((participant, index) => [participant.id, index + 1]));
  return (
    <section aria-label="Fila eliminatória" className="rounded-2xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Fila eliminatória</h3>
      <ol className="mt-3 flex flex-col gap-2">
        {[...participants].sort((a, b) => a.participant_number - b.participant_number).map((participant) => {
          const state = withdrawnIds.has(participant.id)
            ? "🚫 Desistiu"
            : eliminatedIds.has(participant.id)
              ? "❌ Eliminado"
            : activeCompetitorIds.has(participant.id)
              ? "⚔️ Em duelo"
              : currentChampion?.id === participant.id
                ? "👑 Campeão atual"
                : `⏳ Na fila · ${queuePositions.get(participant.id)}º`;
          return <li key={participant.id} className="flex items-center justify-between gap-3 rounded-lg bg-secondary/60 px-3 py-2 text-sm"><span className="min-w-0 truncate font-medium">{participant.participant_number}. {displayName(participant)}</span><span className="shrink-0 text-muted-foreground">{state}</span></li>;
        })}
      </ol>
    </section>
  );
}

function CancelMatchDialog({ match, participantA, participantB, busy, onOpenChange, onConfirm }: {
  match: Match | null; participantA: Participant | undefined; participantB: Participant | undefined; busy: boolean;
  onOpenChange: (open: boolean) => void; onConfirm: (withdrawnSlot: "a" | "b" | "both") => void;
}) {
  const [withdrawnSlot, setWithdrawnSlot] = useState<"a" | "b" | "both" | null>(null);
  return (
    <Dialog open={!!match} onOpenChange={(open) => { onOpenChange(open); if (!open) setWithdrawnSlot(null); }}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">Cancelar confronto</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="font-semibold">Quem desistiu?</p>
          <RadioGroup value={withdrawnSlot} onValueChange={(value) => setWithdrawnSlot(value as "a" | "b" | "both")}>
            <Label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
              <RadioGroupItem value="a" />
              {participantA ? `${displayName(participantA)} desistiu` : "Cantor A desistiu"}
            </Label>
            <Label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
              <RadioGroupItem value="b" />
              {participantB ? `${displayName(participantB)} desistiu` : "Cantor B desistiu"}
            </Label>
            <Label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
              <RadioGroupItem value="both" />
              Ambos desistiram
            </Label>
          </RadioGroup>
        </div>
        <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Button type="button" variant="secondary" className="h-12" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button className="h-12" disabled={busy || !withdrawnSlot} onClick={() => withdrawnSlot && onConfirm(withdrawnSlot)}>Confirmar desistência</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SongPreparation({ label, participant, performance, busy, onPick }: {
  label: "A" | "B"; participant: Participant | undefined; performance: Performance | undefined; busy: boolean;
  onPick: (playback: PlaybackSearchResult) => void;
}) {
  const [searching, setSearching] = useState(false);
  if (performance) return <p className="rounded-lg bg-secondary px-3 py-2 text-sm"><span className="font-semibold">Música do cantor {label}:</span> preparada</p>;
  return (
    <div className="rounded-xl border border-dashed p-3">
      <p className="text-sm text-muted-foreground">Música do cantor {label} ({participant ? displayName(participant) : "—"}) pendente de preparação.</p>
      {searching ? <div className="mt-3"><MusicSearch onPick={(playback) => { onPick(playback); setSearching(false); }} /></div>
        : <Button type="button" variant="secondary" className="mt-3 h-11" disabled={busy || !participant} onClick={() => setSearching(true)}>Preparar música do cantor {label}</Button>}
    </div>
  );
}

/** after_both_performances only: direct A/B vote counted from x1_match_votes. */
function DirectVotePanel({ match, participantA, participantB, busy, act }: {
  match: Match; participantA: Participant | undefined; participantB: Participant | undefined; busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
}) {
  const open = match.voting_status === "open";
  const tally = useQuery({
    queryKey: ["x1-tally", match.id, match.voting_status],
    queryFn: () => getX1MatchTally({ data: { matchId: match.id } }),
    refetchInterval: open ? 1500 : false,
  });
  const offset = tally.data ? tally.data.serverNow - Date.now() : 0;
  const remaining = useVoteCountdown(open ? match.voting_ends_at : null, offset);
  const expired = open && remaining === 0;
  const closed = match.voting_status === "closed" || expired;
  const a = tally.data?.a ?? 0, b = tally.data?.b ?? 0;
  const winner = match.winner_participant_id ? (match.winner_participant_id === participantA?.id ? participantA : participantB) : undefined;
  const suggested = a > b ? participantA : b > a ? participantB : undefined;
  const other = suggested === participantA ? participantB : participantA;
  const confirm = (id: string) => act(() => confirmMatchWinner({ data: { matchId: match.id, winnerParticipantId: id } }), "Vencedor confirmado");

  return (
    <div className="mt-1 rounded-lg bg-secondary px-3 py-3 text-center">
      {match.status === "completed" ? <p className="font-semibold">Vencedor: {winner ? displayName(winner) : "—"}</p>
        : <p className="font-display text-2xl">QUEM VOCÊ PREFERE?</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-background/60 p-2"><p className="truncate text-sm font-semibold">Cantor A · {participantA ? displayName(participantA) : "—"}</p><p className="font-display text-3xl">{a}</p><p className="text-xs text-muted-foreground">{a === 1 ? "voto" : "votos"}</p></div>
        <div className="rounded-md bg-background/60 p-2"><p className="truncate text-sm font-semibold">Cantor B · {participantB ? displayName(participantB) : "—"}</p><p className="font-display text-3xl">{b}</p><p className="text-xs text-muted-foreground">{b === 1 ? "voto" : "votos"}</p></div>
      </div>
      {match.status === "in_progress" && match.voting_status === "idle" && (
        <Button className="mt-3 w-full" disabled={busy} onClick={() => act(() => openX1MatchVoting({ data: { matchId: match.id } }), "Votação aberta")}>Abrir votação</Button>
      )}
      {match.status === "in_progress" && open && !expired && (
        <>
          <p className="mt-3 font-display text-4xl text-primary" aria-live="polite">{remaining}s</p>
          <Button variant="secondary" className="mt-2 w-full" disabled={busy} onClick={() => act(() => closeX1MatchVoting({ data: { matchId: match.id } }), "Votação encerrada")}>Encerrar votação agora</Button>
        </>
      )}
      {match.status === "in_progress" && closed && (
        <>
          <p className="mt-3 font-semibold">{a === b ? "Empate — escolha o vencedor" : `Vencedor sugerido: ${suggested ? displayName(suggested) : "—"}`}</p>
          {a === b ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button disabled={busy || !participantA} onClick={() => participantA && confirm(participantA.id)}>Declarar Cantor A vencedor</Button>
              <Button disabled={busy || !participantB} onClick={() => participantB && confirm(participantB.id)}>Declarar Cantor B vencedor</Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <Button disabled={busy || !suggested} onClick={() => suggested && confirm(suggested.id)}>Confirmar vitória de {suggested ? displayName(suggested) : "—"}</Button>
              <Button variant="secondary" disabled={busy || !other} onClick={() => other && confirm(other.id)}>Declarar vitória de {other ? displayName(other) : "—"}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
