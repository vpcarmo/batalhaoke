import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Mic2, Plus, Swords, X } from "lucide-react";
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
  sessionId: string; sessionActive: boolean; participants: Participant[]; perfs: Performance[]; hasActive: boolean; busy: boolean;
  act: (fn: () => Promise<unknown>, ok?: string) => void;
  onPickSong: (match: Match, slot: MatchSlot, participant: Participant) => void;
  preparedSongs: Record<string, PlaybackSearchResult>;
}) {
  const { sessionId, participants, perfs } = props;
  const [open, setOpen] = useState(false);
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
  const anyInProgress = list.some((m) => m.status === "in_progress");

  return (
    <section aria-labelledby="x1" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="x1" className="font-display text-3xl">Confrontos X1</h2>
        {props.sessionActive && (
          <Button className="h-11" disabled={participants.length < 2} onClick={() => setOpen(true)}><Plus className="size-4" /> Novo confronto</Button>
        )}
      </div>
      {participants.length < 2 && <p className="text-sm text-muted-foreground">Cadastre pelo menos dois cantores para criar um confronto.</p>}
      {list.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Nenhum confronto ainda.</p>}
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
              {m.status === "scheduled" && props.sessionActive && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="secondary" className="h-12" disabled={props.busy} onClick={() => props.act(() => cancelMatch({ data: { matchId: m.id } }), "Confronto cancelado")}><X className="size-4" /> Cancelar</Button>
                  <Button className="h-12" disabled={props.busy || anyInProgress} onClick={() => props.act(() => startMatch({ data: { matchId: m.id } }), "Confronto iniciado")}><Swords className="size-4" /> Iniciar confronto</Button>
                </div>
              )}
              {m.status === "scheduled" && anyInProgress && <p className="mt-2 text-xs text-muted-foreground">Termine o confronto em andamento antes de iniciar este.</p>}
            </li>
          );
        })}
      </ol>
      <NewMatchDialog open={open} onOpenChange={setOpen} participants={participants} busy={props.busy} preparedSongs={props.preparedSongs}
        onCreate={(aId, bId, playbackA, playbackB) => props.act(async () => { await createMatch({ data: { sessionId, participantAId: aId, participantBId: bId, playbackA, playbackB } }); setOpen(false); }, "Confronto criado")} />
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

function NewMatchDialog({ open, onOpenChange, participants, busy, preparedSongs, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; participants: Participant[]; busy: boolean; preparedSongs: Record<string, PlaybackSearchResult>; onCreate: (a: string, b: string, playbackA: PlaybackSearchResult, playbackB: PlaybackSearchResult) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [fallbackA, setFallbackA] = useState<PlaybackSearchResult | null>(null);
  const [fallbackB, setFallbackB] = useState<PlaybackSearchResult | null>(null);
  const [preparingSlot, setPreparingSlot] = useState<MatchSlot | null>(null);
  const same = !!a && a === b;
  const playbackA = preparedSongs[a] ?? fallbackA;
  const playbackB = preparedSongs[b] ?? fallbackB;
  const sel = "mt-2 h-12 w-full rounded-md border bg-background px-3 text-base";
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setA(""); setB(""); setFallbackA(null); setFallbackB(null); setPreparingSlot(null); } }}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="font-display text-3xl">Novo confronto</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div><Label htmlFor="ma">Cantor A</Label>
            <select id="ma" className={sel} value={a} onChange={(e) => { setA(e.target.value); setFallbackA(null); setPreparingSlot(null); }}>
              <option value="">Selecionar…</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.participant_number}. {displayName(p)}</option>)}
            </select>
          </div>
          {a && !preparedSongs[a] && <PendingSong label="A" song={fallbackA} preparing={preparingSlot === "a"} onPrepare={() => setPreparingSlot("a")} onPick={(song) => { setFallbackA(song); setPreparingSlot(null); }} />}
          <p className="text-center font-display text-2xl text-accent">VS</p>
          <div><Label htmlFor="mb">Cantor B</Label>
            <select id="mb" className={sel} value={b} onChange={(e) => { setB(e.target.value); setFallbackB(null); setPreparingSlot(null); }}>
              <option value="">Selecionar…</option>
              {participants.map((p) => <option key={p.id} value={p.id} disabled={p.id === a}>{p.participant_number}. {displayName(p)}</option>)}
            </select>
          </div>
          {b && !preparedSongs[b] && <PendingSong label="B" song={fallbackB} preparing={preparingSlot === "b"} onPrepare={() => setPreparingSlot("b")} onPick={(song) => { setFallbackB(song); setPreparingSlot(null); }} />}
          {same && <p role="alert" className="text-sm text-destructive">Escolha dois cantores diferentes.</p>}
        </div>
        <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Button type="button" variant="secondary" className="h-12" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button className="h-12" disabled={busy || !a || !b || same || !playbackA || !playbackB} onClick={() => playbackA && playbackB && onCreate(a, b, playbackA, playbackB)}>Criar confronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PendingSong({ label, song, preparing, onPrepare, onPick }: { label: string; song: PlaybackSearchResult | null; preparing: boolean; onPrepare: () => void; onPick: (song: PlaybackSearchResult) => void }) {
  if (song) return <p className="rounded-lg bg-secondary px-3 py-2 text-sm"><span className="font-semibold">Música do cantor {label}:</span> {song.title}</p>;
  return <div className="rounded-xl border border-dashed p-3"><p className="text-sm text-muted-foreground">Música do cantor {label} pendente de preparação.</p>{preparing ? <div className="mt-3"><MusicSearch onPick={onPick} /></div> : <Button type="button" variant="secondary" className="mt-3 h-11" onClick={onPrepare}>Preparar música do cantor {label}</Button>}</div>;
}
