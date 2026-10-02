import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Mic2, Swords, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { displayName, type Match, type MatchSlot, type Participant, type Performance } from "@/lib/karaoke";
import { cancelMatch, confirmMatchWinner, createMatch, startMatch, startMatchPerformance } from "@/lib/x1.functions";
import { MusicSearch } from "@/components/karaoke/MusicSearch";
import type { PlaybackSearchResult } from "@/lib/playback/types";

const statusLabel: Record<string, string> = { scheduled: "Agendado", in_progress: "Em andamento", completed: "Concluído", cancelled: "Cancelado" };

export const matchesKey = (sessionId: string) => ["matches", sessionId];

/** X1 confrontations panel. Reads matches; all writes go through x1 server functions. */
export function X1Matches(props: {
  sessionId: string; sessionStatus: string; participants: Participant[]; perfs: Performance[]; hasActive: boolean; busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
  onPickSong: (match: Match, slot: MatchSlot, participant: Participant) => void;
}) {
  const { sessionId, participants, perfs } = props;
  const [pairToPrepare, setPairToPrepare] = useState<{ a: Participant; b: Participant; first: boolean } | null>(null);
  const matches = useQuery({
    queryKey: matchesKey(sessionId),
    queryFn: async () => {
      const { data, error } = await supabase.from("matches").select("*").eq("session_id", sessionId).order("created_at");
      if (error) throw error;
      return data as Match[];
    },
  });
  const byId = (pid: string) => participants.find((p) => p.id === pid);
  const list = matches.data ?? [];
  const completed = list.filter((m) => m.status === "completed" && m.winner_participant_id);
  const eliminatedIds = new Set<string>();
  for (const match of completed) {
    if (match.participant_a_id !== match.winner_participant_id) eliminatedIds.add(match.participant_a_id);
    if (match.participant_b_id !== match.winner_participant_id) eliminatedIds.add(match.participant_b_id);
  }
  const latestCompleted = completed.at(-1);
  const currentChampion = latestCompleted?.winner_participant_id && !eliminatedIds.has(latestCompleted.winner_participant_id)
    ? byId(latestCompleted.winner_participant_id)
    : undefined;
  const openMatches = list.filter((m) => m.status === "scheduled" || m.status === "in_progress");
  const activeCompetitorIds = new Set(openMatches.flatMap((m) => [m.participant_a_id, m.participant_b_id]));
  const waitingQueue = [...participants]
    .filter((p) => !eliminatedIds.has(p.id) && p.id !== currentChampion?.id && !activeCompetitorIds.has(p.id))
    .sort((a, b) => a.participant_number - b.participant_number);
  const nextChallenger = waitingQueue[0];
  const [firstA, firstB] = waitingQueue;
  const firstPair = completed.length === 0 && openMatches.length === 0 && firstA && firstB
    ? { a: firstA, b: firstB }
    : null;
  const sessionActive = props.sessionStatus === "active";
  const sessionFinished = props.sessionStatus === "finished";

  return (
    <section aria-labelledby="x1" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="x1" className="font-display text-3xl">Confrontos X1</h2>
      </div>
      {participants.length < 2 && <p className="text-sm text-muted-foreground">Cadastre pelo menos dois cantores para criar um confronto.</p>}
      <QueueSummary participants={participants} currentChampion={currentChampion} activeCompetitorIds={activeCompetitorIds} eliminatedIds={eliminatedIds} waitingQueue={waitingQueue} />
      {sessionActive && firstPair && (
        <section className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Primeiro confronto</p>
          <p className="mt-2 text-center font-display text-2xl">{displayName(firstPair.a)} <span className="text-accent">×</span> {displayName(firstPair.b)}</p>
          <Button className="mt-4 h-12 w-full" disabled={props.busy} onClick={() => setPairToPrepare({ ...firstPair, first: true })}><Swords className="size-4" /> Iniciar 1º confronto</Button>
        </section>
      )}
      {sessionActive && currentChampion && openMatches.length === 0 && nextChallenger && (
        <section className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Próximo confronto</p>
          <p className="mt-2 text-center font-display text-2xl">{displayName(currentChampion)} <span className="text-accent">×</span> {displayName(nextChallenger)}</p>
          <Button className="mt-4 h-12 w-full" disabled={props.busy} onClick={() => setPairToPrepare({ a: currentChampion, b: nextChallenger, first: false })}><Swords className="size-4" /> Preparar próximo confronto</Button>
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
                  {done ? (
                    <MatchResult match={m} participantA={a} participantB={b} performanceA={pa} performanceB={pb} busy={props.busy}
                      onConfirm={(winnerParticipantId) => props.act(() => confirmMatchWinner({ data: { matchId: m.id, winnerParticipantId } }), "Vencedor confirmado")} />
                  ) : !pa ? (
                    <Button size="lg" className="mt-1 h-14 text-base font-semibold" disabled={props.busy || props.hasActive || !a} onClick={() => a && props.onPickSong(m, "a", a)}><Mic2 className="size-5" /> Iniciar Cantor A</Button>
                  ) : pa.status === "queued" ? (
                    <Button size="lg" className="mt-1 h-14 text-base font-semibold" disabled={props.busy || props.hasActive} onClick={() => props.act(() => startMatchPerformance({ data: { performanceId: pa.id } }), "Cantor A no palco")}><Mic2 className="size-5" /> Iniciar Cantor A</Button>
                  ) : pa.status === "completed" && !pb ? (
                    <Button size="lg" className="mt-1 h-14 text-base font-semibold" disabled={props.busy || props.hasActive || !b} onClick={() => b && props.onPickSong(m, "b", b)}><Mic2 className="size-5" /> Iniciar Cantor B</Button>
                  ) : pa.status === "completed" && pb?.status === "queued" ? (
                    <Button size="lg" className="mt-1 h-14 text-base font-semibold" disabled={props.busy || props.hasActive} onClick={() => props.act(() => startMatchPerformance({ data: { performanceId: pb.id } }), "Cantor B no palco")}><Mic2 className="size-5" /> Iniciar Cantor B</Button>
                  ) : null}
                </div>
              )}
              {m.status === "completed" && done && (
                <div className="mt-4 flex flex-col gap-2">
                  <SlotRow label="A" p={a} perf={pa} />
                  <SlotRow label="B" p={b} perf={pb} />
                  <MatchResult match={m} participantA={a} participantB={b} performanceA={pa} performanceB={pb} busy={props.busy} />
                </div>
              )}
              {m.status === "scheduled" && sessionActive && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="secondary" className="h-12" disabled={props.busy} onClick={() => props.act(() => cancelMatch({ data: { matchId: m.id } }), "Confronto cancelado")}><X className="size-4" /> Cancelar</Button>
                  <Button className="h-12" disabled={props.busy || list.some((other) => other.id !== m.id && other.status === "in_progress")} onClick={() => props.act(() => startMatch({ data: { matchId: m.id } }), "Confronto iniciado")}><Swords className="size-4" /> Iniciar confronto</Button>
                </div>
              )}
              {m.status === "scheduled" && list.some((other) => other.id !== m.id && other.status === "in_progress") && <p className="mt-2 text-xs text-muted-foreground">Termine o confronto em andamento antes de iniciar este.</p>}
            </li>
          );
        })}
      </ol>
      <NewMatchDialog key={pairToPrepare ? `${pairToPrepare.a.id}:${pairToPrepare.b.id}` : "closed"} pair={pairToPrepare} onOpenChange={(open) => !open && setPairToPrepare(null)} busy={props.busy}
        onCreate={(aId, bId, playbackA, playbackB) => props.act(async () => {
          const match = await createMatch({ data: { sessionId, participantAId: aId, participantBId: bId, playbackA, playbackB } });
          if (!pairToPrepare?.first) await startMatch({ data: { matchId: match.id } });
          setPairToPrepare(null);
        }, pairToPrepare?.first ? "Confronto criado" : "Confronto criado e iniciado")} />
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

