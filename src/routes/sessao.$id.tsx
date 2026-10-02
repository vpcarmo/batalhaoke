import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mic2, Music, Pause, Play, Plus, Square, Tv, Smartphone, Check, QrCode, Copy, Download, Printer, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useSessionLive } from "@/hooks/use-session-live";
import { addParticipant, commandChannel, createPerformance, displayName, finishSession, getApiStats, setPerformanceStatus, updateSessionDisplay, type Participant, type Performance } from "@/lib/karaoke";
import { MusicSearch } from "@/components/karaoke/MusicSearch";
import { PlaybackPlayer, type PlaybackPlayerRef } from "@/components/karaoke/PlaybackPlayer";
import { SessionQr, voteUrl } from "@/components/karaoke/SessionQr";
import type { PlaybackSearchResult } from "@/lib/playback/types";
import { X1Matches, matchesKey } from "@/components/karaoke/X1Matches";
import { completeMatchPerformance, createMatchPerformance, startMatchPerformance } from "@/lib/x1.functions";
import type { Match, MatchSlot } from "@/lib/karaoke";

const sessionTypeLabels = {
  free: "BatalhaOkê Livre",
  x1: "BatalhaOkê X1",
  championship: "BatalhaOkê Campeonato",
} as const;

export const Route = createFileRoute("/sessao/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sessão — BatalhaOkê" },
      { name: "description", content: "Painel do operador: cantores, músicas e apresentações." },
      { property: "og:title", content: "Sessão — BatalhaOkê" },
      { property: "og:description", content: "Painel do operador do BatalhaOkê." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SessionPage,
});

function SessionPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const live = useSessionLive(id);
  const [addOpen, setAddOpen] = useState(false);
  const [picking, setPicking] = useState<Participant | null>(null);
  const [matchPick, setMatchPick] = useState<{ match: Match; slot: MatchSlot } | null>(null);
  const [confirm, setConfirm] = useState<PlaybackSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [localPlayerChoice, setLocalPlayer] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const playerRef = useRef<PlaybackPlayerRef>(null);
  const stats = useQuery({ queryKey: ["api-stats"], queryFn: getApiStats, staleTime: Infinity });

  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    const ch = supabase.channel(commandChannel(id)).subscribe();
    chRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [id]);
  const sendTv = (action: "play" | "pause") => chRef.current?.send({ type: "broadcast", event: "command", payload: { action } });

  const session = live.session.data;
  const participants = live.participants.data ?? [];
  const perfs = live.performances.data ?? [];
  const active = live.active;
  const nextQueued = live.queued[0] ?? null;
  // TV is optional: when disabled, playback always runs on this device.
  const localPlayer = session?.tv_enabled === false ? true : localPlayerChoice;
  const votingModeLocked = !!session && (session.status !== "draft" || session.session_type !== "free");

  const perfFor = (p: Participant) => [...perfs].reverse().find((x) => x.participant_id === p.id);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["performances", id] }); qc.invalidateQueries({ queryKey: ["participants", id] }); qc.invalidateQueries({ queryKey: ["session", id] }); qc.invalidateQueries({ queryKey: matchesKey(id) }); };

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  // X1 performances end through the X1 server function; free flow unchanged.
  const endActive = (p: Performance) => (p.match_id ? completeMatchPerformance({ data: { performanceId: p.id } }) : setPerformanceStatus(p.id, "completed"));
  const closePicker = () => { setPicking(null); setMatchPick(null); setConfirm(null); };

  if (live.session.isLoading) return <Centered>Carregando sessão…</Centered>;
  if (live.error) return <Centered><p role="alert" className="text-destructive">Servidor indisponível. Verifique a internet e tente novamente.</p><Button className="mt-4" onClick={() => location.reload()}>Tentar novamente</Button></Centered>;
  if (!session) return <Centered>Sessão não encontrada. <Link to="/" className="underline">Voltar</Link></Centered>;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-28 pt-4 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" aria-label="Voltar" className="grid size-11 place-items-center rounded-full bg-secondary"><ArrowLeft className="size-5" /></Link>
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl leading-none">BatalhaOkê</p>
          <p className="truncate text-sm text-muted-foreground">{session.name}</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${session.status === "active" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}>
          <span className={`size-2 rounded-full ${session.status === "active" ? "bg-success animate-pulse" : "bg-muted-foreground"}`} />
          {session.status === "active" ? "Sessão ativa" : "Encerrada"}
        </span>
      </header>

      {/* Current / next performance */}
      <section aria-labelledby="now" className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 id="now" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{active ? "Apresentação em andamento" : "Próxima apresentação"}</h2>
        {active ? (
          <ActivePanel perf={active} votingMode={session.voting_mode} busy={busy} tvEnabled={session.tv_enabled} localPlayer={localPlayer} setLocalPlayer={setLocalPlayer} playerRef={playerRef}
            onPlay={() => (localPlayer ? playerRef.current?.play() : sendTv("play"))}
            onPause={() => (localPlayer ? playerRef.current?.pause() : sendTv("pause"))}
            onEnd={() => act(() => endActive(active), "Apresentação encerrada")}
            onEnded={() => act(() => endActive(active), "Música terminou — apresentação concluída")} />
        ) : nextQueued ? (
          <div className="mt-3">
            <Singer perf={nextQueued} />
            <Button size="lg" className="mt-4 h-14 w-full text-base font-semibold shadow-glow" disabled={busy} onClick={() => act(() => setPerformanceStatus(nextQueued.id, "active"), "Apresentação iniciada")}>
              <Mic2 className="size-5" /> Iniciar apresentação
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-muted-foreground">Cadastre um cantor e escolha uma música para começar.</p>
        )}
      </section>

      <div className={`grid gap-3 ${session.tv_enabled ? "grid-cols-2" : "grid-cols-1"}`}>
        {session.tv_enabled && (
          <Button variant="secondary" asChild className="h-12">
            <a href={`/karaoke-tv?session=${id}`} target="_blank" rel="noreferrer"><Tv className="size-4" /> Abrir tela da TV</a>
          </Button>
        )}
        <Button variant="secondary" className="h-12" onClick={() => setQrOpen(true)}><QrCode className="size-4" /> QR Code de votação</Button>
      </div>

      <section aria-labelledby="display" className="rounded-2xl border bg-card p-4">
        <h2 id="display" className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Exibição pública</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex min-h-11 items-center justify-between gap-3">
            <span>Tela da TV ativa</span>
            <Switch checked={session.tv_enabled} onCheckedChange={(v) => { if (!v) setLocalPlayer(true); act(() => updateSessionDisplay(id, { tv_enabled: v })); }} />
          </label>
          <label className={`flex min-h-11 items-center justify-between gap-3 ${session.tv_enabled ? "" : "opacity-50"}`}>
            <span>Mostrar QR Code na TV</span>
            <Switch checked={session.show_qr_on_tv} disabled={!session.tv_enabled} onCheckedChange={(v) => act(() => updateSessionDisplay(id, { show_qr_on_tv: v }))} />
          </label>
          <div>
            <p className="mb-1">Formato</p>
            <p className="text-sm text-muted-foreground">{sessionTypeLabels[session.session_type]}</p>
          </div>
          <div>
            <p className="mb-2">Modo de votação</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Modo de votação">
              {session.session_type === "free" && <Button variant={session.voting_mode === "like_only" ? "default" : "secondary"} className="h-auto min-h-11 whitespace-normal py-2" disabled={busy || votingModeLocked} role="radio" aria-checked={session.voting_mode === "like_only"} onClick={() => session.voting_mode !== "like_only" && act(() => updateSessionDisplay(id, { voting_mode: "like_only" }))}>👍 Apenas Gostei</Button>}
              <Button variant={session.voting_mode === "like_dislike" ? "default" : "secondary"} className="h-auto min-h-11 whitespace-normal py-2" disabled={busy || votingModeLocked} role="radio" aria-checked={session.voting_mode === "like_dislike"} onClick={() => session.voting_mode !== "like_dislike" && act(() => updateSessionDisplay(id, { voting_mode: "like_dislike" }))}>👍 Gostei / 👎 Não gostei</Button>
            </div>
            {session.session_type !== "free" && <p className="mt-2 text-sm text-muted-foreground">Obrigatório para este formato.</p>}
            {session.session_type === "free" && session.status !== "draft" && <p className="mt-2 text-sm text-muted-foreground">O modo de votação não pode ser alterado após o início da sessão.</p>}
          </div>
        </div>
      </section>

      {session.session_type === "x1" && (
        <X1Matches sessionId={id} sessionActive={session.status === "active"} participants={participants} perfs={perfs} hasActive={!!active} busy={busy} act={act}
          onPickSong={(match, slot, p) => { setMatchPick({ match, slot }); setPicking(p); }} />
      )}

      {/* Queue */}
      <section aria-labelledby="order">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="order" className="font-display text-3xl">Ordem</h2>
          <span className="text-sm text-muted-foreground">{participants.length} cantor(es)</span>
        </div>
        {participants.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Nenhum cantor ainda.</p>}
        <ol className="flex flex-col gap-2">
          {participants.map((p) => {
            const pf = perfFor(p);
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary font-display text-xl">{p.participant_number}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Cantor {p.participant_number}</p>
                  <p className="truncate font-semibold">{displayName(p)}</p>
                  {pf?.source && <p className="truncate text-xs text-muted-foreground"><Music className="mr-1 inline size-3" />{pf.source.title}</p>}
                </div>
                {session.session_type === "x1" ? null : <StatusOrAction pf={pf} onPick={() => setPicking(p)} disabled={session.status !== "active"} />}
              </li>
            );
          })}
        </ol>
      </section>

      {/* {session.status === "active" && (
        <Button variant="ghost" className="text-muted-foreground" disabled={busy || !!active} onClick={() => confirm_("Encerrar a sessão?") && act(() => finishSession(id), "Sessão encerrada")}>
          Encerrar sessão
        </Button>
      )} */}

       {session.status === "active" && (
        <Button variant="ghost" className="text-muted-foreground" disabled={busy || !!active} onClick={() => setFinishOpen(true)}>
          Encerrar sessão
        </Button>
      )}

      {import.meta.env.DEV && (
        <aside className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          <p className="font-semibold">YouTube API (dev)</p>
          <p>Chamadas search.list hoje (sem cache): {stats.data?.todayCalls ?? "…"} · Cota estimada: {(stats.data?.todayCalls ?? 0) * 100} unidades</p>
          <p>Última pesquisa: {stats.data?.last ? `"${stats.data.last.query}" às ${new Date(stats.data.last.created_at).toLocaleTimeString("pt-BR")}${stats.data.last.ok ? "" : ` (erro: ${stats.data.last.error})`}` : "—"}</p>
        </aside>
      )}

      {session.status === "active" && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/90 p-3 backdrop-blur">
          <Button size="lg" className="mx-auto flex h-14 w-full max-w-2xl text-base font-semibold" onClick={() => setAddOpen(true)}><Plus className="size-5" /> Novo cantor</Button>
        </div>
      )}

      <AddSingerDialog open={addOpen} onOpenChange={setAddOpen} sessionId={id} onAdded={(p) => { refresh(); setPicking(p); }} />

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-destructive">Encerrar sessão do evento?</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            <p>Isso finalizará o evento da noite. O QR Code atual será desativado para novas votações e nenhuma nova música poderá ser adicionada.</p>
            <p className="mt-2 font-medium text-foreground">Deseja realmente finalizar?</p>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Button type="button" variant="secondary" className="h-12" onClick={() => setFinishOpen(false)}>
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-12 font-semibold"
              disabled={busy}
              onClick={() => {
                setFinishOpen(false);
                act(() => finishSession(id), "Sessão encerrada");
              }}
            >
              Sim, encerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!picking} onOpenChange={(o) => !o && closePicker()}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader><SheetTitle>{matchPick && `Cantor ${matchPick.slot.toUpperCase()} · `}Música para {picking && displayName(picking)}</SheetTitle></SheetHeader>
          <div className="px-4 pb-6">
            {confirm ? (
              <div className="flex flex-col gap-3">
                {confirm.thumbnailUrl && <img src={confirm.thumbnailUrl} alt="" className="aspect-video w-full rounded-xl object-cover" />}
                <p className="font-semibold">{confirm.title}</p>
                <p className="text-sm text-muted-foreground">Canal: {confirm.channelName}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="secondary" className="h-12" onClick={() => setConfirm(null)}>Voltar</Button>
                  <Button className="h-12" disabled={busy} onClick={() => matchPick
                    ? act(async () => {
                        const perf = await createMatchPerformance({ data: { matchId: matchPick.match.id, slot: matchPick.slot, playback: { provider: confirm.provider, externalId: confirm.externalId, title: confirm.title, channelName: confirm.channelName, thumbnailUrl: confirm.thumbnailUrl, duration: confirm.duration } } });
                        await startMatchPerformance({ data: { performanceId: perf.id } });
                        closePicker();
                      }, `Cantor ${matchPick.slot.toUpperCase()} no palco`)
                    : act(async () => { await createPerformance(id, picking!.id, confirm); setPicking(null); setConfirm(null); }, "Apresentação criada")}>
                    <Check className="size-4" /> {matchPick ? "Confirmar e iniciar" : "Confirmar"}
                  </Button>
                </div>
              </div>
            ) : (
              <MusicSearch onPick={setConfirm} onSearched={() => stats.refetch()} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={qrOpen} onOpenChange={setQrOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl">
          <SheetHeader><SheetTitle className="font-display text-3xl">QR Code de votação</SheetTitle></SheetHeader>
          <div className="flex flex-col items-center gap-4 px-4 pb-6 text-center">
            <SessionQr code={session.public_code} size={200} id="session-qr" />
            <p className="text-muted-foreground">Escaneie com o celular para votar nas apresentações.</p>
            <p className="w-full break-all rounded-lg bg-secondary px-3 py-2 text-xs">{voteUrl(session.public_code)}</p>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
              <Button className="h-12" onClick={() => navigator.clipboard.writeText(voteUrl(session.public_code)).then(() => toast.success("Link copiado"), () => toast.error("Não foi possível copiar"))}><Copy className="size-4" /> Copiar link</Button>
              <Button variant="secondary" className="h-12" onClick={() => downloadQr(session.public_code)}><Download className="size-4" /> Baixar QR Code</Button>
              <Button variant="secondary" asChild className="h-12"><a href={`/qr/${session.public_code}`} target="_blank" rel="noreferrer"><Printer className="size-4" /> Imprimir</a></Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}

function confirm_(m: string) { return typeof window !== "undefined" && window.confirm(m); }

function StatusOrAction({ pf, onPick, disabled }: { pf: Performance | undefined; onPick: () => void; disabled: boolean }) {
  if (pf?.status === "active") return <span className="rounded-full bg-primary/20 px-2.5 py-1 text-xs font-semibold text-primary">No palco · 👍 {pf.like_count}</span>;
  if (pf?.status === "queued") return <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">Na fila</span>;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
    {pf?.status === "completed" && <span className="text-xs text-muted-foreground">👍 {pf.like_count} votos</span>}
    <Button size="sm" variant={pf ? "secondary" : "default"} className="h-10" disabled={disabled} onClick={onPick}>
      {pf?.status === "completed" && <Check className="size-4" />} {pf ? "Cantar de novo" : "Escolher música"}
    </Button>
    </div>
  );
}

function downloadQr(code: string) {
  const svg = document.getElementById("session-qr");
  if (!svg) return;
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `batalhaoke-qr-${code}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Singer({ perf }: { perf: Performance }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">Cantor {perf.participant?.participant_number}</p>
      <p className="font-display text-5xl leading-none">{perf.participant && displayName(perf.participant)}</p>
      <p className="mt-2 flex items-center gap-2 text-lg"><Music className="size-4 text-accent" /> <span className="line-clamp-2">{perf.source?.title}</span></p>
    </div>
  );
}

function ActivePanel(props: {
  perf: Performance; votingMode: "like_only" | "like_dislike"; busy: boolean; tvEnabled: boolean; localPlayer: boolean; setLocalPlayer: (v: boolean) => void; playerRef: React.RefObject<PlaybackPlayerRef | null>;
  onPlay: () => void; onPause: () => void; onEnd: () => void; onEnded: () => void;
}) {
  const { perf } = props;
  return (
    <div className="mt-3 flex flex-col gap-4">
      <Singer perf={perf} />
      <p className="flex items-center gap-2 font-display text-3xl text-primary" aria-live="polite"><ThumbsUp className="size-6" /> {perf.like_count} {perf.like_count === 1 ? "voto" : "votos"}{props.votingMode === "like_dislike" && <><span className="mx-1">·</span><ThumbsDown className="size-6" /> {perf.dislike_count}</>}</p>
      {props.tvEnabled && (
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1" role="radiogroup" aria-label="Onde tocar">
        <button role="radio" aria-checked={!props.localPlayer} onClick={() => props.setLocalPlayer(false)} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium ${!props.localPlayer ? "bg-background" : "text-muted-foreground"}`}><Tv className="size-4" /> Na TV</button>
        <button role="radio" aria-checked={props.localPlayer} onClick={() => props.setLocalPlayer(true)} className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium ${props.localPlayer ? "bg-background" : "text-muted-foreground"}`}><Smartphone className="size-4" /> Neste aparelho</button>
      </div>
      )}
      {props.localPlayer && perf.source && (
        <PlaybackPlayer ref={props.playerRef} provider={perf.source.provider} externalId={perf.source.external_id} onState={(s) => s === "ended" && props.onEnded()} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" className="h-14" onClick={props.onPlay}><Play className="size-5" /> Iniciar playback</Button>
        <Button size="lg" variant="secondary" className="h-14" onClick={props.onPause}><Pause className="size-5" /> Pausar</Button>
      </div>
      <Button size="lg" variant="destructive" className="h-14 text-base font-semibold" disabled={props.busy} onClick={props.onEnd}><Square className="size-5" /> Encerrar apresentação</Button>
    </div>
  );
}

function AddSingerDialog({ open, onOpenChange, sessionId, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; sessionId: string; onAdded: (p: Participant) => void }) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Informe o nome do cantor."); return; }
    setBusy(true); setErr(null);
    try {
      const p = await addParticipant(sessionId, name, stage);
      toast.success(`✓ Cantor cadastrado — Cantor ${p.participant_number}: ${displayName(p)}`);
      setName(""); setStage(""); onOpenChange(false); onAdded(p);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle className="font-display text-3xl">Novo cantor</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div><Label htmlFor="pn">Nome *</Label><Input id="pn" className="mt-2 h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!err} /></div>
          <div><Label htmlFor="ps">Nome artístico</Label><Input id="ps" className="mt-2 h-12 text-base" value={stage} onChange={(e) => setStage(e.target.value)} /></div>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <DialogFooter className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <Button type="button" variant="secondary" className="h-12" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" className="h-12" disabled={busy}>{busy ? "Salvando…" : "Cadastrar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-dvh place-items-center p-6 text-center text-muted-foreground"><div>{children}</div></main>;
}
