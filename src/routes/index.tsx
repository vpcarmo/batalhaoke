import { Card } from "@/components/ui/card";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic2, Tv, Play, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { createSession, getActiveSession, type VotingMode } from "@/lib/karaoke";
import type { SessionType, X1VotingMode } from "@/lib/karaoke";
import {
  deleteVenueDevice,
  disableVenueDevice,
  enableVenueDevice,
  listOperatorVenues,
  listVenueDevices,
  pairVenueDevice,
} from "@/lib/venue.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BatalhaOkê — O público decide quem continua" },
      {
        name: "description",
        content:
          "Karaokê interativo para bares, festas e eventos: cantores, apresentações e votação do público.",
      },
      { property: "og:title", content: "BatalhaOkê" },
      {
        property: "og:description",
        content: "Karaokê interativo com votação do público em tempo real.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function defaultName() {
  const d = new Date().toLocaleDateString("pt-BR", { weekday: "long" });
  return `BatalhaOkê · ${d.charAt(0).toUpperCase() + d.slice(1)}`;
}

function Home() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const active = useQuery({ queryKey: ["active-session"], queryFn: getActiveSession, retry: 1 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(defaultName);
  const [sessionType, setSessionType] = useState<SessionType>("free");
  const [votingMode, setVotingMode] = useState<VotingMode>("like_only");
  const [x1VotingMode, setX1VotingMode] = useState<X1VotingMode>("during_performance");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [venueId, setVenueId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [tvTab, setTvTab] = useState<"tv" | "device">("device");
  const [initializedDeviceVenue, setInitializedDeviceVenue] = useState<string | null>(null);
  const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null);
  const busyRef = useRef(false);
  const venues = useQuery({ queryKey: ["operator-venues"], queryFn: listOperatorVenues, retry: 1 });
  useEffect(() => {
    const authorizedVenues = venues.data ?? [];
    if (authorizedVenues.length === 1) {
      setVenueId((current) =>
        current && authorizedVenues.some((venue) => venue.id === current)
          ? current
          : authorizedVenues[0]!.id,
      );
    }
  }, [venues.data]);
  const devicesFn = useServerFn(listVenueDevices);
  const pairDeviceFn = useServerFn(pairVenueDevice);
  const disableDeviceFn = useServerFn(disableVenueDevice);
  const enableDeviceFn = useServerFn(enableVenueDevice);
  const deleteDeviceFn = useServerFn(deleteVenueDevice);
  const devices = useQuery({
    queryKey: ["venue-devices", venueId],
    queryFn: () => devicesFn({ data: { venueId } }),
    enabled: !!venueId,
    retry: 1,
  });
  useEffect(() => {
    if (!venueId || !devices.isSuccess || initializedDeviceVenue === venueId) return;
    setTvTab((devices.data ?? []).some((device) => device.status === "paired") ? "tv" : "device");
    setInitializedDeviceVenue(venueId);
  }, [venueId, devices.isSuccess, devices.data, initializedDeviceVenue]);

  function selectSessionType(type: SessionType) {
    setSessionType(type);
    if (type === "x1" || type === "championship") setVotingMode("like_dislike");
  }

  async function start() {
    if (busyRef.current) return;
    if (!venueId) {
      setErr("Selecione um estabelecimento que você administra.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const s = await createSession(name.trim() || defaultName(), {
        sessionType,
        votingMode,
        venueId,
        x1VotingMode,
      });
      nav({ to: "/sessao/$id", params: { id: s.id } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function pairTv() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    try {
      const result = await pairDeviceFn({
        data: { pairingCode: pairingCode.trim(), venueId, deviceName: deviceName.trim() },
      });
      setPairingCode("");
      setDeviceName("");
      await devices.refetch();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function updateDevice(venueDeviceId: string, action: "disable" | "enable" | "delete") {
    if (busyRef.current) return;
    busyRef.current = true;
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      if (action === "disable") {
        await disableDeviceFn({ data: { venueDeviceId } });
        setNotice("TV desabilitada.");
      } else if (action === "enable") {
        await enableDeviceFn({ data: { venueDeviceId } });
        setNotice("TV reativada.");
      } else {
        await deleteDeviceFn({ data: { venueDeviceId } });
        setNotice("TV excluída.");
      }
      await queryClient.invalidateQueries({ queryKey: ["venue-devices", venueId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function confirmDeleteDevice() {
    if (!deviceToDelete || busyRef.current) return;
    const id = deviceToDelete;
    setDeviceToDelete(null);
    void updateDevice(id, "delete");
  }

  const connectedTvCount = (devices.data ?? []).filter(
    (device) => device.status === "paired",
  ).length;

  return (
    <main className="pulso-home mx-auto grid min-h-dvh w-full max-w-6xl content-start gap-5 px-4 py-6 sm:px-6 sm:gap-6 sm:py-8">
      <header className="pulso-home-header text-center">
        <div className="mx-auto mb-2 grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow animate-in zoom-in-50 duration-500 sm:mb-4 sm:size-16">
          <Mic2 className="size-6 sm:size-8" aria-hidden />
        </div>
        <h1 className="font-display text-5xl leading-none sm:text-7xl">BatalhaOkê</h1>
        <p className="mt-2 text-base text-muted-foreground sm:mt-3 sm:text-lg">
          O público decide quem continua.
        </p>
      </header>

      <Card asChild variant="operation">
        <section className="pulso-session-actions flex flex-col gap-3 rounded-2xl border border-primary/50 bg-card p-5">
          <h2 className="font-display text-2xl">Central de operação</h2>
          <p className="text-sm text-muted-foreground">
            {(venues.data ?? []).find((venue) => venue.id === venueId)?.name ??
              "Selecione o estabelecimento ao preparar a sessão"}
          </p>
          {active.isLoading && (
            <p className="text-center text-sm text-muted-foreground">Verificando sessões…</p>
          )}
          {active.error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              Não foi possível consultar suas sessões. Verifique a conexão e entre com uma conta de
              operador autorizada.{" "}
              <Link to="/login" className="underline">
                Entrar
              </Link>
            </p>
          )}
          {active.data && (
            <Button asChild size="lg" className="h-16 text-lg font-semibold shadow-glow">
              <Link to="/sessao/$id" params={{ id: active.data.id }}>
                <Play className="size-5" /> Continuar sessão
              </Link>
            </Button>
          )}
          {active.data && (
            <p className="-mt-1 text-center text-sm text-muted-foreground">{active.data.name}</p>
          )}

          {!creating ? (
            <Button
              size="lg"
              variant={active.data ? "secondary" : "default"}
              className="h-16 text-lg font-semibold"
              onClick={() => setCreating(true)}
            >
              Iniciar nova sessão
            </Button>
          ) : (
            <div className="rounded-2xl border bg-card p-4 animate-in fade-in slide-in-from-bottom-2">
              <Label htmlFor="sname">Nome da sessão</Label>
              <Input
                id="sname"
                className="mt-2 h-12 text-base"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Label htmlFor="session-venue" className="mt-3 block">
                Estabelecimento
              </Label>
              <Select
                value={venueId ?? ""}
                onValueChange={setVenueId}
                disabled={venues.isLoading || (venues.data ?? []).length === 1}
              >
                <SelectTrigger
                  id="session-venue"
                  className="mt-2 h-12 w-full"
                  aria-invalid={!venueId}
                >
                  <SelectValue
                    placeholder={
                      venues.isLoading
                        ? "Carregando estabelecimentos..."
                        : "Selecione um estabelecimento"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(venues.data ?? []).map((venue) => (
                    <SelectItem key={venue.id} value={venue.id}>
                      {venue.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!venues.isLoading && !(venues.data ?? []).length && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nenhum estabelecimento autorizado disponível para sua conta.
                </p>
              )}
              {!!venues.data?.length && !venueId && (
                <p className="mt-2 text-sm text-destructive">
                  Selecione um estabelecimento para iniciar a sessão.
                </p>
              )}

              <div className="mt-5 border-t pt-4">
                <p className="mb-2 text-sm font-medium">Formato</p>
                <div className="grid gap-2" role="radiogroup" aria-label="Formato da sessão">
                  <Button
                    variant={sessionType === "free" ? "default" : "secondary"}
                    className="h-11 justify-start"
                    role="radio"
                    aria-checked={sessionType === "free"}
                    onClick={() => selectSessionType("free")}
                  >
                    🎤 BatalhaOkê Livre
                  </Button>
                  <Button
                    variant={sessionType === "x1" ? "default" : "secondary"}
                    className="h-11 justify-start"
                    role="radio"
                    aria-checked={sessionType === "x1"}
                    onClick={() => selectSessionType("x1")}
                  >
                    ⚔️ BatalhaOkê X1
                  </Button>
                  {/* <Button variant={sessionType === "championship" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "championship"} onClick={() => selectSessionType("championship")}>🏆 BatalhaOkê Campeonato</Button> */}
                </div>
              </div>
              {sessionType === "free" ? (
                <div className="mt-4">
                  <p className="mb-2 text-sm font-medium">Modo de votação</p>
                  <div className="grid gap-2" role="radiogroup" aria-label="Modo de votação">
                    <Button
                      variant={votingMode === "like_only" ? "default" : "secondary"}
                      className="h-11 justify-start"
                      role="radio"
                      aria-checked={votingMode === "like_only"}
                      onClick={() => setVotingMode("like_only")}
                    >
                      👍 Apenas Gostei
                    </Button>
                    <Button
                      variant={votingMode === "like_dislike" ? "default" : "secondary"}
                      className="h-11 justify-start"
                      role="radio"
                      aria-checked={votingMode === "like_dislike"}
                      onClick={() => setVotingMode("like_dislike")}
                    >
                      👍 Gostei / 👎 Não gostei
                    </Button>
                  </div>
                </div>
              ) : sessionType === "x1" ? (
                <div className="mt-4">
                  <p className="mb-2 text-sm font-medium">Modelo de votação no X1</p>
                  <div
                    className="grid gap-2"
                    role="radiogroup"
                    aria-label="Modelo de votação no X1"
                  >
                    <Button
                      variant={x1VotingMode === "during_performance" ? "default" : "secondary"}
                      className="h-auto flex-col items-start whitespace-normal py-3 text-left"
                      role="radio"
                      aria-checked={x1VotingMode === "during_performance"}
                      onClick={() => setX1VotingMode("during_performance")}
                    >
                      <span className="font-semibold">Durante as apresentações</span>
                      <span className="text-xs font-normal opacity-80">
                        O público vota em cada cantor enquanto ele se apresenta.
                      </span>
                    </Button>
                    <Button
                      variant={x1VotingMode === "after_both_performances" ? "default" : "secondary"}
                      className="h-auto flex-col items-start whitespace-normal py-3 text-left"
                      role="radio"
                      aria-checked={x1VotingMode === "after_both_performances"}
                      onClick={() => setX1VotingMode("after_both_performances")}
                    >
                      <span className="font-semibold">Após as apresentações</span>
                      <span className="text-xs font-normal opacity-80">
                        O público escolhe entre os dois cantores depois que ambos terminarem.
                        Votação de até 30 segundos.
                      </span>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm">
                  Votação obrigatória: <strong>👍 Gostei / 👎 Não gostei</strong>
                </p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button variant="secondary" className="h-12" onClick={() => setCreating(false)}>
                  Cancelar
                </Button>
                <Button
                  className="h-12"
                  disabled={busy || !venueId || venues.isLoading}
                  onClick={start}
                >
                  {busy ? "Criando…" : "Iniciar"}
                </Button>
              </div>
            </div>
          )}
          {err && (
            <p role="alert" className="text-sm text-destructive">
              {err}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          )}
        </section>
      </Card>

      <Card asChild variant="configuration">
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-display text-2xl">Gestão de TVs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pareie e administre as TVs de um estabelecimento sem abrir uma sessão.
          </p>
          <Label htmlFor="tv-venue" className="mt-4 block">
            Estabelecimento
          </Label>
          <select
            id="tv-venue"
            className="mt-2 h-12 w-full rounded-md border border-input bg-background px-3 text-base"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
          >
            <option value="">Selecione um estabelecimento</option>
            {(venues.data ?? []).map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
          {venues.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Entre como operador para administrar um estabelecimento.{" "}
              <Link to="/login" className="underline">
                Entrar
              </Link>
            </p>
          )}
          {venueId && (
            <div className="mt-5 border-t pt-4">
              <p className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                O pareamento pertence ao estabelecimento. Todos os operadores autorizados
                compartilham as TVs; cada operador usa sua própria conta no dispositivo de operação.
                Não é necessário reconfigurar a TV quando outro operador assume o turno.
              </p>
              <div
                className="mt-4 grid grid-cols-2 gap-2"
                role="tablist"
                aria-label="Gestão de TVs"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tvTab === "tv"}
                  className={`h-11 rounded-lg border text-sm font-semibold ${tvTab === "tv" ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
                  onClick={() => setTvTab("tv")}
                >
                  TVs Pareadas ({connectedTvCount})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tvTab === "device"}
                  className={`h-11 rounded-lg border text-sm font-semibold ${tvTab === "device" ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
                  onClick={() => setTvTab("device")}
                >
                  Parear Nova TV
                </button>
              </div>
              {tvTab === "device" && (
                <>
                  <p className="mt-4 font-medium">Parear TV</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Digite o código exibido na TV e dê um nome para ela.
                  </p>
                  <Input
                    className="mt-3 h-11"
                    placeholder="Código da TV (ex.: ABC123)"
                    value={pairingCode}
                    onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                    maxLength={6}
                  />
                  <Input
                    className="mt-2 h-11"
                    placeholder="Nome da TV (ex.: TV Palco Principal)"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2 h-11 w-full"
                    disabled={busy || pairingCode.length !== 6 || !deviceName.trim()}
                    onClick={() => void pairTv()}
                  >
                    Concluir pareamento
                  </Button>
                </>
              )}
              {tvTab === "tv" && (
                <div className="mt-3 text-sm text-muted-foreground">
                  {devices.isLoading
                    ? "Carregando TVs…"
                    : (devices.data ?? []).length
                      ? (devices.data ?? []).map((device) => (
                          <div
                            key={device.id}
                            className={`mt-3 rounded-xl border p-3 ${device.status === "paired" ? "border-success/40 bg-success/10" : device.status === "disabled" ? "border-border bg-muted/50" : "border-border border-dashed bg-background"}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-foreground">
                                  {device.name || "TV sem nome"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {(venues.data ?? []).find((venue) => venue.id === venueId)
                                    ?.name ?? "Estabelecimento"}
                                </p>
                                <span
                                  className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${device.status === "paired" ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}
                                >
                                  {device.status === "paired"
                                    ? "Pareada · pronta para uso"
                                    : device.status === "disabled"
                                      ? "Desabilitada"
                                      : "Pendente"}
                                </span>
                              </div>
                              <div className="flex shrink-0 gap-1">
                                {device.status === "paired" && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => void updateDevice(device.id, "disable")}
                                  >
                                    Desabilitar
                                  </Button>
                                )}
                                {device.status === "disabled" && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => void updateDevice(device.id, "enable")}
                                  >
                                    Reativar
                                  </Button>
                                )}
                                {(device.status === "paired" || device.status === "disabled") && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => setDeviceToDelete(device.id)}
                                  >
                                    Excluir
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      : "Nenhuma TV pareada ainda."}
                </div>
              )}
            </div>
          )}
        </section>
      </Card>

      <Card asChild variant="information">
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-display text-2xl">Gestão de operadores</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesso e permissões de quem opera este estabelecimento.
          </p>
          {venueId &&
          (venues.data ?? []).find((venue) => venue.id === venueId)?.role === "owner" ? (
            <Button asChild variant="outline" className="mt-3 min-h-11 w-full">
              <Link to="/estabelecimento/$venueId/operadores" params={{ venueId }}>
                Gerenciar operadores
              </Link>
            </Button>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              A gestão de operadores está disponível para proprietários.
            </p>
          )}
        </section>
      </Card>

      <Dialog
        open={deviceToDelete !== null}
        onOpenChange={(open) => !busy && !open && setDeviceToDelete(null)}
      >
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-destructive">
              Excluir TV do estabelecimento?
            </DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Esta TV/dispositivo será excluído do estabelecimento e precisará ser pareado novamente
            para ser usado.
          </p>
          <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              className="h-12"
              disabled={busy}
              onClick={() => setDeviceToDelete(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-12"
              disabled={busy}
              onClick={confirmDeleteDevice}
            >
              {busy ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Link
        to="/tv"
        className="mx-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Tv className="size-4" /> Abrir tela da TV
      </Link>
      <Link
        to="/campeonatos"
        className="mx-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Trophy className="size-4" /> Administrar Campeonatos
      </Link>
    </main>
  );
}
