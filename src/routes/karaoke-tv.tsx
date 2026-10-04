import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Maximize2, Mic2, Minimize2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionLive } from "@/hooks/use-session-live";
import { commandChannel, displayName, setPerformanceStatus, type Performance, type VotingMode } from "@/lib/karaoke";
import { getTvState, listVenues, registerTvDevice } from "@/lib/venue.functions";
import { PlaybackPlayer, type PlaybackPlayerRef } from "@/components/karaoke/PlaybackPlayer";
import { SessionQr } from "@/components/karaoke/SessionQr";

type CompletedPerformance = Performance & {
  participant: NonNullable<Performance["participant"]>;
  source: NonNullable<Performance["source"]>;
};

function isCompletedPerformance(performance: Performance): performance is CompletedPerformance {
  return performance.status === "completed" && !!performance.participant && !!performance.source;
}

function performanceScore(performance: Performance, votingMode: VotingMode) {
  return votingMode === "like_dislike" ? performance.like_count - performance.dislike_count : performance.like_count;
}

function completionTime(performance: Performance) {
  return performance.ended_at ?? performance.started_at ?? performance.created_at;
}

function PerformanceScore({ performance, votingMode }: { performance: Performance; votingMode: VotingMode }) {
  if (votingMode === "like_only") {
    return <p className="font-display text-3xl text-primary lg:text-4xl">{performance.like_count} {performance.like_count === 1 ? "voto" : "votos"} 👍</p>;
  }

  const score = performanceScore(performance, votingMode);
  return (
    <div>
      <p className="font-display text-3xl text-primary lg:text-4xl">Pontuação {score >= 0 ? "+" : ""}{score}</p>
      <p className="mt-1 text-lg text-muted-foreground lg:text-xl">👍 {performance.like_count} · 👎 {performance.dislike_count}</p>
    </div>
  );
}

