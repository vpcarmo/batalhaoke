import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Crown, Swords, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  displayName,
  listMatches,
  type Match,
  type Participant,
  type Performance,
} from "@/lib/karaoke";
import {
  confirmMatchWinner,
  createMatch,
  createMatchPerformance,
  startMatch,
} from "@/lib/x1.functions";
import { MusicSearch } from "./MusicSearch";
import type { PlaybackSearchResult } from "@/lib/playback/types";

type Props = {
  sessionId: string;
  participants: Participant[];
  performances: Performance[];
  disabled: boolean;
};

const score = (performance: Performance) => performance.like_count - performance.dislike_count;

export function X1Matches({ sessionId, participants, performances, disabled }: Props) {
  const matches = useQuery({
    queryKey: ["matches", sessionId],
    queryFn: () => listMatches(sessionId),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [participantAId, setParticipantAId] = useState("");
  const [participantBId, setParticipantBId] = useState("");
  const [musicFor, setMusicFor] = useState<{ match: Match; slot: "a" | "b" } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await matches.refetch();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    await run(async () => {
      await createMatch({ data: { sessionId, participantAId, participantBId } });
      setCreateOpen(false);
      setParticipantAId("");
      setParticipantBId("");
    }, "Confronto criado");
  }

  async function chooseMusic(playback: PlaybackSearchResult) {
    if (!musicFor) return;
    const { match, slot } = musicFor;
    await run(async () => {
      await createMatchPerformance({ data: { matchId: match.id, slot, playback } });
      setMusicFor(null);
    }, `Música do Cantor ${slot.toUpperCase()} definida`);
  }

  return (
    <section aria-labelledby="x1-matches" className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="x1-matches" className="font-display text-3xl">
            Confrontos X1
          </h2>
          <p className="text-sm text-muted-foreground">
            Apresentações em ordem: Cantor A, depois Cantor B.
          </p>
        </div>
        <Button
          className="h-11 shrink-0"
          disabled={disabled || participants.length < 2 || busy}
          onClick={() => setCreateOpen(true)}
        >
          <Swords className="size-4" /> Novo confronto
        </Button>
      </div>

      {matches.isLoading && (
        <p className="mt-4 text-sm text-muted-foreground">Carregando confrontos…</p>
      )}
      {matches.isError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Não foi possível carregar os confrontos.
        </p>
      )}
      {!matches.isLoading && !matches.isError && matches.data?.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Crie um confronto para iniciar o X1.</p>
      )}
      <div className="mt-4 flex flex-col gap-3">
        {matches.data?.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            performances={performances}
            participants={participants}
            disabled={disabled || busy}
            onStart={() =>
              run(() => startMatch({ data: { matchId: match.id } }), "Confronto iniciado")
            }
            onChooseMusic={(slot) => setMusicFor({ match, slot })}
            onConfirmWinner={(winnerParticipantId) =>
              run(
                () => confirmMatchWinner({ data: { matchId: match.id, winnerParticipantId } }),
                "Vencedor confirmado",
              )
            }
          />
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Novo confronto X1</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <Label htmlFor="x1-a">Cantor A</Label>
              <SingerSelect
                id="x1-a"
                value={participantAId}
                onChange={setParticipantAId}
                participants={participants}
                exclude={participantBId}
              />
            </div>
            <div>
              <Label htmlFor="x1-b">Cantor B</Label>
              <SingerSelect
                id="x1-b"
                value={participantBId}
                onChange={setParticipantBId}
                participants={participants}
                exclude={participantAId}
              />
            </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Button variant="secondary" className="h-12" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              className="h-12"
              disabled={busy || !participantAId || !participantBId}
              onClick={create}
            >
              Criar confronto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!musicFor} onOpenChange={(open) => !open && setMusicFor(null)}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Música do Cantor {musicFor?.slot.toUpperCase()}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <MusicSearch onPick={chooseMusic} />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function SingerSelect({
  id,
  value,
  onChange,
  participants,
  exclude,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  participants: Participant[];
  exclude: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="mt-2 h-12">
        <SelectValue placeholder="Escolha o cantor" />
      </SelectTrigger>
      <SelectContent>
        {participants
          .filter((participant) => participant.id !== exclude)
          .map((participant) => (
            <SelectItem key={participant.id} value={participant.id}>
              Cantor {participant.participant_number}: {displayName(participant)}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

function MatchCard({
  match,
  performances,
  participants,
  disabled,
  onStart,
  onChooseMusic,
  onConfirmWinner,
}: {
  match: Match;
  performances: Performance[];
  participants: Participant[];
  disabled: boolean;
  onStart: () => void;
  onChooseMusic: (slot: "a" | "b") => void;
  onConfirmWinner: (participantId: string) => void;
}) {
  // Slots, rather than participant history, identify the two unique performances of this match.
  const performanceA = performances.find(
    (performance) => performance.match_id === match.id && performance.match_slot === "a",
  );
  const performanceB = performances.find(
    (performance) => performance.match_id === match.id && performance.match_slot === "b",
  );
  const participantA = participants.find(
    (participant) => participant.id === match.participant_a_id,
  );
  const participantB = participants.find(
    (participant) => participant.id === match.participant_b_id,
  );
  const complete = performanceA?.status === "completed" && performanceB?.status === "completed";
  const winner = participants.find((participant) => participant.id === match.winner_participant_id);
  const suggestedWinner =
    complete && performanceA && performanceB && score(performanceA) !== score(performanceB)
      ? ((score(performanceA) > score(performanceB) ? participantA : participantB) ?? null)
      : null;

  return (
    <article className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">
          {participantA && displayName(participantA)}{" "}
          <span className="text-muted-foreground">×</span>{" "}
          {participantB && displayName(participantB)}
        </p>
        <MatchStatus match={match} complete={complete} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PerformanceSummary
          label="Cantor A"
          participant={participantA}
          performance={performanceA}
        />
        <PerformanceSummary
          label="Cantor B"
          participant={participantB}
          performance={performanceB}
        />
      </div>

      {match.status === "scheduled" && (
        <Button className="mt-4 h-12 w-full" disabled={disabled} onClick={onStart}>
          Iniciar confronto
        </Button>
      )}
      {match.status === "in_progress" && !performanceA && (
        <Button className="mt-4 h-12 w-full" disabled={disabled} onClick={() => onChooseMusic("a")}>
          Escolher música do Cantor A
        </Button>
      )}
      {match.status === "in_progress" && performanceA?.status === "completed" && !performanceB && (
        <Button className="mt-4 h-12 w-full" disabled={disabled} onClick={() => onChooseMusic("b")}>
          Escolher música do Cantor B
        </Button>
      )}
      {match.status === "in_progress" &&
        !complete &&
        performanceA?.status === "completed" &&
        performanceB?.status !== "completed" && (
          <p className="mt-4 text-sm font-medium text-muted-foreground">
            Cantor A ✓ concluído · aguardando apresentação de B.
          </p>
        )}
      {match.status === "in_progress" && complete && performanceA && performanceB && (
        <Result
          performanceA={performanceA}
          performanceB={performanceB}
          participantA={participantA}
          participantB={participantB}
          suggestedWinner={suggestedWinner}
          disabled={disabled}
          onConfirmWinner={onConfirmWinner}
        />
      )}
      {match.status === "completed" && performanceA && performanceB && (
        <CompletedResult performanceA={performanceA} performanceB={performanceB} winner={winner} />
      )}
    </article>
  );
}

function MatchStatus({ match, complete }: { match: Match; complete: boolean }) {
  if (match.status === "completed")
    return <span className="text-sm font-semibold text-success">✓ Confronto concluído</span>;
  if (complete)
    return <span className="text-sm font-semibold text-accent">Aguardando resultado</span>;
  if (match.status === "in_progress")
    return <span className="text-sm font-semibold text-primary">Em andamento</span>;
  return <span className="text-sm text-muted-foreground">Agendado</span>;
}

function PerformanceSummary({
  label,
  participant,
  performance,
}: {
  label: string;
  participant: Participant | undefined;
  performance: Performance | undefined;
}) {
  return (
    <div className="rounded-lg bg-secondary p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{participant ? displayName(participant) : "—"}</p>
      {performance ? (
        <>
          <p className="mt-2 flex gap-3 text-sm">
            <span>
              <ThumbsUp className="mr-1 inline size-4" />
              {performance.like_count}
            </span>
            <span>
              <ThumbsDown className="mr-1 inline size-4" />
              {performance.dislike_count}
            </span>
          </p>
          {performance.status === "completed" && (
            <p className="mt-1 text-sm font-semibold">
              Saldo {score(performance) >= 0 ? "+" : ""}
              {score(performance)}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {performance.status === "completed"
              ? "✓ concluído"
              : performance.status === "active"
                ? "🎤 em apresentação"
                : "Aguardando apresentação"}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Música ainda não escolhida</p>
      )}
    </div>
  );
}

function Result({
  performanceA,
  performanceB,
  participantA,
  participantB,
  suggestedWinner,
  disabled,
  onConfirmWinner,
}: {
  performanceA: Performance;
  performanceB: Performance;
  participantA: Participant | undefined;
  participantB: Participant | undefined;
  suggestedWinner: Participant | null;
  disabled: boolean;
  onConfirmWinner: (participantId: string) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <h3 className="flex items-center gap-2 font-display text-2xl">
        <Crown className="size-6 text-accent" /> Resultado do confronto
      </h3>
      <p className="mt-2 text-sm">
        {suggestedWinner ? (
          <>
            Vencedor sugerido: <strong>{displayName(suggestedWinner)}</strong>
          </>
        ) : (
          <>
            ⚖️ <strong>Empate</strong>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        A: {score(performanceA) >= 0 ? "+" : ""}
        {score(performanceA)} · B: {score(performanceB) >= 0 ? "+" : ""}
        {score(performanceB)}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          className="h-12"
          disabled={disabled || !participantA}
          onClick={() => participantA && onConfirmWinner(participantA.id)}
        >
          Confirmar Cantor A
        </Button>
        <Button
          variant="secondary"
          className="h-12"
          disabled={disabled || !participantB}
          onClick={() => participantB && onConfirmWinner(participantB.id)}
        >
          Confirmar Cantor B
        </Button>
      </div>
    </div>
  );
}

function CompletedResult({
  performanceA,
  performanceB,
  winner,
}: {
  performanceA: Performance;
  performanceB: Performance;
  winner: Participant | undefined;
}) {
  return (
    <div className="mt-4 rounded-xl bg-success/10 p-4">
      <p className="flex items-center gap-2 font-semibold text-success">
        <Check className="size-5" /> Confronto concluído
      </p>
      <p className="mt-2 text-sm">
        Saldo A: {score(performanceA) >= 0 ? "+" : ""}
        {score(performanceA)} · Saldo B: {score(performanceB) >= 0 ? "+" : ""}
        {score(performanceB)}
      </p>
      <p className="mt-2 flex items-center gap-2 font-semibold">
        <Crown className="size-5 text-accent" /> Vencedor: {winner ? displayName(winner) : "—"}
      </p>
    </div>
  );
}
