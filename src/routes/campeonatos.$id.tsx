import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  activateStageSessionFn,
  advanceChampionshipEliminationFn,
  closeChampionshipMatchVotingFn,
  closeChampionshipRegistrationFn,
  completeChampionshipFn,
  completeChampionshipPresentationFn,
  drawChampionshipFn,
  finalizeGroupStageAndGenerateQuarterFinalsFn,
  getChampionshipDrawFn,
  getChampionshipEliminationBoardFn,
  getChampionshipFn,
  getChampionshipMatchScoreFn,
  getChampionshipScheduleFn,
  getChampionshipStandingsFn,
  listChampionshipEntriesFn,
  openChampionshipMatchVotingFn,
  openChampionshipRegistrationFn,
  prepareStageSessionFn,
  recordChampionshipMatchWoFn,
  recordGroupStageTieBreakDecisionFn,
  setChampionshipMatchPerformancesFn,
  startChampionshipGroupStageFn,
  startChampionshipMatchFn,
  startChampionshipPresentationFn,
  updateChampionshipFn,
} from "@/lib/championship.functions";

export const Route = createFileRoute("/campeonatos/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Gerenciar Campeonato — BatalhaOkê" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChampionshipAdminPage,
});

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  registration_open: "Inscrições abertas",
  registration_closed: "Inscrições encerradas",
  drawn: "Sorteado",
  group_stage: "Fase de grupos",
  group_stage_completed: "Fase de grupos concluída",
  quarter_finals: "Quartas de final",
  semi_finals: "Semifinais",
  final: "Final",
  completed: "Concluído",
  cancelled: "Cancelado",
};
const entryStatusLabels: Record<string, string> = {
  confirmed: "Confirmada",
  waitlist: "Lista de espera",
  withdrawn: "Desistiu",
  disqualified: "Desclassificada",
};
const stageLabels: Record<string, string> = {
  quarter_final: "Quartas de final",
  semi_final: "Semifinal",
  final: "Final",
};
type AdminEntry = Awaited<ReturnType<typeof listChampionshipEntriesFn>>[number];

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function isoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ChampionshipAdminPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const championshipFn = useServerFn(getChampionshipFn);
  const entriesFn = useServerFn(listChampionshipEntriesFn);
  const drawFn = useServerFn(getChampionshipDrawFn);
  const scheduleFn = useServerFn(getChampionshipScheduleFn);
  const standingsFn = useServerFn(getChampionshipStandingsFn);
  const boardFn = useServerFn(getChampionshipEliminationBoardFn);
  const scoreFn = useServerFn(getChampionshipMatchScoreFn);
  const updateFn = useServerFn(updateChampionshipFn);
  const openRegistrationFn = useServerFn(openChampionshipRegistrationFn);
  const closeRegistrationFn = useServerFn(closeChampionshipRegistrationFn);
  const drawActionFn = useServerFn(drawChampionshipFn);
  const startGroupStageFn = useServerFn(startChampionshipGroupStageFn);
  const tieBreakFn = useServerFn(recordGroupStageTieBreakDecisionFn);
  const finalizeGroupsFn = useServerFn(finalizeGroupStageAndGenerateQuarterFinalsFn);
  const prepareStageFn = useServerFn(prepareStageSessionFn);
  const activateStageFn = useServerFn(activateStageSessionFn);
  const setPerformancesFn = useServerFn(setChampionshipMatchPerformancesFn);
  const startMatchFn = useServerFn(startChampionshipMatchFn);
  const startPresentationFn = useServerFn(startChampionshipPresentationFn);
  const completePresentationFn = useServerFn(completeChampionshipPresentationFn);
  const openVotingFn = useServerFn(openChampionshipMatchVotingFn);
  const closeVotingFn = useServerFn(closeChampionshipMatchVotingFn);
  const advanceFn = useServerFn(advanceChampionshipEliminationFn);
  const woFn = useServerFn(recordChampionshipMatchWoFn);
  const completeFn = useServerFn(completeChampionshipFn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<8 | 12 | 16>(8);
  const [startsAt, setStartsAt] = useState("");
  const [deadline, setDeadline] = useState("");
  const [location, setLocation] = useState("");
  const [rules, setRules] = useState("");
  const [prizeInfo, setPrizeInfo] = useState("");
  const [feeInfo, setFeeInfo] = useState("");
  const [tieOrders, setTieOrders] = useState<Record<string, string[]>>({});
  const [tieRationales, setTieRationales] = useState<Record<string, string>>({});
  const [performanceChoices, setPerformanceChoices] = useState<Record<string, { a: string; b: string }>>({});
  const [woChoices, setWoChoices] = useState<Record<string, { withdrawnId: string; reason: string }>>({});

  const championship = useQuery({
    queryKey: ["championship", id],
    queryFn: () => championshipFn({ data: { championshipId: id } }),
    retry: false,
  });
  const entries = useQuery({
    queryKey: ["championship-entries", id],
    queryFn: () => entriesFn({ data: { championshipId: id } }),
    enabled: championship.isSuccess,
  });
  const draw = useQuery({
    queryKey: ["championship-draw", id],
    queryFn: () => drawFn({ data: { championshipId: id } }),
    enabled: championship.isSuccess && !["draft", "registration_open", "registration_closed"].includes(championship.data.championship.status),
    retry: false,
  });
  const schedule = useQuery({
    queryKey: ["championship-schedule", id],
    queryFn: () => scheduleFn({ data: { championshipId: id } }),
    enabled: draw.isSuccess,
    retry: false,
  });
  const standings = useQuery({
    queryKey: ["championship-standings", id],
    queryFn: () => standingsFn({ data: { championshipId: id } }),
    enabled: draw.isSuccess && draw.data.format !== 8,
    retry: false,
  });
  const board = useQuery({
    queryKey: ["championship-elimination-board", id],
    queryFn: () => boardFn({ data: { championshipId: id } }),
    enabled: championship.isSuccess,
    retry: false,
  });
  const scoreQueries = useQueries({
    queries: (board.data?.matches ?? []).map((match) => ({
      queryKey: ["championship-match-score", id, match.id],
      queryFn: () => scoreFn({ data: { matchId: match.id } }),
      enabled: true,
      retry: false,
    })),
  });

  useEffect(() => {
    const event = championship.data?.championship;
    if (!event) return;
    setTitle(event.title);
    setFormat(event.format as 8 | 12 | 16);
    setStartsAt(localDateTime(event.event_starts_at));
    setDeadline(localDateTime(event.registration_deadline));
    setLocation(event.location ?? "");
    setRules(event.rules ?? "");
    setPrizeInfo(event.prize_info ?? "");
    setFeeInfo(event.fee_info ?? "");
  }, [championship.data]);

  useEffect(() => {
    const venueId = championship.data?.championship.venue_id;
    if (!venueId) return;
    const channel = supabase
      .channel(`venue-live:${venueId}`)
      .on("broadcast", { event: "invalidate" }, () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["championship", id] }),
          queryClient.invalidateQueries({ queryKey: ["championship-entries", id] }),
          queryClient.invalidateQueries({ queryKey: ["championship-draw", id] }),
          queryClient.invalidateQueries({ queryKey: ["championship-schedule", id] }),
          queryClient.invalidateQueries({ queryKey: ["championship-standings", id] }),
          queryClient.invalidateQueries({ queryKey: ["championship-elimination-board", id] }),
          queryClient.invalidateQueries({ queryKey: ["championship-match-score", id] }),
          queryClient.invalidateQueries({ queryKey: ["championships"] }),
        ]);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [championship.data?.championship.venue_id, id, queryClient]);

  const event = championship.data?.championship;
  const allEntries = entries.data ?? [];
  const confirmed = allEntries.filter((entry) => entry.status === "confirmed");
  const waitlisted = allEntries.filter((entry) => entry.status === "waitlist");
  const occupied = confirmed.length;
  const available = Math.max((event?.format ?? 0) - occupied, 0);

  async function refreshData(message?: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["championship", id] }),
      queryClient.invalidateQueries({ queryKey: ["championship-entries", id] }),
      queryClient.invalidateQueries({ queryKey: ["championship-draw", id] }),
      queryClient.invalidateQueries({ queryKey: ["championship-schedule", id] }),
      queryClient.invalidateQueries({ queryKey: ["championship-standings", id] }),
      queryClient.invalidateQueries({ queryKey: ["championship-elimination-board", id] }),
      queryClient.invalidateQueries({ queryKey: ["championship-match-score", id] }),
      queryClient.invalidateQueries({ queryKey: ["championships"] }),
    ]);
    if (message) setNotice(message);
  }

  async function act(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refreshData(successMessage);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await act(
      () => updateFn({
        data: {
          championshipId: id,
          patch: {
            title,
            format,
            eventStartsAt: isoDateTime(startsAt),
            registrationDeadline: isoDateTime(deadline),
            location: location || null,
            rules: rules || null,
            prizeInfo: prizeInfo || null,
            feeInfo: feeInfo || null,
          },
        },
      }),
      "Rascunho atualizado.",
    );
  }

  if (championship.isLoading) {
    return <Centered>Verificando acesso e carregando Campeonato…</Centered>;
  }
  if (championship.isError) {
    return (
      <Centered>
        <p role="alert" className="text-destructive">
          {(championship.error as Error).message || "Esta tela é restrita a operadores autorizados."}
        </p>
        <Button asChild className="mt-4"><Link to="/login">Entrar</Link></Button>
      </Centered>
    );
  }
  if (!event) return <Centered>Campeonato não encontrado.</Centered>;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link
          to="/campeonatos"
          aria-label="Voltar à lista de Campeonatos"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-display text-3xl leading-none">Campeonato</p>
          <h1 className="mt-1 truncate text-sm text-muted-foreground">{event.title}</h1>
        </div>
        <Trophy className="size-6 text-primary" aria-hidden />
      </header>

      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Estado do evento</p>
            <p className="mt-1 text-xl font-semibold">{statusLabels[event.status] ?? event.status}</p>
            <p className="mt-1 text-sm text-muted-foreground">Formato {event.format} · {event.location || "Local não definido"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {event.status === "draft" && (
              <Button disabled={busy} onClick={() => void act(
                () => openRegistrationFn({ data: { championshipId: id } }),
                "Inscrições abertas. A sessão de palco não foi criada nem iniciada.",
              )}>Abrir inscrições</Button>
            )}
            {event.status === "registration_open" && (
              <Button variant="secondary" disabled={busy} onClick={() => void act(
                () => closeRegistrationFn({ data: { championshipId: id } }),
                "Inscrições encerradas.",
              )}>Encerrar inscrições</Button>
            )}
            {event.status === "registration_closed" && (
              <Button disabled={busy} onClick={() => void act(
                () => drawActionFn({ data: { championshipId: id } }),
                "Sorteio realizado pelo servidor.",
              )}>Executar sorteio</Button>
            )}
            {event.status === "drawn" && event.format !== 8 && (
              <Button disabled={busy} onClick={() => void act(
                () => startGroupStageFn({ data: { championshipId: id } }),
                "Fase de grupos iniciada.",
              )}>Iniciar fase de grupos</Button>
            )}
          </div>
        </div>
        {notice && <p role="status" className="mt-4 rounded-lg bg-success/10 p-3 text-sm text-success">{notice}</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Dados do evento</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <Detail label="Data e horário" value={event.event_starts_at ? new Date(event.event_starts_at).toLocaleString("pt-BR") : "Não definidos"} />
          <Detail label="Prazo de inscrição" value={event.registration_deadline ? new Date(event.registration_deadline).toLocaleString("pt-BR") : "Não definido"} />
          <Detail label="Local" value={event.location || "Não definido"} />
          <Detail label="Premiação" value={event.prize_info || "Não informada"} />
          <Detail label="Inscrição / cobrança" value={event.fee_info || "Não informada"} />
          <Detail label="Descrição e regulamento" value={event.rules || "Não informados"} wide />
        </dl>
      </section>

      <section className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="text-lg font-semibold">Inscrições</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Vagas ocupadas" value={`${occupied} / ${event.format}`} />
          <Stat label="Disponíveis" value={available} />
          <Stat label="Lista de espera" value={waitlisted.length} />
        </div>
        {entries.isLoading && <p className="mt-4 text-sm text-muted-foreground">Carregando inscrições…</p>}
        {entries.isError && <p role="alert" className="mt-4 text-sm text-destructive">{(entries.error as Error).message}</p>}
        <div className="mt-4 flex flex-col gap-5">
          <EntryGroup title="Inscritos confirmados" entries={confirmed} />
          <EntryGroup title="Lista de espera" entries={waitlisted} />
          {allEntries.filter((entry) => !["confirmed", "waitlist"].includes(entry.status)).length > 0 && (
            <EntryGroup title="Outros estados" entries={allEntries.filter((entry) => !["confirmed", "waitlist"].includes(entry.status))} />
          )}
        </div>
      </section>

      {event.status === "draft" && (
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Dados do rascunho</h2>
          <form onSubmit={(formEvent) => void saveDraft(formEvent)} className="mt-4 flex flex-col gap-4">
            <div>
              <Label htmlFor="edit-title">Título</Label>
              <Input id="edit-title" className="mt-2" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-format">Formato</Label>
              <select
                id="edit-format"
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3"
                disabled={championship.data.entryCount > 0}
                value={format}
                onChange={(e) => setFormat(Number(e.target.value) as 8 | 12 | 16)}
              >
                <option value={8}>8 participantes</option>
                <option value={12}>12 participantes</option>
                <option value={16}>16 participantes</option>
              </select>
              {championship.data.entryCount > 0 && <p className="mt-1 text-xs text-muted-foreground">O formato fica bloqueado após a primeira inscrição.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="edit-start">Data e horário</Label><Input id="edit-start" className="mt-2" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
              <div><Label htmlFor="edit-deadline">Prazo de inscrição</Label><Input id="edit-deadline" className="mt-2" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
            </div>
            <div><Label htmlFor="edit-location">Local</Label><Input id="edit-location" className="mt-2" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} /></div>
            <div><Label htmlFor="edit-rules">Descrição e regulamento</Label><Textarea id="edit-rules" className="mt-2 min-h-24" maxLength={5000} value={rules} onChange={(e) => setRules(e.target.value)} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="edit-prize">Premiação</Label><Textarea id="edit-prize" className="mt-2" maxLength={1000} value={prizeInfo} onChange={(e) => setPrizeInfo(e.target.value)} /></div>
              <div><Label htmlFor="edit-fee">Informações de cobrança</Label><Textarea id="edit-fee" className="mt-2" maxLength={1000} value={feeInfo} onChange={(e) => setFeeInfo(e.target.value)} /></div>
            </div>
            <Button type="submit" className="self-end" disabled={busy}>Salvar rascunho</Button>
          </form>
        </section>
      )}

      {draw.isError && !["draft", "registration_open", "registration_closed"].includes(event.status) && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{(draw.error as Error).message}</p>
      )}
      {standings.isError && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{(standings.error as Error).message}</p>}
      {draw.data && (
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Sorteio e calendário</h2>
              <p className="mt-1 text-sm text-muted-foreground">Posições geradas pelo servidor; a distribuição não pode ser editada.</p>
            </div>
            {schedule.isFetching && <RefreshCw className="size-4 animate-spin text-muted-foreground" aria-label="Atualizando calendário" />}
          </div>
          {draw.data.format === 8 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(schedule.data?.matches ?? []).map((match) => (
                <div key={match.id} className="rounded-xl border p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Quartas · Confronto {match.match_number}</p>
                  <p className="mt-2">{entryName(allEntries, match.entry_a_id)} <span className="text-muted-foreground">×</span> {entryName(allEntries, match.entry_b_id)}</p>
                </div>
              ))}
              {schedule.isError && <p role="alert" className="text-sm text-destructive">{(schedule.error as Error).message}</p>}
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {draw.data.groups.map((group) => (
                  <div key={group.groupLetter} className="rounded-xl border p-3">
                    <h3 className="font-semibold">Grupo {group.groupLetter}</h3>
                    <ol className="mt-2 space-y-1 text-sm">
                      {group.entries.map((entry) => (
                        <li key={entry.id} className="flex justify-between gap-2">
                          <span>{entry.seed_number}. {entry.stage_name || entry.name}</span>
                          <span className="text-muted-foreground">Apresentação {entry.seed_number}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
              <h3 className="mt-5 font-semibold">Calendário intercalado de apresentações</h3>
              <ol className="mt-2 grid gap-2 sm:grid-cols-2">
                {(schedule.data?.presentations ?? []).map((entry) => (
                  <li key={entry.id} className="rounded-lg border px-3 py-2 text-sm">
                    <strong>#{entry.presentation_number}</strong> · Grupo {entry.group_letter}, posição {entry.group_position}: {entry.stage_name || entry.name}
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {draw.data?.format !== 8 && standings.data && (
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Classificação e desempates</h2>
          <p className="mt-1 text-sm text-muted-foreground">Critérios automáticos: aprovação, likes e menor número de dislikes; empate integral exige decisão manual.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {standings.data.groups.map((group) => (
              <div key={group.groupLetter} className="rounded-xl border p-3">
                <h3 className="font-semibold">Grupo {group.groupLetter}</h3>
                <div className="mt-2 flex flex-col gap-2">
                  {group.entries.map((entry) => (
                    <div key={entry.id} className="rounded-lg bg-secondary/50 p-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span><strong>{entry.position}º{entry.tied ? " · Empate" : ""}</strong> {entry.stageName || entry.name}</span>
                        <Eligibility value={entry.qualified} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.noVotes ? "Sem votos" : `${entry.approval!.toFixed(1)}% de aprovação`} · {entry.likes} likes · {entry.dislikes} dislikes
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {standings.data.format === 12 && (
            <div className="mt-5 rounded-xl border p-3">
              <h3 className="font-semibold">Disputa pelas duas vagas de melhor terceiro</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {standings.data.thirdPlace.map((entry) => (
                  <div key={entry.id} className="rounded-lg bg-secondary/50 p-2 text-sm">
                    <div className="flex justify-between gap-2"><span><strong>{entry.position}º geral</strong> · Grupo {entry.groupLetter} · {entry.stageName || entry.name}{entry.tied ? " · Empate" : ""}</span><Eligibility value={entry.qualified} /></div>
                    <p className="mt-1 text-xs text-muted-foreground">{entry.noVotes ? "Sem votos" : `${entry.approval!.toFixed(1)}% de aprovação`} · {entry.likes} likes · {entry.dislikes} dislikes</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {standings.data.unresolvedTies.length > 0 && (
            <div className="mt-5 flex flex-col gap-3">
              <h3 className="font-semibold">Decisões manuais pendentes</h3>
              {standings.data.unresolvedTies.map((tie) => (
                <TieBreakCard
                  key={`${tie.groupLetter ?? "third"}-${tie.tiedEntryIds.join("-")}`}
                  tie={tie}
                  order={tieOrders[tie.tiedEntryIds.join("|")] ?? tie.tiedEntryIds}
                  rationale={tieRationales[tie.tiedEntryIds.join("|")] ?? ""}
                  disabled={busy}
                  onOrderChange={(order) => setTieOrders((current) => ({ ...current, [tie.tiedEntryIds.join("|")]: order }))}
                  onRationaleChange={(value) => setTieRationales((current) => ({ ...current, [tie.tiedEntryIds.join("|")]: value }))}
                  onSave={() => void act(
                    () => tieBreakFn({
                      data: {
                        championshipId: id,
                        groupLetter: tie.groupLetter,
                        tiedEntryIds: tie.tiedEntryIds,
                        criteriaApplied: ["approval", "likes", "dislikes"],
                        chosenOrder: tieOrders[tie.tiedEntryIds.join("|")] ?? tie.tiedEntryIds,
                        rationale: tieRationales[tie.tiedEntryIds.join("|")]?.trim() || null,
                      },
                    }),
                    "Decisão de desempate registrada.",
                  )}
                />
              ))}
            </div>
          )}
          {standings.data.tieDecisions.length > 0 && (
            <div className="mt-5">
              <h3 className="font-semibold">Decisões registradas</h3>
              <div className="mt-2 flex flex-col gap-2">
                {standings.data.tieDecisions.map((decision, index) => (
                  <div key={`${decision.groupLetter ?? "third"}-${index}`} className="rounded-xl border p-3 text-sm">
                    <p className="font-medium">{decision.groupLetter ? `Grupo ${decision.groupLetter}` : "Melhores terceiros"}: {decision.tiedEntries.map((entry) => entry.name).join(", ")}</p>
                    <p className="mt-1 text-muted-foreground">Critérios: {decision.criteriaApplied.join(" → ")}. Ordem escolhida: {decision.chosenOrder.map((entry) => entry.name).join(" → ")}.</p>
                    <p className="mt-1 text-muted-foreground">Justificativa: {decision.rationale || "Não informada."}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {event.status === "group_stage" && (
            <Button className="mt-5" disabled={busy || standings.data.unresolvedTies.length > 0} onClick={() => void act(
              () => finalizeGroupsFn({ data: { championshipId: id } }),
              "Fase de grupos finalizada e quartas geradas pelo servidor.",
            )}>Finalizar fase de grupos e gerar quartas</Button>
          )}
        </section>
      )}

      {event.status !== "draft" && event.status !== "registration_open" && event.status !== "registration_closed" && (
        <StageSessionPanel
          stageSession={championship.data.stageSession}
          busy={busy}
          onPrepare={() => void act(
            () => prepareStageFn({ data: { championshipId: id } }),
            "Sessão de palco preparada em rascunho.",
          )}
          onActivate={() => {
            const session = championship.data.stageSession;
            if (session) void act(
              () => activateStageFn({ data: { championshipId: id, sessionId: session.id } }),
              "Sessão de palco iniciada.",
            );
          }}
        />
      )}
      {board.isError && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{(board.error as Error).message}</p>}

      {board.data && board.data.matches.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Operação das eliminatórias</h2>
              <p className="mt-1 text-sm text-muted-foreground">Vencedores e avanço são determinados pelas funções de servidor e regras do Campeonato.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void refreshData()}><RefreshCw className="size-4" /> Atualizar</Button>
          </div>
          <div className="mt-4 flex flex-col gap-5">
            {(["quarter_final", "semi_final", "final"] as const).map((stage) => {
              const stageMatches = board.data.matches.filter((match) => match.stage === stage);
              if (!stageMatches.length) return null;
              return (
                <div key={stage}>
                  <h3 className="mb-2 font-semibold">{stageLabels[stage]}</h3>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {stageMatches.map((match) => {
                      const scoreIndex = board.data.matches.findIndex((candidate) => candidate.id === match.id);
                      const scoreQuery = scoreQueries[scoreIndex];
                      const score = scoreQuery?.data;
                      const choice = performanceChoices[match.id] ?? { a: match.performance_a_id ?? "", b: match.performance_b_id ?? "" };
                      const woChoice = woChoices[match.id] ?? { withdrawnId: "", reason: "" };
                      const completed = match.status === "completed" || match.status === "wo";
                      return (
                        <article key={match.id} className="rounded-xl border p-3">
                          <div className="flex flex-wrap justify-between gap-2">
                            <strong>Confronto {match.match_number}</strong>
                            <span className="rounded-full bg-secondary px-2 py-1 text-xs">{matchStatus(match.status)}</span>
                          </div>
                          <p className="mt-2 font-medium">{entryName(allEntries, match.entry_a_id)} <span className="text-muted-foreground">×</span> {entryName(allEntries, match.entry_b_id)}</p>
                          {match.winner_entry_id && <p className="mt-1 text-sm text-success">Vencedor: {entryName(allEntries, match.winner_entry_id)}</p>}
                          {score && (
                            <p className="mt-2 rounded-lg bg-secondary/60 p-2 text-sm">
                              Placar {score.result === "pending" ? "parcial" : "definitivo"}: {entryName(allEntries, match.entry_a_id)} {score.votesA} × {score.votesB} {entryName(allEntries, match.entry_b_id)} · votação {score.votingStatus === "open" ? `aberta até ${score.votingEndsAt ? new Date(score.votingEndsAt).toLocaleTimeString("pt-BR") : "—"}` : score.votingStatus === "closed" ? "encerrada" : "não aberta"}
                            </p>
                          )}
                          {scoreQuery?.isError && (
                            <p role="alert" className="mt-2 text-xs text-destructive">{(scoreQuery.error as Error).message}</p>
                          )}
                          {!completed && (
                            <div className="mt-3 flex flex-col gap-3 border-t pt-3">
                              {match.status === "scheduled" && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <select aria-label={`Apresentação A do confronto ${match.match_number}`} className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={choice.a} onChange={(e) => setPerformanceChoices((current) => ({ ...current, [match.id]: { ...choice, a: e.target.value } }))}>
                                    <option value="">Selecionar apresentação A</option>
                                    {board.data.performances
                                      .filter((performance) => performance.status === "queued" &&
                                        allEntries.some((entry) => entry.id === match.entry_a_id && entry.participant_id === performance.participant_id) &&
                                        (!board.data.matches.some((other) => other.id !== match.id && (other.performance_a_id === performance.id || other.performance_b_id === performance.id)) || performance.id === match.performance_a_id))
                                      .map((performance) => <option key={performance.id} value={performance.id}>{entryName(allEntries, match.entry_a_id)} · na fila</option>)}
                                  </select>
                                  <select aria-label={`Apresentação B do confronto ${match.match_number}`} className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={choice.b} onChange={(e) => setPerformanceChoices((current) => ({ ...current, [match.id]: { ...choice, b: e.target.value } }))}>
                                    <option value="">Selecionar apresentação B</option>
                                    {board.data.performances
                                      .filter((performance) => performance.status === "queued" &&
                                        allEntries.some((entry) => entry.id === match.entry_b_id && entry.participant_id === performance.participant_id) &&
                                        (!board.data.matches.some((other) => other.id !== match.id && (other.performance_a_id === performance.id || other.performance_b_id === performance.id)) || performance.id === match.performance_b_id))
                                      .map((performance) => <option key={performance.id} value={performance.id}>{entryName(allEntries, match.entry_b_id)} · na fila</option>)}
                                  </select>
                                  <Button className="sm:col-span-2" variant="secondary" disabled={busy || !choice.a || !choice.b || choice.a === choice.b} onClick={() => void act(
                                    () => setPerformancesFn({ data: { matchId: match.id, performanceAId: choice.a, performanceBId: choice.b } }),
                                    "Apresentações associadas ao confronto.",
                                  )}>Associar apresentações</Button>
                                </div>
                              )}
                              {match.status === "scheduled" && match.performance_a_id && match.performance_b_id && (
                                <Button disabled={busy} onClick={() => void act(
                                  () => startMatchFn({ data: { matchId: match.id } }),
                                  "Confronto iniciado.",
                                )}>Iniciar confronto</Button>
                              )}
                              {match.status === "in_progress" && (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {(["a", "b"] as const).map((slot) => {
                                    const perfId = slot === "a" ? match.performance_a_id : match.performance_b_id;
                                    const performance = board.data.performances.find((candidate) => candidate.id === perfId);
                                    const label = `Apresentação ${slot.toUpperCase()}`;
                                    return (
                                      <Button key={slot} variant="secondary" disabled={busy || !performance} onClick={() => void act(
                                        () => performance?.status === "completed"
                                          ? Promise.resolve()
                                          : performance?.status === "in_progress"
                                            ? completePresentationFn({ data: { matchId: match.id, slot } })
                                            : startPresentationFn({ data: { matchId: match.id, slot } }),
                                        performance?.status === "completed" ? undefined : `${label} ${performance?.status === "in_progress" ? "encerrada" : "iniciada"}.`,
                                      )}>{performance?.status === "completed" ? `${label} concluída` : performance?.status === "in_progress" ? `Encerrar ${label}` : `Iniciar ${label}`}</Button>
                                    );
                                  })}
                                  {match.voting_status === "idle" && <Button variant="secondary" disabled={busy || board.data.performances.find((performance) => performance.id === match.performance_a_id)?.status !== "completed" || board.data.performances.find((performance) => performance.id === match.performance_b_id)?.status !== "completed"} onClick={() => void act(() => openVotingFn({ data: { matchId: match.id } }), "Votação do confronto aberta.")}>Abrir votação</Button>}
                                  {match.voting_status === "open" && <Button variant="secondary" disabled={busy} onClick={() => void act(() => closeVotingFn({ data: { matchId: match.id } }), "Votação encerrada.")}>Encerrar votação</Button>}
                                </div>
                              )}
                              {(match.status === "scheduled" || match.status === "in_progress") && (
                                <div className="rounded-lg border p-3">
                                  <p className="text-sm font-medium">Registrar desistência / WO</p>
                                  <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={woChoice.withdrawnId} onChange={(e) => setWoChoices((current) => ({ ...current, [match.id]: { ...woChoice, withdrawnId: e.target.value } }))}>
                                    <option value="">Selecione quem desistiu</option>
                                    {[match.entry_a_id, match.entry_b_id].filter((entryId): entryId is string => !!entryId).map((entryId) => <option key={entryId} value={entryId}>{entryName(allEntries, entryId)}</option>)}
                                  </select>
                                  <Textarea className="mt-2" maxLength={1000} placeholder="Justificativa obrigatória" value={woChoice.reason} onChange={(e) => setWoChoices((current) => ({ ...current, [match.id]: { ...woChoice, reason: e.target.value } }))} />
                                  <Button className="mt-2" variant="destructive" disabled={busy || !woChoice.withdrawnId || !woChoice.reason.trim()} onClick={() => void act(
                                    () => woFn({ data: { matchId: match.id, withdrawnEntryId: woChoice.withdrawnId, reason: woChoice.reason.trim() } }),
                                    "WO auditado registrado; o vencedor foi determinado pelas regras do servidor.",
                                  )}>Registrar WO</Button>
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {(event.status === "quarter_finals" || event.status === "semi_finals") && (
            <Button className="mt-5" disabled={busy} onClick={() => void act(
              () => advanceFn({ data: { championshipId: id } }),
              "Próxima fase gerada a partir dos vencedores apurados.",
            )}>Avançar vencedores para a próxima fase</Button>
          )}
          {event.status === "final" && (
            <Button className="mt-5" disabled={busy || !board.data.matches.some((match) => match.stage === "final" && ["completed", "wo"].includes(match.status))} onClick={() => void act(
              () => completeFn({ data: { championshipId: id } }),
              "Campeonato homologado.",
            )}>Homologar encerramento do Campeonato</Button>
          )}
        </section>
      )}
    </main>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center px-5 text-center">{children}</main>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-secondary/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>;
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : ""}><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{value}</dd></div>;
}

function EntryGroup({ title, entries }: { title: string; entries: AdminEntry[] }) {
  return (
    <div>
      <h3 className="font-semibold">{title} <span className="text-sm font-normal text-muted-foreground">({entries.length})</span></h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhuma inscrição.</p>
      ) : (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {entries.map((entry) => (
            <article key={entry.id} className="rounded-xl border p-3">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-medium">{entry.stage_name || entry.name}</p>{entry.stage_name && <p className="text-xs text-muted-foreground">{entry.name}</p>}</div>
                <span className="rounded-full bg-secondary px-2 py-1 text-xs">{entryStatusLabels[entry.status] ?? entry.status}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Telefone: {entry.contact_phone || "—"} · E-mail: {entry.contact_email || "—"}</p>
              {entry.group_letter && <p className="mt-1 text-xs text-muted-foreground">Grupo {entry.group_letter} · posição sorteada {entry.seed_number}</p>}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(["main", "reserve"] as const).map((songType) => {
                  const songs = (entry.songs ?? [])
                    .filter((song) => song.song_type === songType)
                    .sort((left, right) => left.song_order - right.song_order);
                  return (
                    <div key={songType}>
                      <p className="text-xs font-semibold">{songType === "main" ? "Músicas principais" : "Reservas"}</p>
                      {songs.length ? songs.map((song) => <p key={`${songType}-${song.song_order}`} className="mt-1 text-xs text-muted-foreground">{song.song_order}. {song.source?.title ?? "Música"}</p>) : <p className="mt-1 text-xs text-muted-foreground">Nenhuma</p>}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Eligibility({ value }: { value: boolean | null }) {
  return <span className={`shrink-0 text-xs font-semibold ${value === true ? "text-success" : value === false ? "text-muted-foreground" : "text-amber-600"}`}>
    {value === true ? "Classifica" : value === false ? "Não classifica" : "Pendente de desempate"}
  </span>;
}

function TieBreakCard({
  tie,
  order,
  rationale,
  disabled,
  onOrderChange,
  onRationaleChange,
  onSave,
}: {
  tie: {
    groupLetter: string | null;
    tiedEntryIds: string[];
    entries: { id: string; name: string; stageName: string | null }[];
    criteriaApplied: string[];
  };
  order: string[];
  rationale: string;
  disabled: boolean;
  onOrderChange: (order: string[]) => void;
  onRationaleChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-500/40 p-3">
      <h4 className="font-medium">{tie.groupLetter ? `Grupo ${tie.groupLetter}` : "Disputa entre melhores terceiros"} · Participantes empatados</h4>
      <p className="mt-1 text-sm text-muted-foreground">{tie.entries.map((entry) => entry.stageName || entry.name).join(" · ")}</p>
      <p className="mt-2 text-xs text-muted-foreground">Critérios já aplicados: aprovação percentual → likes → menor número de dislikes.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {order.map((entryId, index) => (
          <div key={`${entryId}-${index}`}>
            <Label htmlFor={`tie-${tie.tiedEntryIds.join("-")}-${index}`}>Ordem escolhida · posição {index + 1}</Label>
            <select
              id={`tie-${tie.tiedEntryIds.join("-")}-${index}`}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={entryId}
              onChange={(event) => {
                const next = [...order];
                const oldIndex = next.indexOf(event.target.value);
                if (oldIndex >= 0) next[oldIndex] = entryId;
                next[index] = event.target.value;
                onOrderChange(next);
              }}
            >
              {tie.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.stageName || entry.name}</option>)}
            </select>
          </div>
        ))}
      </div>
      <Label htmlFor={`tie-rationale-${tie.tiedEntryIds.join("-")}`} className="mt-3 block">Justificativa</Label>
      <Textarea id={`tie-rationale-${tie.tiedEntryIds.join("-")}`} className="mt-1" required maxLength={1000} value={rationale} onChange={(event) => onRationaleChange(event.target.value)} />
      <Button className="mt-3" disabled={disabled || !rationale.trim()} onClick={onSave}>Registrar decisão no servidor</Button>
    </div>
  );
}

function StageSessionPanel({
  stageSession,
  busy,
  onPrepare,
  onActivate,
}: {
  stageSession: { id: string; status: string; name: string } | null;
  busy: boolean;
  onPrepare: () => void;
  onActivate: () => void;
}) {
  return (
    <section className="rounded-2xl border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Sessão de palco</h2>
      <p className="mt-1 text-sm text-muted-foreground">A sessão só é preparada ou iniciada em uma ação explícita, após o sorteio.</p>
      {!stageSession ? (
        <Button className="mt-3" disabled={busy} onClick={onPrepare}>Preparar sessão em rascunho</Button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm">{stageSession.name} · {stageSession.status === "active" ? "ativa" : stageSession.status}</span>
          {stageSession.status === "draft" && <Button disabled={busy} onClick={onActivate}>Iniciar sessão de palco</Button>}
          <Button asChild variant="secondary"><Link to="/sessao/$id" params={{ id: stageSession.id }}>Abrir painel da sessão</Link></Button>
        </div>
      )}
    </section>
  );
}

function entryName(entries: Array<{ id: string; name: string; stage_name?: string | null }>, entryId: string | null) {
  if (!entryId) return "A definir";
  const entry = entries.find((candidate) => candidate.id === entryId);
  return entry?.stage_name || entry?.name || "Participante";
}

function matchStatus(status: string) {
  if (status === "scheduled") return "Agendado";
  if (status === "in_progress") return "Em andamento";
  if (status === "completed") return "Concluído";
  if (status === "wo") return "WO";
  return status;
}
