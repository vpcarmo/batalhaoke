import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Plus, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listOperatorVenues } from "@/lib/venue.functions";
import { createChampionshipFn, listChampionshipsFn } from "@/lib/championship.functions";

export const Route = createFileRoute("/campeonatos")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Campeonatos — BatalhaOkê" }, { name: "robots", content: "noindex" }],
  }),
  component: ChampionshipsPage,
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

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ChampionshipsPage() {
  const hasDetailChild = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/campeonatos/$id"),
  });
  return hasDetailChild ? <Outlet /> : <ChampionshipsIndexPage />;
}

function ChampionshipsIndexPage() {
  const queryClient = useQueryClient();
  const venues = useQuery({ queryKey: ["operator-venues"], queryFn: listOperatorVenues, retry: 1 });
  const listFn = useServerFn(listChampionshipsFn);
  const createFn = useServerFn(createChampionshipFn);
  const [venueId, setVenueId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<8 | 12 | 16>(8);
  const [startsAt, setStartsAt] = useState("");
  const [deadline, setDeadline] = useState("");
  const [location, setLocation] = useState("");
  const [rules, setRules] = useState("");
  const [prizeInfo, setPrizeInfo] = useState("");
  const [feeInfo, setFeeInfo] = useState("");
  const championships = useQuery({
    queryKey: ["championships", venueId],
    queryFn: () => listFn({ data: { venueId } }),
    enabled: !!venueId,
    retry: 1,
  });

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!venueId) {
      setError("Selecione o estabelecimento.");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          venueId,
          title,
          format,
          eventStartsAt: toIso(startsAt),
          registrationDeadline: toIso(deadline),
          location: location || null,
          rules: rules || null,
          prizeInfo: prizeInfo || null,
          feeInfo: feeInfo || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["championships", venueId] });
      setTitle("");
      setStartsAt("");
      setDeadline("");
      setLocation("");
      setRules("");
      setPrizeInfo("");
      setFeeInfo("");
      setFormOpen(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link
          to="/"
          aria-label="Voltar ao início"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-display text-3xl leading-none">Campeonatos</p>
          <p className="mt-1 text-sm text-muted-foreground">Administração do estabelecimento</p>
        </div>
        <Trophy className="size-6 text-primary" aria-hidden />
      </header>

      {venues.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando estabelecimentos…</p>
      )}
      {venues.isError && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          Não foi possível carregar seus estabelecimentos. Entre com uma conta de operador
          autorizada.
        </p>
      )}
      {!!venues.data?.length && (
        <section className="rounded-2xl border bg-card p-4 sm:p-5">
          <Label htmlFor="championship-venue">Estabelecimento</Label>
          <select
            id="championship-venue"
            className="mt-2 h-11 w-full rounded-md border border-input bg-background px-3"
            value={venueId}
            onChange={(event) => setVenueId(event.target.value)}
          >
            <option value="">Selecione um estabelecimento</option>
            {venues.data.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </section>
      )}
      {venues.data?.length === 0 && !venues.isLoading && (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          Nenhum estabelecimento foi associado à sua conta de operador.
        </p>
      )}

      {!!venueId && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold">Eventos</h1>
            {!formOpen && (
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="size-4" /> Criar Campeonato
              </Button>
            )}
          </div>
          {championships.isLoading && (
            <p className="text-sm text-muted-foreground">Carregando Campeonatos…</p>
          )}
          {championships.isError && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
              {(championships.error as Error).message}
            </p>
          )}
          {(championships.data ?? []).map((championship) => (
            <Link
              key={championship.id}
              to="/campeonatos/$id"
              params={{ id: championship.id }}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-secondary"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{championship.title}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  Formato {championship.format}
                  {championship.event_starts_at &&
                    ` · ${new Date(championship.event_starts_at).toLocaleString("pt-BR")}`}
                </span>
              </span>
              <span className="rounded-full bg-secondary px-3 py-1 text-sm font-medium">
                {statusLabels[championship.status] ?? championship.status}
              </span>
            </Link>
          ))}
          {!championships.isLoading &&
            !championships.isError &&
            championships.data?.length === 0 && (
              <p className="rounded-xl border p-4 text-sm text-muted-foreground">
                Ainda não há Campeonatos neste estabelecimento.
              </p>
            )}
          {formOpen && (
            <form
              onSubmit={(event) => void createEvent(event)}
              className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5"
            >
              <h2 className="text-lg font-semibold">Novo Campeonato</h2>
              <div>
                <Label htmlFor="championship-title">Título</Label>
                <Input
                  id="championship-title"
                  className="mt-2"
                  maxLength={120}
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="championship-format">Formato</Label>
                <select
                  id="championship-format"
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3"
                  value={format}
                  onChange={(event) => setFormat(Number(event.target.value) as 8 | 12 | 16)}
                >
                  <option value={8}>8 participantes · quartas diretas</option>
                  <option value={12}>12 participantes · grupos + melhores terceiros</option>
                  <option value={16}>16 participantes · grupos</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="championship-starts">Data e horário do evento</Label>
                  <Input
                    id="championship-starts"
                    className="mt-2"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="championship-deadline">Prazo de inscrição</Label>
                  <Input
                    id="championship-deadline"
                    className="mt-2"
                    type="datetime-local"
                    value={deadline}
                    onChange={(event) => setDeadline(event.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="championship-location">Local</Label>
                <Input
                  id="championship-location"
                  className="mt-2"
                  maxLength={200}
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="championship-rules">Descrição e regulamento</Label>
                <Textarea
                  id="championship-rules"
                  className="mt-2 min-h-28"
                  maxLength={5000}
                  value={rules}
                  onChange={(event) => setRules(event.target.value)}
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  O schema atual armazena esses textos juntos no campo de regulamento.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="championship-prize">Premiação</Label>
                  <Textarea
                    id="championship-prize"
                    className="mt-2"
                    maxLength={1000}
                    value={prizeInfo}
                    onChange={(event) => setPrizeInfo(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="championship-fee">Informações de cobrança</Label>
                  <Textarea
                    id="championship-fee"
                    className="mt-2"
                    maxLength={1000}
                    value={feeInfo}
                    onChange={(event) => setFeeInfo(event.target.value)}
                  />
                  <p className="mt-1 text-sm text-muted-foreground">
                    Informação textual; não há integração de pagamento.
                  </p>
                </div>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setFormOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Criando…" : "Criar rascunho"}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