export const Route = createFileRoute("/karaoke-tv")({
  validateSearch: zodValidator(z.object({ session: fallback(z.string(), "").default("") })),
  head: () => ({
    meta: [
      { title: "BatalhaOkê — Tela pública" },
      { name: "description", content: "Tela pública do BatalhaOkê: cantor atual, música e player." },
      { property: "og:title", content: "BatalhaOkê — TV" },
      { property: "og:description", content: "Acompanhe a apresentação ao vivo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TvPage,
});

function TvPage() {
  const { session: sp } = Route.useSearch();
  const devSession = import.meta.env.DEV ? sp : "";
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const tvStateFn = useServerFn(getTvState);
  const listVenuesFn = useServerFn(listVenues);
  const registerDeviceFn = useServerFn(registerTvDevice);
  useEffect(() => {
    const stored = window.localStorage.getItem("ka-tv-device-token");
    if (stored) setDeviceToken(stored);
    else if (!devSession) {
      const bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      let token = "";
      for (let index = 0; index < bytes.length; index += 1) token += bytes[index]!.toString(16).padStart(2, "0");
      window.localStorage.setItem("ka-tv-device-token", token);
      setDeviceToken(token);
    }
    setTokenReady(true);
  }, [devSession]);
  const tvState = useQuery({
    queryKey: ["tv-state", deviceToken],
    queryFn: () => tvStateFn({ data: { deviceToken: deviceToken! } }),
    enabled: !!deviceToken,
    retry: 2,
  });
  const pairing = useQuery({
    queryKey: ["tv-pairing", deviceToken],
    queryFn: () => registerDeviceFn({ data: { deviceToken: deviceToken! } }),
    enabled: !!deviceToken && !tvState.isLoading && !tvState.data?.paired && !tvState.data?.disabled,
    retry: 1,
    staleTime: Infinity,
  });
  const paired = !!tvState.data?.paired;
  const sessionId = paired ? tvState.data?.activeSessionId ?? undefined : devSession || undefined;
  const live = useSessionLive(sessionId);
  const session = live.session.data;
  const venues = useQuery({
    queryKey: ["venues"],
    queryFn: () => listVenuesFn(),
    enabled: !!session?.venue_id,
    staleTime: 60_000,
  });
  const venueSlug = session?.venue_id ? venues.data?.find((venue) => venue.id === session.venue_id)?.slug : null;
  const votingCode = session?.venue_id ? venueSlug : session?.public_code;
  const active = live.active;
  const next = live.queued[0];
  const isFreeWaiting = session?.session_type === "free" && !active;
  const completedPerformances = (live.performances.data ?? []).filter(isCompletedPerformance);
  const latestPerformance = [...completedPerformances].sort((a, b) =>
    completionTime(b).localeCompare(completionTime(a)) || b.id.localeCompare(a.id),
  )[0];
  const nightlyHighlight = completedPerformances.reduce<CompletedPerformance | undefined>((leader, performance) => {
    if (!leader) return performance;
    const scoreDifference = performanceScore(performance, session?.voting_mode ?? "like_only")
      - performanceScore(leader, session?.voting_mode ?? "like_only");
    return scoreDifference > 0 || (scoreDifference === 0 && performance.id.localeCompare(leader.id) < 0)
      ? performance
      : leader;
  }, undefined);
  const completedVotes = completedPerformances.reduce((total, performance) =>
    total + performance.like_count + (session?.voting_mode === "like_dislike" ? performance.dislike_count : 0),
  0);
  const playerRef = useRef<PlaybackPlayerRef>(null);
  const [armed, setArmed] = useState(false);

  // Fullscreen state (client-only; SSR renders the button without document access).
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const sync = () => {
      setIsFullscreen(!!(doc.fullscreenElement ?? doc.webkitFullscreenElement));
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);
  const toggleFullscreen = () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const element = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (typeof doc.exitFullscreen === "function") {
        const request = doc.exitFullscreen();
        if (request && typeof request.catch === "function") request.catch(() => {});
      } else if (typeof doc.webkitExitFullscreen === "function") {
        doc.webkitExitFullscreen();
      }
      return;
    }
    if (typeof element.requestFullscreen === "function") {
      const request = element.requestFullscreen();
      if (request && typeof request.catch === "function") request.catch(() => {});
    } else if (typeof element.webkitRequestFullscreen === "function") {
      element.webkitRequestFullscreen();
    }
  };

  useEffect(() => {
    const venueId = tvState.data?.venueId;
    if (!paired || !venueId) return;
    const channel = supabase.channel(`tv-venue:${venueId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `venue_id=eq.${venueId}` }, () => { tvState.refetch(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [paired, tvState.data?.venueId]);

  // Pairing has no public device subscription (the device table stays private).
  // While waiting only, retry at a low cadence; this stops immediately after pairing.
  useEffect(() => {
    if (!deviceToken || paired || tvState.data?.disabled) return;
    const timer = window.setTimeout(() => { tvState.refetch(); }, 10_000);
    return () => { window.clearTimeout(timer); };
  }, [deviceToken, paired, tvState.data?.disabled, tvState.dataUpdatedAt]);

  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase.channel(commandChannel(sessionId))
      .on("broadcast", { event: "command" }, ({ payload }) => {
        if (payload?.action === "play") playerRef.current?.play();
        if (payload?.action === "pause") playerRef.current?.pause();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId]);

  const brand = (
    <header className="relative flex items-center justify-center gap-3 lg:justify-start">
      <Mic2 className="size-8 text-primary lg:size-10" aria-hidden />
      <p className="font-display text-4xl lg:text-5xl">BatalhaOkê</p>
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
        title={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
        className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full border border-border/60 p-3 text-muted-foreground hover:bg-accent/10 hover:text-foreground lg:p-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {isFullscreen ? <Minimize2 className="size-6 lg:size-8" aria-hidden /> : <Maximize2 className="size-6 lg:size-8" aria-hidden />}
      </button>
    </header>
  );

  if (!tokenReady || (deviceToken && tvState.isLoading)) {
    return <main className="grid min-h-dvh place-items-center p-8 text-center"><div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Conectando…</p></div></main>;
  }

  if (tvState.data?.disabled || pairing.data?.disabled) {
    return <main className="grid min-h-dvh place-items-center p-8 text-center"><div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Esta TV foi desabilitada. Peça ajuda ao operador.</p></div></main>;
  }

  if (!devSession && !paired) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Esta TV ainda não está configurada.</p>
          {pairing.data?.pairingCode ? <><p className="mt-8 text-lg text-muted-foreground">Código de pareamento</p><p className="font-display text-6xl tracking-[0.2em] text-primary lg:text-8xl">{pairing.data.pairingCode}</p><p className="mt-6 text-base text-muted-foreground">Informe este código ao operador para vincular esta TV.</p></> : <p className="mt-6 text-xl text-muted-foreground">{pairing.isLoading ? "Gerando código…" : "Não foi possível preparar o pareamento. Recarregue a tela."}</p>}
        </div>
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">{paired ? "Aguardando início da sessão neste estabelecimento" : "Aguardando início da sessão"}</p></div>
      </main>
    );
  }

  if (session && !session.tv_enabled) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Tela da TV desativada para esta sessão.</p></div>
      </main>
    );
  }
  const showQr = !!session?.show_qr_on_tv || isFreeWaiting;

  return (
    <main className="flex min-h-dvh flex-col gap-6 p-5 sm:p-8 lg:p-12">
      {brand}
      {live.error && <p role="alert" className="text-center text-xl text-destructive">Conexão perdida com o servidor.</p>}
      <div className={`grid flex-1 gap-8 ${showQr ? "lg:grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
      {active?.source && active.participant ? (
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section className="text-center lg:text-left animate-in fade-in slide-in-from-left-4 duration-700">
            <p className="text-xl text-muted-foreground lg:text-3xl">Cantor {active.participant.participant_number}</p>
            <h1 className="font-display text-6xl leading-none text-primary sm:text-7xl lg:text-8xl xl:text-9xl">🎤 {displayName(active.participant)}</h1>
            <p className="mt-4 font-display text-3xl uppercase leading-tight sm:text-4xl lg:text-6xl">{active.source.title}</p>
            <p className="mt-6 inline-flex items-center gap-3 rounded-full bg-accent/15 px-5 py-2 text-lg font-semibold uppercase tracking-widest text-accent lg:text-2xl">
              <span className="size-3 animate-pulse rounded-full bg-accent" /> Apresentação em andamento
            </p>
            <p className="mt-6 font-display text-5xl lg:text-7xl" aria-live="polite">👍 {active.like_count} {active.like_count === 1 ? "voto" : "votos"}{session?.voting_mode === "like_dislike" && <>   👎 {active.dislike_count}</>}</p>
          </section>
          <section className="w-full">
            <PlaybackPlayer key={active.id} ref={playerRef} provider={active.source.provider} externalId={active.source.external_id}
              onState={(s) => { if (s === "ended") setPerformanceStatus(active.id, "completed").catch(() => {}); }} />
          </section>
        </div>
      ) : (
        isFreeWaiting ? (
          <section className="flex flex-col justify-center gap-6 text-center lg:text-left">
            {completedPerformances.length === 0 ? (
              <div>
                <h1 className="font-display text-5xl leading-none text-primary sm:text-6xl lg:text-8xl">A noite está começando!</h1>
                <p className="mt-5 text-2xl text-muted-foreground lg:text-3xl">Escaneie o QR Code, participe e prepare-se para a próxima apresentação.</p>
              </div>
            ) : (
              <div className={`grid gap-5 ${completedPerformances.length > 1 ? "lg:grid-cols-2" : ""}`}>
                {latestPerformance && (
                  <article className="rounded-2xl border border-border/60 bg-secondary/40 p-5 sm:p-7">
                    <p className="text-lg font-semibold uppercase tracking-widest text-muted-foreground lg:text-xl">Última apresentação</p>
                    <h1 className="mt-2 font-display text-5xl leading-none text-primary sm:text-6xl lg:text-7xl">{displayName(latestPerformance.participant)}</h1>
                    <p className="mt-3 text-xl lg:text-2xl">{latestPerformance.source.title}</p>
                    <div className="mt-4">
                      <PerformanceScore performance={latestPerformance} votingMode={session?.voting_mode ?? "like_only"} />
                    </div>
                    {completedPerformances.length === 1 && (
                      <p className="mt-4 text-lg font-semibold text-accent lg:text-xl">Primeiro destaque da noite · líder até agora</p>
                    )}
                  </article>
                )}
                {completedPerformances.length > 1 && nightlyHighlight && (
                  <article className="rounded-2xl border border-primary/50 bg-primary/10 p-5 sm:p-7">
                    <p className="text-lg font-semibold uppercase tracking-widest text-muted-foreground lg:text-xl">Destaque da noite</p>
                    <h2 className="mt-2 font-display text-5xl leading-none text-primary sm:text-6xl lg:text-7xl">{displayName(nightlyHighlight.participant)}</h2>
                    <div className="mt-4">
                      <PerformanceScore performance={nightlyHighlight} votingMode={session?.voting_mode ?? "like_only"} />
                    </div>
                  </article>
                )}
              </div>
            )}
            {next?.participant && (
              <p className="font-display text-3xl lg:text-5xl">Próximo cantor: <span className="text-primary">{displayName(next.participant)}</span></p>
            )}
            <p className="text-base text-muted-foreground lg:text-lg">
              {completedPerformances.length} {completedPerformances.length === 1 ? "apresentação realizada" : "apresentações realizadas"} · {completedVotes} {completedVotes === 1 ? "voto registrado" : "votos registrados"} pelo público
            </p>
          </section>
        ) : (
          <div className="grid place-items-center text-center">
            <div>
              <p className="text-3xl text-muted-foreground lg:text-5xl">Aguardando o próximo cantor</p>
              {next?.participant && (
                <p className="mt-6 font-display text-6xl lg:text-8xl">Próximo: <span className="text-primary">{displayName(next.participant)}</span></p>
              )}
            </div>
          </div>
        )
      )}
      {showQr && session && (
        <aside className="flex flex-col items-center justify-center gap-3 text-center">
          {votingCode ? <SessionQr code={votingCode} size={isFreeWaiting ? 260 : 200} /> : <p className="text-muted-foreground">Carregando QR Code permanente…</p>}
          <p className="font-display text-2xl lg:text-3xl">Escaneie para votar</p>
        </aside>
      )}
      </div>
      {!armed && (
        <button onClick={() => setArmed(true)} className="mx-auto rounded-full border px-6 py-3 text-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
          Toque aqui uma vez para permitir que o celular do operador inicie o playback nesta TV
        </button>
      )}
    </main>
  );
}