function QueueSummary({ participants, currentChampion, activeCompetitorIds, eliminatedIds, waitingQueue }: {
  participants: Participant[]; currentChampion: Participant | undefined; activeCompetitorIds: Set<string>; eliminatedIds: Set<string>; waitingQueue: Participant[];
}) {
  const queuePositions = new Map(waitingQueue.map((participant, index) => [participant.id, index + 1]));
  return (
    <section aria-label="Fila eliminatória" className="rounded-2xl border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Fila eliminatória</h3>
      <ol className="mt-3 flex flex-col gap-2">
        {[...participants].sort((a, b) => a.participant_number - b.participant_number).map((participant) => {
          const state = eliminatedIds.has(participant.id)
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

function NewMatchDialog({ pair, onOpenChange, busy, onCreate }: { pair: { a: Participant; b: Participant; first: boolean } | null; onOpenChange: (o: boolean) => void; busy: boolean; onCreate: (a: string, b: string, playbackA: PlaybackSearchResult, playbackB: PlaybackSearchResult) => void }) {
  const [fallbackA, setFallbackA] = useState<PlaybackSearchResult | null>(null);
  const [fallbackB, setFallbackB] = useState<PlaybackSearchResult | null>(null);
  const [preparingSlot, setPreparingSlot] = useState<MatchSlot | null>(null);
  const playbackA = fallbackA;
  const playbackB = fallbackB;
  return (
    <Dialog open={!!pair} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFallbackA(null); setFallbackB(null); setPreparingSlot(null); } }}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="font-display text-3xl">{pair?.first ? "1º confronto" : "Próximo confronto"}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div><Label>Cantor A</Label><p className="mt-2 rounded-md border bg-secondary px-3 py-3 font-semibold">{pair ? displayName(pair.a) : "—"}</p></div>
          <PendingSong label="A" song={fallbackA} preparing={preparingSlot === "a"} onPrepare={() => setPreparingSlot("a")} onPick={(song) => { setFallbackA(song); setPreparingSlot(null); }} />
          <p className="text-center font-display text-2xl text-accent">VS</p>
          <div><Label>Cantor B</Label><p className="mt-2 rounded-md border bg-secondary px-3 py-3 font-semibold">{pair ? displayName(pair.b) : "—"}</p></div>
          <PendingSong label="B" song={fallbackB} preparing={preparingSlot === "b"} onPrepare={() => setPreparingSlot("b")} onPick={(song) => { setFallbackB(song); setPreparingSlot(null); }} />
        </div>
        <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Button type="button" variant="secondary" className="h-12" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button className="h-12" disabled={busy || !pair || !playbackA || !playbackB} onClick={() => pair && playbackA && playbackB && onCreate(pair.a.id, pair.b.id, playbackA, playbackB)}>Criar confronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PendingSong({ label, song, preparing, onPrepare, onPick }: { label: string; song: PlaybackSearchResult | null; preparing: boolean; onPrepare: () => void; onPick: (song: PlaybackSearchResult) => void }) {
  if (song) return <p className="rounded-lg bg-secondary px-3 py-2 text-sm"><span className="font-semibold">Música do cantor {label}:</span> {song.title}</p>;
  return <div className="rounded-xl border border-dashed p-3"><p className="text-sm text-muted-foreground">Música do cantor {label} pendente de preparação.</p>{preparing ? <div className="mt-3"><MusicSearch onPick={onPick} /></div> : <Button type="button" variant="secondary" className="mt-3 h-11" onClick={onPrepare}>Preparar música do cantor {label}</Button>}</div>;
}
