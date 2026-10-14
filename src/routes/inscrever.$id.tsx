import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MusicSearch } from "@/components/karaoke/MusicSearch";
import type { PlaybackSearchResult } from "@/lib/playback/types";
import {
  getPublicChampionshipRegistrationFn,
  registerChampionshipEntryFn,
} from "@/lib/championship.functions";

export const Route = createFileRoute("/inscrever/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Inscrição no Campeonato — BatalhaOkê" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicChampionshipRegistrationPage,
});

type SelectedSong = PlaybackSearchResult & { type: "main" | "reserve"; order: number };

function PublicChampionshipRegistrationPage() {
  const { id } = Route.useParams();
  const registrationFn = useServerFn(getPublicChampionshipRegistrationFn);
  const submitFn = useServerFn(registerChampionshipEntryFn);
  const registration = useQuery({
    queryKey: ["public-championship-registration", id],
    queryFn: () => registrationFn({ data: { championshipId: id } }),
    retry: false,
  });
  const [name, setName] = useState("");
  const [stageName, setStageName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [slot, setSlot] = useState("main:1");
  const [songs, setSongs] = useState<Record<string, SelectedSong>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"confirmed" | "waitlist" | null>(null);

  const event = registration.data?.championship;
  const selectedSongs = Object.values(songs).sort(
    (left, right) => left.type.localeCompare(right.type) || left.order - right.order,
  );
  const confirmed = registration.data?.confirmedEntries ?? 0;
  const capacity = event?.format ?? 0;
  const available = Math.max(capacity - confirmed, 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await submitFn({
        data: {
          championshipId: id,
          name,
          stageName: stageName || null,
          contactPhone: contactPhone || null,
          contactEmail: contactEmail || null,
          songs: selectedSongs.map(({ type, order, provider, externalId, title, channelName, thumbnailUrl, duration }) => ({
            type,
            order,
            provider,
            externalId,
            title,
            channelName,
            thumbnailUrl,
            duration,
          })),
        },
      });
      setResult(response.status);
    } catch (cause) {
      setError((cause as Error).message || "Não foi possível concluir a inscrição.");
    } finally {
      setBusy(false);
    }
  }

  function chooseSong(song: PlaybackSearchResult) {
    const [type, orderText] = slot.split(":");
    if ((type !== "main" && type !== "reserve") || !orderText) return;
    const order = Number(orderText);
    setSongs((current) => ({
      ...current,
      [slot]: { ...song, type, order },
    }));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link
          to="/"
          aria-label="Voltar ao início"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-display text-3xl leading-none">Inscrição</p>
          <p className="mt-1 text-sm text-muted-foreground">BatalhaOkê Campeonato</p>
        </div>
        <Trophy className="size-6 text-primary" aria-hidden />
      </header>

      {registration.isLoading ? (
        <p className="text-muted-foreground">Carregando informações do Campeonato…</p>
      ) : registration.isError ? (
        <section className="rounded-2xl border bg-card p-5">
          <h1 className="text-xl font-semibold">Inscrições indisponíveis</h1>
          <p role="alert" className="mt-2 text-sm text-muted-foreground">
            {(registration.error as Error).message || "Este Campeonato não está aceitando inscrições."}
          </p>
        </section>
      ) : result ? (
        <section className="rounded-2xl border bg-card p-6 text-center">
          <p className="flex items-center justify-center gap-2 font-display text-3xl text-success">
            <Check className="size-7" /> Inscrição recebida
          </p>
          <p className="mt-3">
            {result === "confirmed"
              ? "Sua vaga está confirmada."
              : "As vagas estão esgotadas. Você entrou na lista de espera."}
          </p>
        </section>
      ) : event ? (
        <>
          <section className="rounded-2xl border bg-card p-5">
            <h1 className="font-display text-3xl">{event.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Formato com {event.format} participantes · {available} vaga(s) disponível(is)
            </p>
            {available === 0 && (
              <p role="status" className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm">
                As vagas estão esgotadas. Ainda é possível se inscrever na lista de espera.
              </p>
            )}
            {event.event_starts_at && (
              <p className="mt-3 text-sm">Data: {new Date(event.event_starts_at).toLocaleString("pt-BR")}</p>
            )}
            {event.registration_deadline && (
              <p className="mt-1 text-sm">
                Prazo: {new Date(event.registration_deadline).toLocaleString("pt-BR")}
              </p>
            )}
            {event.location && <p className="mt-1 text-sm">Local: {event.location}</p>}
            {event.rules && <p className="mt-3 whitespace-pre-wrap text-sm">{event.rules}</p>}
            {event.prize_info && <p className="mt-3 text-sm">Premiação: {event.prize_info}</p>}
            {event.fee_info && <p className="mt-1 text-sm">Inscrição: {event.fee_info}</p>}
          </section>

          <form onSubmit={(formEvent) => void submit(formEvent)} className="flex flex-col gap-5">
            <section className="rounded-2xl border bg-card p-5">
              <h2 className="text-lg font-semibold">Seus dados</h2>
              <div className="mt-4 flex flex-col gap-4">
                <div>
                  <Label htmlFor="entry-name">Nome completo</Label>
                  <Input id="entry-name" className="mt-2" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="entry-stage-name">Nome artístico (opcional)</Label>
                  <Input id="entry-stage-name" className="mt-2" maxLength={120} value={stageName} onChange={(event) => setStageName(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="entry-phone">Telefone</Label>
                  <Input id="entry-phone" className="mt-2" type="tel" maxLength={40} value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} />
                </div>
                <div>
                  <Label htmlFor="entry-email">E-mail</Label>
                  <Input id="entry-email" className="mt-2" type="email" maxLength={320} value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">Informe ao menos um contato: telefone ou e-mail.</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5">
              <h2 className="text-lg font-semibold">Músicas escolhidas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Escolha ao menos uma música principal. Você pode adicionar até quatro principais e duas reservas.
              </p>
              <div className="mt-4">
                <Label htmlFor="song-slot">Posição da música</Label>
                <select
                  id="song-slot"
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3"
                  value={slot}
                  onChange={(event) => setSlot(event.target.value)}
                >
                  {[1, 2, 3, 4].map((order) => (
                    <option key={`main-${order}`} value={`main:${order}`}>
                      Principal {order}{songs[`main:${order}`] ? " · já escolhida" : ""}
                    </option>
                  ))}
                  {[1, 2].map((order) => (
                    <option key={`reserve-${order}`} value={`reserve:${order}`}>
                      Reserva {order}{songs[`reserve:${order}`] ? " · já escolhida" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-4">
                <MusicSearch onPick={chooseSong} />
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {selectedSongs.map((song) => (
                  <div key={`${song.type}:${song.order}`} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {song.type === "main" ? "Principal" : "Reserva"} {song.order}
                      </p>
                      <p className="truncate text-sm font-medium">{song.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{song.channelName || "Canal não informado"}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${song.title}`}
                      onClick={() => setSongs((current) => {
                        const next = { ...current };
                        delete next[`${song.type}:${song.order}`];
                        return next;
                      })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <Button type="submit" className="h-12" disabled={busy || !selectedSongs.some((song) => song.type === "main")}>
              {busy ? "Enviando inscrição…" : "Enviar inscrição"}
            </Button>
          </form>
        </>
      ) : null}
    </main>
  );
}
