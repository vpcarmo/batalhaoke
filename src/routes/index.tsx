import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic2, Tv, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSession, getActiveSession, type VotingMode } from "@/lib/karaoke";
import type { SessionType } from "@/lib/karaoke";
import { createVenue, deleteVenueDevice, disableVenueDevice, enableVenueDevice, listVenueDevices, listVenues, pairVenueDevice } from "@/lib/venue.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BatalhaOkê — O público decide quem continua" },
      { name: "description", content: "Karaokê interativo para bares, festas e eventos: cantores, apresentações e votação do público." },
      { property: "og:title", content: "BatalhaOkê" },
      { property: "og:description", content: "Karaokê interativo com votação do público em tempo real." },
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
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [venueId, setVenueId] = useState("");
  const [newVenueName, setNewVenueName] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const venues = useQuery({ queryKey: ["venues"], queryFn: listVenues, retry: 1 });
  const devicesFn = useServerFn(listVenueDevices);
  const pairDeviceFn = useServerFn(pairVenueDevice);
  const disableDeviceFn = useServerFn(disableVenueDevice);
  const enableDeviceFn = useServerFn(enableVenueDevice);
  const deleteDeviceFn = useServerFn(deleteVenueDevice);
  const createVenueFn = useServerFn(createVenue);
  const devices = useQuery({ queryKey: ["venue-devices", venueId], queryFn: () => devicesFn({ data: { venueId } }), enabled: !!venueId, retry: 1 });

  function selectSessionType(type: SessionType) {
    setSessionType(type);
    if (type === "x1" || type === "championship") setVotingMode("like_dislike");
  }

  async function start() {
    if (!venueId && !newVenueName.trim()) {
      setErr("Selecione um estabelecimento ou informe um nome para criar um.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      let selectedVenueId = venueId;
      if (!selectedVenueId) {
        const venue = await createVenueFn({ data: { name: newVenueName.trim() } });
        selectedVenueId = venue.id;
      }
      const s = await createSession(name.trim() || defaultName(), { sessionType, votingMode, venueId: selectedVenueId });
      nav({ to: "/sessao/$id", params: { id: s.id } });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  async function pairTv() {
    setBusy(true); setErr(null);
    try {
      let selectedVenueId = venueId || undefined;
      let selectedVenueName: string | undefined;
      if (!selectedVenueId && newVenueName.trim()) selectedVenueName = newVenueName.trim();
      const result = await pairDeviceFn({ data: { pairingCode: pairingCode.trim(), venueId: selectedVenueId, venueName: selectedVenueName, deviceName: deviceName.trim() } });
      setPairingCode(""); setDeviceName("");
      if (!selectedVenueId && selectedVenueName) {
        await venues.refetch();
        setVenueId(result.venueId);
        setNewVenueName("");
      }
      await devices.refetch();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function updateDevice(venueDeviceId: string, action: "disable" | "enable" | "delete") {
    if (action === "delete" && !window.confirm("Excluir esta TV? Ela precisará parear novamente para ser usada.")) return;
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
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow animate-in zoom-in-50 duration-500">
          <Mic2 className="size-8" aria-hidden />
        </div>
        <h1 className="font-display text-6xl leading-none sm:text-7xl">BatalhaOkê</h1>
        <p className="mt-3 text-lg text-muted-foreground">O público decide quem continua.</p>
      </header>

      <section className="flex flex-col gap-3">
        {active.isLoading && <p className="text-center text-sm text-muted-foreground">Verificando sessões…</p>}
        {active.error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Não foi possível conectar ao servidor. Verifique a internet.</p>}
        {active.data && (
          <Button asChild size="lg" className="h-16 text-lg font-semibold shadow-glow">
            <Link to="/sessao/$id" params={{ id: active.data.id }}><Play className="size-5" /> Continuar sessão</Link>
          </Button>
        )}
        {active.data && <p className="-mt-1 text-center text-sm text-muted-foreground">{active.data.name}</p>}

        {!creating ? (
          <Button size="lg" variant={active.data ? "secondary" : "default"} className="h-16 text-lg font-semibold" onClick={() => setCreating(true)}>
            Iniciar nova sessão
          </Button>
        ) : (
          <div className="rounded-2xl border bg-card p-4 animate-in fade-in slide-in-from-bottom-2">
            <Label htmlFor="sname">Nome da sessão</Label>
            <Input id="sname" className="mt-2 h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="mt-4">
              <Label htmlFor="venue">Estabelecimento <span className="text-muted-foreground">(opcional)</span></Label>
              <select id="venue" className="mt-2 h-12 w-full rounded-md border border-input bg-background px-3 text-base" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Sem estabelecimento (compatibilidade)</option>
                {(venues.data ?? []).map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
              </select>
              {!venueId && <Input className="mt-2 h-12 text-base" placeholder="Ou crie um estabelecimento" value={newVenueName} onChange={(e) => setNewVenueName(e.target.value)} />}
            </div>
             {(venueId || newVenueName.trim()) && (
              <div className="mt-5 border-t pt-4">
                <p className="font-medium">Parear TV</p>
                <p className="mt-1 text-sm text-muted-foreground">Digite o código exibido na TV e dê um nome para ela.</p>
                <Input className="mt-3 h-11" placeholder="Código da TV (ex.: ABC123)" value={pairingCode} onChange={(e) => setPairingCode(e.target.value.toUpperCase())} maxLength={6} />
                <Input className="mt-2 h-11" placeholder="Nome da TV (ex.: TV Palco Principal)" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
                <Button type="button" variant="secondary" className="mt-2 h-11 w-full" disabled={busy || pairingCode.length !== 6 || !deviceName.trim()} onClick={() => { void pairTv(); }}>Concluir pareamento</Button>
                {venueId && <div className="mt-3 text-sm text-muted-foreground">{devices.isLoading ? "Carregando TVs…" : (devices.data ?? []).length ? (devices.data ?? []).map((device) => <div key={device.id} className="mt-2 flex items-center justify-between gap-2"><span>{device.name || "TV sem nome"} · {device.status === "paired" ? "pareada" : device.status}</span><div className="flex shrink-0 gap-1">{device.status === "paired" && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { void updateDevice(device.id, "disable"); }}>Desabilitar</Button>}{device.status === "disabled" && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { void updateDevice(device.id, "enable"); }}>Reativar</Button>}{(device.status === "paired" || device.status === "disabled") && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { void updateDevice(device.id, "delete"); }}>Excluir</Button>}</div></div>) : "Nenhuma TV pareada ainda."}</div>}
              </div>
            )}
            <div className="mt-5 border-t pt-4">
              <p className="mb-2 text-sm font-medium">Formato</p>
              <div className="grid gap-2" role="radiogroup" aria-label="Formato da sessão">
                <Button variant={sessionType === "free" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "free"} onClick={() => selectSessionType("free")}>🎤 BatalhaOkê Livre</Button>
                <Button variant={sessionType === "x1" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "x1"} onClick={() => selectSessionType("x1")}>⚔️ BatalhaOkê X1</Button>
                {/* <Button variant={sessionType === "championship" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "championship"} onClick={() => selectSessionType("championship")}>🏆 BatalhaOkê Campeonato</Button> */}
              </div>
            </div>
            {sessionType === "free" ? (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">Modo de votação</p>
                <div className="grid gap-2" role="radiogroup" aria-label="Modo de votação">
                  <Button variant={votingMode === "like_only" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={votingMode === "like_only"} onClick={() => setVotingMode("like_only")}>👍 Apenas Gostei</Button>
                  <Button variant={votingMode === "like_dislike" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={votingMode === "like_dislike"} onClick={() => setVotingMode("like_dislike")}>👍 Gostei / 👎 Não gostei</Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm">Votação obrigatória: <strong>👍 Gostei / 👎 Não gostei</strong></p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button variant="secondary" className="h-12" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button className="h-12" disabled={busy} onClick={start}>{busy ? "Criando…" : "Iniciar"}</Button>
            </div>
          </div>
        )}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      </section>

      <Link to="/karaoke-tv" className="mx-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <Tv className="size-4" /> Abrir tela da TV
      </Link>
    </main>
  );
}
