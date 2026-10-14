import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Maximize2, Mic2, Minimize2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionLive } from "@/hooks/use-session-live";
import {
  commandChannel,
  displayName,
  setPerformanceStatus,
  type Match,
  type Participant,
  type Performance,
  type VotingMode,
} from "@/lib/karaoke";
import { completePerformanceFromTv } from "@/lib/karaoke.functions";
import { getTvState, listVenues, registerTvDevice } from "@/lib/venue.functions";
import { PlaybackPlayer, type PlaybackPlayerRef } from "@/components/karaoke/PlaybackPlayer";
import { SessionQr } from "@/components/karaoke/SessionQr";
import { getX1CompetitionState } from "@/lib/x1-state";
import {
  completeMatchPerformance,
  completeMatchPerformanceFromTv,
  getX1MatchTally,
} from "@/lib/x1.functions";
import { useVoteCountdown } from "@/hooks/use-vote-countdown";
import type { ChampionshipLiveSnapshot } from "@/lib/karaoke.functions";

type CompletedPerformance = Performance & {
  participant: NonNullable<Performance["participant"]>;
  source: NonNullable<Performance["source"]>;
};

function isCompletedPerformance(performance: Performance): performance is CompletedPerformance {
  return performance.status === "completed" && !!performance.participant && !!performance.source;
}

function performanceScore(performance: Performance, votingMode: VotingMode) {
  return votingMode === "like_dislike"
    ? performance.like_count - performance.dislike_count
    : performance.like_count;
}

function completionTime(performance: Performance) {
  return performance.ended_at ?? performance.started_at ?? performance.created_at;
}

function PerformanceScore({
  performance,
  votingMode,
}: {
  performance: Performance;
  votingMode: VotingMode;
}) {
  if (votingMode === "like_only") {
    return (
      <p className="font-display text-3xl text-primary lg:text-4xl">
        {performance.like_count} {performance.like_count === 1 ? "voto" : "votos"} 👍
      </p>
    );
  }

  const score = performanceScore(performance, votingMode);
  return (
    <div>
      <p className="font-display text-3xl text-primary lg:text-4xl">
        Pontuação {score >= 0 ? "+" : ""}
        {score}
      </p>
      <p className="mt-1 text-lg text-muted-foreground lg:text-xl">
        👍 {performance.like_count} · 👎 {performance.dislike_count}
      </p>
    </div>
  );
}

export const Route = createFileRoute("/tv")({
  validateSearch: zodValidator(z.object({ session: fallback(z.string(), "").default("") })),
  head: () => ({
    meta: [
      { title: "BatalhaOkê — Tela pública" },
      {
        name: "description",
        content: "Tela pública do BatalhaOkê: cantor atual, música e player.",
      },
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
  const queryClient = useQueryClient();
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
      for (let index = 0; index < bytes.length; index += 1)
        token += bytes[index]!.toString(16).padStart(2, "0");
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
    enabled:
      !!deviceToken && !tvState.isLoading && !tvState.data?.paired && !tvState.data?.disabled,
    retry: 1,
    staleTime: Infinity,
  });
  const paired = !!tvState.data?.paired;
  const live = useSessionLive(
    paired && deviceToken
      ? { kind: "tv", deviceToken }
      : devSession
        ? { kind: "development", sessionId: devSession }
        : undefined,
  );
  const session = live.session.data;
  const championship = live.snapshot?.championship ?? null;
  const isChampionship = session?.session_type === "championship";
  const isChampionshipElimination =
    isChampionship &&
    (["quarter_finals", "semi_finals", "final"].includes(championship?.status ?? "") ||
      (championship?.status === "drawn" && championship.format === 8));
  const sessionId = session?.id ?? (!paired ? devSession || undefined : undefined);
  const venues = useQuery({
    queryKey: ["venues"],
    queryFn: () => listVenuesFn(),
    enabled: !!session?.venue_id,
    staleTime: 60_000,
  });
  const venueSlug = session?.venue_id
    ? venues.data?.find((venue) => venue.id === session.venue_id)?.slug
    : null;
  const votingCode = session?.venue_id ? venueSlug : session?.public_code;
  const active = live.active;
  const next = live.queued[0];
  const isFreeWaiting = session?.session_type === "free" && !active;
  const isX1Waiting = session?.session_type === "x1" && !active;
  const showX1Arena = isX1Waiting && session?.status !== "finished";
  const x1Matches = live.matches?.data ?? [];
  const x1State = showX1Arena
    ? getX1CompetitionState(x1Matches, live.participants.data ?? [])
    : null;
  const x1AfterBoth =
    session?.session_type === "x1" && session.x1_voting_mode === "after_both_performances";
  const directVoteMatch =
    showX1Arena && x1AfterBoth
      ? x1Matches.find((match) => match.status === "in_progress" && match.voting_status !== "idle")
      : undefined;
  const completedPerformances = (live.performances.data ?? []).filter(isCompletedPerformance);
  const latestPerformance = [...completedPerformances].sort(
    (a, b) => completionTime(b).localeCompare(completionTime(a)) || b.id.localeCompare(a.id),
  )[0];
  const nightlyHighlight = completedPerformances.reduce<CompletedPerformance | undefined>(
    (leader, performance) => {
      if (!leader) return performance;
      const scoreDifference =
        performanceScore(performance, session?.voting_mode ?? "like_only") -
        performanceScore(leader, session?.voting_mode ?? "like_only");
      return scoreDifference > 0 ||
        (scoreDifference === 0 && performance.id.localeCompare(leader.id) < 0)
        ? performance
        : leader;
    },
    undefined,
  );
  const completedVotes = completedPerformances.reduce(
    (total, performance) =>
      total +
      performance.like_count +
      (session?.voting_mode === "like_dislike" ? performance.dislike_count : 0),
    0,
  );
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
    if (!paired || !venueId || !deviceToken) return;
    const channel = supabase
      .channel(`venue-live:${venueId}`)
      .on("broadcast", { event: "invalidate" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["tv-state", deviceToken] });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED")
          void queryClient.invalidateQueries({ queryKey: ["tv-state", deviceToken] });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [paired, tvState.data?.venueId, deviceToken, queryClient]);

  // Pending/disabled pairing has no venue channel to follow.
  useEffect(() => {
    if (!deviceToken || tvState.data?.disabled || tvState.data?.activeSessionId) return;
    const timer = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["tv-state", deviceToken] });
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    deviceToken,
    tvState.data?.disabled,
    tvState.data?.activeSessionId,
    tvState.dataUpdatedAt,
    queryClient,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase
      .channel(commandChannel(sessionId))
      .on("broadcast", { event: "command" }, ({ payload }) => {
        if (payload?.action === "play") playerRef.current?.play();
        if (payload?.action === "pause") playerRef.current?.pause();
        if (payload?.action === "restart") playerRef.current?.restart();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
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
        {isFullscreen ? (
          <Minimize2 className="size-6 lg:size-8" aria-hidden />
        ) : (
          <Maximize2 className="size-6 lg:size-8" aria-hidden />
        )}
      </button>
    </header>
  );

  if (!tokenReady || (deviceToken && tvState.isLoading)) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          {brand}
          <p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Conectando…</p>
        </div>
      </main>
    );
  }

  if (tvState.data?.disabled || pairing.data?.disabled) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          {brand}
          <p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">
            Esta TV foi desabilitada. Peça ajuda ao operador.
          </p>
          <button
            type="button"
            className="mt-6 rounded-md border px-5 py-3 text-lg font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              window.localStorage.removeItem("ka-tv-device-token");
              window.location.reload();
            }}
          >
            Desvincular e parear novamente
          </button>
        </div>
      </main>
    );
  }

  if (!devSession && !paired) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          {brand}
          <p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">
            Esta TV ainda não está configurada.
          </p>
          {pairing.data?.pairingCode ? (
            <>
              <p className="mt-8 text-lg text-muted-foreground">Código de pareamento</p>
              <p className="font-display text-6xl tracking-[0.2em] text-primary lg:text-8xl">
                {pairing.data.pairingCode}
              </p>
              <p className="mt-6 text-base text-muted-foreground">
                Informe este código ao operador para vincular esta TV.
              </p>
            </>
          ) : (
            <p className="mt-6 text-xl text-muted-foreground">
              {pairing.isLoading
                ? "Gerando código…"
                : "Não foi possível preparar o pareamento. Recarregue a tela."}
            </p>
          )}
        </div>
      </main>
    );
  }

  if (!sessionId) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          {brand}
          <p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">
            {paired
              ? "Aguardando início da sessão neste estabelecimento"
              : "Aguardando início da sessão"}
          </p>
        </div>
      </main>
    );
  }

  if (session && !session.tv_enabled) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          {brand}
          <p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">
            Tela da TV desativada para esta sessão.
          </p>
        </div>
      </main>
    );
  }
  const isChampionshipWaiting =
    isChampionship &&
    !active &&
    !championship?.matches.some((match) => match.status === "in_progress");
  const isChampionshipVoting =
    isChampionship &&
    championship?.matches.some(
      (match) => match.status === "in_progress" && match.votingStatus === "open",
    );
  const showQr =
    !!session?.show_qr_on_tv ||
    isFreeWaiting ||
    isX1Waiting ||
    isChampionshipWaiting ||
    isChampionshipVoting;

  return (
    <main className="flex min-h-dvh flex-col gap-6 p-5 sm:p-8 lg:p-12">
      {brand}
      {live.error && (
        <p role="alert" className="text-center text-xl text-destructive">
          Conexão perdida com o servidor.
        </p>
      )}
      <div className={`grid flex-1 gap-8 ${showQr ? "lg:grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
        {active?.source && active.participant ? (
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <section className="text-center lg:text-left animate-in fade-in slide-in-from-left-4 duration-700">
              <p className="text-xl text-muted-foreground lg:text-3xl">
                Cantor {active.participant.participant_number}
              </p>
              <h1 className="font-display text-6xl leading-none text-primary sm:text-7xl lg:text-8xl xl:text-9xl">
                🎤 {displayName(active.participant)}
              </h1>
              <p className="mt-4 font-display text-3xl uppercase leading-tight sm:text-4xl lg:text-6xl">
                {active.source.title}
              </p>
              <p className="mt-6 inline-flex items-center gap-3 rounded-full bg-accent/15 px-5 py-2 text-lg font-semibold uppercase tracking-widest text-accent lg:text-2xl">
                <span className="size-3 animate-pulse rounded-full bg-accent" /> Apresentação em
                andamento
              </p>
              {!x1AfterBoth && !isChampionshipElimination && (
                <p className="mt-6 font-display text-5xl lg:text-7xl" aria-live="polite">
                  👍 {active.like_count} {active.like_count === 1 ? "voto" : "votos"}
                  {session?.voting_mode === "like_dislike" && <> 👎 {active.dislike_count}</>}
                </p>
              )}
              {isChampionship && championship && (
                <ChampionshipTvDetails
                  championship={championship}
                  performance={active}
                  performances={live.performances.data ?? []}
                />
              )}
            </section>
            <section className="w-full">
              <PlaybackPlayer
                key={active.id}
                ref={playerRef}
                provider={active.source.provider}
                externalId={active.source.external_id}
                onState={(s) => {
                  if (s !== "ended") return;
                  const completion = devSession
                    ? active.match_id
                      ? completeMatchPerformance({ data: { performanceId: active.id } })
                      : setPerformanceStatus(active.id, "completed")
                    : active.match_id
                      ? completeMatchPerformanceFromTv({
                          data: { performanceId: active.id, deviceToken: deviceToken! },
                        })
                      : completePerformanceFromTv({
                          data: { performanceId: active.id, deviceToken: deviceToken! },
                        });
                  completion.catch((error: unknown) =>
                    console.error("Não foi possível concluir a apresentação.", error),
                  );
                }}
              />
            </section>
          </div>
        ) : isChampionship ? (
          <ChampionshipTvDetails
            championship={championship}
            performance={null}
            performances={live.performances.data ?? []}
          />
        ) : isFreeWaiting ? (
          <section className="flex flex-col justify-center gap-6 text-center lg:text-left">
            {completedPerformances.length === 0 ? (
              <div>
                <h1 className="font-display text-5xl leading-none text-primary sm:text-6xl lg:text-8xl">
                  A noite está começando!
                </h1>
                <p className="mt-5 text-2xl text-muted-foreground lg:text-3xl">
                  Escaneie o QR Code, participe e prepare-se para a próxima apresentação.
                </p>
              </div>
            ) : (
              <div
                className={`grid gap-5 ${completedPerformances.length > 1 ? "lg:grid-cols-2" : ""}`}
              >
                {latestPerformance && (
                  <article className="rounded-2xl border border-border/60 bg-secondary/40 p-5 sm:p-7">
                    <p className="text-lg font-semibold uppercase tracking-widest text-muted-foreground lg:text-xl">
                      Última apresentação
                    </p>
                    <h1 className="mt-2 font-display text-5xl leading-none text-primary sm:text-6xl lg:text-7xl">
                      {displayName(latestPerformance.participant)}
                    </h1>
                    <p className="mt-3 text-xl lg:text-2xl">{latestPerformance.source.title}</p>
                    <div className="mt-4">
                      <PerformanceScore
                        performance={latestPerformance}
                        votingMode={session?.voting_mode ?? "like_only"}
                      />
                    </div>
                    {completedPerformances.length === 1 && (
                      <p className="mt-4 text-lg font-semibold text-accent lg:text-xl">
                        Primeiro destaque da noite · líder até agora
                      </p>
                    )}
                  </article>
                )}
                {completedPerformances.length > 1 && nightlyHighlight && (
                  <article className="rounded-2xl border border-primary/50 bg-primary/10 p-5 sm:p-7">
                    <p className="text-lg font-semibold uppercase tracking-widest text-muted-foreground lg:text-xl">
                      Destaque da noite
                    </p>
                    <h2 className="mt-2 font-display text-5xl leading-none text-primary sm:text-6xl lg:text-7xl">
                      {displayName(nightlyHighlight.participant)}
                    </h2>
                    <div className="mt-4">
                      <PerformanceScore
                        performance={nightlyHighlight}
                        votingMode={session?.voting_mode ?? "like_only"}
                      />
                    </div>
                  </article>
                )}
              </div>
            )}
            {next?.participant && (
              <p className="font-display text-3xl lg:text-5xl">
                Próximo cantor:{" "}
                <span className="text-primary">{displayName(next.participant)}</span>
              </p>
            )}
            <p className="text-base text-muted-foreground lg:text-lg">
              {completedPerformances.length}{" "}
              {completedPerformances.length === 1
                ? "apresentação realizada"
                : "apresentações realizadas"}{" "}
              · {completedVotes} {completedVotes === 1 ? "voto registrado" : "votos registrados"}{" "}
              pelo público
            </p>
          </section>
        ) : directVoteMatch ? (
          <X1DirectVoteTv match={directVoteMatch} participants={live.participants.data ?? []} />
        ) : showX1Arena && x1State ? (
          <X1Arena
            state={x1State}
            participants={live.participants.data ?? []}
            performances={live.performances.data ?? []}
            directVote={x1AfterBoth}
          />
        ) : showX1Arena ? (
          <section className="grid place-items-center rounded-2xl border border-primary/40 bg-card/70 p-8 text-center">
            <p className="font-display text-3xl text-muted-foreground lg:text-5xl">
              {live.error ? "Não foi possível carregar os dados da Arena." : "Carregando a Arena…"}
            </p>
          </section>
        ) : (
          <div className="grid place-items-center text-center">
            <div>
              <p className="text-3xl text-muted-foreground lg:text-5xl">
                Aguardando o próximo cantor
              </p>
              {next?.participant && (
                <p className="mt-6 font-display text-6xl lg:text-8xl">
                  Próximo: <span className="text-primary">{displayName(next.participant)}</span>
                </p>
              )}
            </div>
          </div>
        )}
        {showQr && session && (
          <aside className="flex flex-col items-center justify-center gap-3 text-center">
            {votingCode ? (
              <SessionQr code={votingCode} size={isFreeWaiting || isX1Waiting ? 260 : 200} />
            ) : (
              <p className="text-muted-foreground">Carregando QR Code permanente…</p>
            )}
            <p className="font-display text-2xl lg:text-3xl">
              {isX1Waiting
                ? "Escaneie para votar no próximo duelo"
                : isChampionship
                  ? "Escaneie para votar no Campeonato"
                  : "Escaneie para votar"}
            </p>
          </aside>
        )}
      </div>
      {!armed && (
        <button
          onClick={() => setArmed(true)}
          className="mx-auto rounded-full border px-6 py-3 text-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Toque aqui uma vez para permitir que o celular do operador inicie o playback nesta TV
        </button>
      )}
    </main>
  );
}

function ChampionshipTvDetails({
  championship,
  performance,
  performances,
}: {
  championship: ChampionshipLiveSnapshot | null;
  performance: Performance | null;
  performances: Performance[];
}) {
  const stageTitle = (stage: string) =>
    stage === "quarter_final" ? "Quartas de final" : stage === "semi_final" ? "Semifinal" : "Final";
  const currentStage =
    championship?.status === "drawn" || championship?.status === "quarter_finals"
      ? "quarter_final"
      : championship?.status === "semi_finals"
        ? "semi_final"
        : championship?.status === "final" || championship?.status === "completed"
          ? "final"
          : null;
  const stageMatches = championship?.matches.filter((item) => item.stage === currentStage) ?? [];
  const match =
    stageMatches.find((item) => item.status === "in_progress") ??
    [...stageMatches].reverse().find((item) => item.status === "completed" || item.status === "wo") ??
    stageMatches.find((item) => item.status === "scheduled") ??
    null;
  const remaining = useVoteCountdown(
    match?.votingStatus === "open" ? match.votingEndsAt : null,
  );

  if (!championship) {
    return (
      <p className="mt-6 text-xl text-muted-foreground">
        Aguardando a preparação da sessão do Campeonato.
      </p>
    );
  }

  if (
    championship.status === "group_stage" ||
    (championship.status === "drawn" && championship.format !== 8)
  ) {
    const entries = championship.entries.filter(
      (entry) => entry.groupLetter && entry.participantId,
    );
    const completed = performances.filter(
      (item) => !item.match_id && item.status === "completed",
    ).length;
    const currentEntry = performance
      ? entries.find((entry) => entry.participantId === performance.participant_id)
      : null;
    const currentPosition =
      performance?.participant?.participant_number ?? Math.min(completed + 1, entries.length);
    return (
      <div className="mt-6 space-y-2 text-lg text-muted-foreground lg:text-2xl">
        <p className="font-display text-2xl text-primary lg:text-3xl">
          Fase de grupos{currentEntry?.groupLetter ? ` · Grupo ${currentEntry.groupLetter}` : ""}
        </p>
        {performance ? (
          <p>
            Calendário: apresentação {currentPosition} de {entries.length}
          </p>
        ) : (
          <p>Aguardando a próxima apresentação.</p>
        )}
        <p>
          Progresso: {completed} de {entries.length} apresentações concluídas
        </p>
      </div>
    );
  }

  if (!match) {
    return (
      <section className="mt-6 rounded-2xl border border-primary/40 bg-card/70 p-6 text-center">
        <p className="font-display text-3xl text-primary">Eliminatórias</p>
        <p className="mt-3 text-xl text-muted-foreground">
          Aguardando o próximo confronto preparado pelo operador.
        </p>
      </section>
    );
  }

  const ended =
    match.status === "completed" ||
    match.status === "wo" ||
    match.votingStatus === "closed" ||
    (match.votingStatus === "open" && remaining === 0);
  const entry = (id: string | null) =>
    championship.entries.find((candidate) => candidate.id === id);
  const entryA = entry(match.entryAId);
  const entryB = entry(match.entryBId);
  const winner = entry(match.winnerEntryId);

  return (
    <section className="mt-6 rounded-2xl border border-primary/40 bg-card/70 p-5 text-center lg:p-7">
      <p className="text-base font-bold uppercase tracking-[0.18em] text-muted-foreground lg:text-xl">
        {stageTitle(match.stage)} · Confronto {match.matchNumber}
      </p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {[entryA, null, entryB].map((candidate, index) =>
          index === 1 ? (
            <span key="versus" className="font-display text-3xl text-accent lg:text-5xl">
              ×
            </span>
          ) : (
            <div key={candidate?.id ?? index} className="min-w-0">
              <p className="break-words font-display text-3xl text-primary lg:text-5xl">
                {index === 0 ? "A · " : "B · "}
                {candidate?.displayName ?? "Aguardando"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground lg:text-lg">
                {(index === 0 ? match.performanceA : match.performanceB)?.title ||
                  "Apresentação pendente"}
              </p>
              <p className="mt-2 text-xl font-bold lg:text-3xl">
                {index === 0 ? match.votesA : match.votesB} votos
              </p>
            </div>
          ),
        )}
      </div>
      {winner ? (
        <p className="mt-5 font-display text-3xl text-accent lg:text-4xl">
          {match.resultSource === "operator"
            ? `Vencedor homologado pelo operador: ${winner.displayName}`
            : match.status === "wo"
              ? `WO registrado: ${winner.displayName} avançou`
              : `Vencedor pela votação: ${winner.displayName}`}
        </p>
      ) : ended ? (
        <p className="mt-5 text-xl font-semibold text-accent lg:text-2xl">
          {match.votesA + match.votesB === 0
            ? "Sem votos. Aguardando decisão do operador."
            : match.votesA === match.votesB
              ? "Empate. Aguardando decisão do operador."
              : "Votação encerrada. Aguardando decisão do operador."}
        </p>
      ) : match.votingStatus === "open" ? (
        <p className="mt-5 font-display text-5xl text-primary lg:text-7xl" aria-live="polite">
          Votação aberta · {remaining}s
        </p>
      ) : performance ? (
        <p className="mt-5 text-xl text-muted-foreground lg:text-2xl">
          Apresentação em andamento. A votação abrirá após os dois cantores.
        </p>
      ) : (
        <p className="mt-5 text-xl text-muted-foreground lg:text-2xl">
          Aguardando início autorizado do confronto.
        </p>
      )}
    </section>
  );
}

function X1Arena({
  state,
  participants,
  performances,
  directVote = false,
}: {
  state: ReturnType<typeof getX1CompetitionState>;
  participants: Participant[];
  performances: Performance[];
  directVote?: boolean;
}) {
  const participantById = (id: string) => participants.find((participant) => participant.id === id);
  const last = state.latestCompleted;
  const lastA = last ? participantById(last.participant_a_id) : undefined;
  const lastB = last ? participantById(last.participant_b_id) : undefined;
  const winner = last?.winner_participant_id
    ? participantById(last.winner_participant_id)
    : undefined;
  const scoreForSlot = (match: Match, slot: "a" | "b") =>
    performances.find(
      (performance) => performance.match_id === match.id && performance.match_slot === slot,
    );
  const performanceA = last ? scoreForSlot(last, "a") : undefined;
  const performanceB = last ? scoreForSlot(last, "b") : undefined;
  // after_both_performances: last duel score = direct A/B votes (server-side count, never like/dislike).
  const lastTally = useQuery({
    queryKey: ["x1-tally", last?.id, "final"],
    queryFn: () => getX1MatchTally({ data: { matchId: last!.id } }),
    enabled: directVote && !!last,
    staleTime: Infinity,
    retry: 1,
  });
  const nextMatch = state.currentMatch;
  const nextA = nextMatch ? participantById(nextMatch.participant_a_id) : undefined;
  const nextB = nextMatch ? participantById(nextMatch.participant_b_id) : undefined;
  const nextPerfA = nextMatch ? scoreForSlot(nextMatch, "a") : undefined;
  const nextPerfB = nextMatch ? scoreForSlot(nextMatch, "b") : undefined;
  const score = (performance: Performance) => {
    const value = performance.like_count - performance.dislike_count;
    return value > 0 ? `+${value}` : String(value);
  };
  const votes = (n: number) => `${n} ${n === 1 ? "voto" : "votos"}`;
  const lastScoreA = directVote
    ? lastTally.data
      ? votes(lastTally.data.a)
      : null
    : performanceA
      ? score(performanceA)
      : null;
  const lastScoreB = directVote
    ? lastTally.data
      ? votes(lastTally.data.b)
      : null
    : performanceB
      ? score(performanceB)
      : null;

  return (
    <section className="flex flex-col justify-center gap-5 rounded-2xl border border-primary/40 bg-card/70 p-5 sm:p-7 lg:gap-6 lg:p-8">
      {state.currentChampion ? (
        <article className="rounded-2xl border border-accent/60 bg-accent/10 p-5 text-center sm:p-7">
          <p className="text-lg font-bold uppercase tracking-[0.18em] text-accent lg:text-2xl">
            👑 Rei da mesa
          </p>
          <h1 className="mt-2 break-words font-display text-6xl leading-none text-primary sm:text-7xl lg:text-8xl">
            {displayName(state.currentChampion)}
          </h1>
          <p className="mt-3 text-xl font-semibold lg:text-2xl">
            {state.championWinStreak}{" "}
            {state.championWinStreak === 1 ? "vitória consecutiva" : "vitórias consecutivas"}
          </p>
        </article>
      ) : (
        <article className="rounded-2xl border border-primary/40 bg-primary/10 p-5 text-center sm:p-7">
          <p className="text-lg font-bold uppercase tracking-[0.18em] text-primary lg:text-2xl">
            ⚔ Arena X1
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight sm:text-5xl lg:text-6xl">
            {state.completed.length === 0 ? "A disputa vai começar" : "Arena em preparação"}
          </h1>
          <p className="mt-2 text-lg text-muted-foreground lg:text-xl">
            {state.completed.length === 0
              ? "Preparando o primeiro duelo"
              : "Aguardando a definição do próximo duelo"}
          </p>
        </article>
      )}

      {last && (
        <article className="rounded-2xl border border-border/70 bg-background/50 p-4 text-center sm:p-5">
          <p className="text-base font-bold uppercase tracking-[0.18em] text-muted-foreground lg:text-xl">
            Último duelo
          </p>
          {directVote && lastTally.data && (
            <p className="mt-1 text-sm text-muted-foreground lg:text-base">Votação direta A/B</p>
          )}
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <div className="min-w-0">
              {lastA && (
                <p className="truncate font-display text-3xl text-primary sm:text-4xl lg:text-5xl">
                  {displayName(lastA)}
                </p>
              )}
              {lastScoreA && <p className="mt-1 text-2xl font-bold lg:text-3xl">{lastScoreA}</p>}
            </div>
            <span className="font-display text-2xl text-muted-foreground lg:text-3xl">×</span>
            <div className="min-w-0">
              {lastB && (
                <p className="truncate font-display text-3xl text-primary sm:text-4xl lg:text-5xl">
                  {displayName(lastB)}
                </p>
              )}
              {lastScoreB && <p className="mt-1 text-2xl font-bold lg:text-3xl">{lastScoreB}</p>}
            </div>
          </div>
          {winner && (
            <p className="mt-3 text-xl font-bold text-accent lg:text-2xl">
              🏆 {displayName(winner)} avançou
            </p>
          )}
        </article>
      )}

      <article className="rounded-2xl border border-border/70 bg-background/50 p-4 text-center sm:p-5">
        {nextMatch ? (
          <>
            <p className="text-base font-bold uppercase tracking-[0.18em] text-muted-foreground lg:text-xl">
              {nextMatch.status === "scheduled" ? "Próximo duelo" : "Duelo em preparação"}
            </p>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <div className="min-w-0">
                {nextA && (
                  <p className="truncate font-display text-3xl sm:text-4xl lg:text-5xl">
                    {displayName(nextA)}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground lg:text-base">
                  {nextPerfA ? "Música preparada" : "Aguardando música"}
                </p>
              </div>
              <span className="font-display text-2xl text-accent lg:text-3xl">VS</span>
              <div className="min-w-0">
                {nextB && (
                  <p className="truncate font-display text-3xl sm:text-4xl lg:text-5xl">
                    {displayName(nextB)}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground lg:text-base">
                  {nextPerfB ? "Música preparada" : "Aguardando música"}
                </p>
              </div>
            </div>
          </>
        ) : state.currentChampion && state.nextChallenger ? (
          <>
            <p className="text-base font-bold uppercase tracking-[0.18em] text-muted-foreground lg:text-xl">
              Próximo desafiante
            </p>
            <p className="mt-2 font-display text-5xl text-primary sm:text-6xl lg:text-7xl">
              {displayName(state.nextChallenger)}
            </p>
          </>
        ) : !state.currentChampion && state.firstPair ? (
          <>
            <p className="text-base font-bold uppercase tracking-[0.18em] text-muted-foreground lg:text-xl">
              Primeiro duelo
            </p>
            <p className="mt-2 font-display text-4xl sm:text-5xl lg:text-6xl">
              {displayName(state.firstPair.a)} <span className="text-accent">×</span>{" "}
              {displayName(state.firstPair.b)}
            </p>
            <p className="mt-2 text-lg text-muted-foreground">Preparando o início da Arena</p>
          </>
        ) : state.currentChampion ? (
          <>
            <p className="text-base font-bold uppercase tracking-[0.18em] text-muted-foreground lg:text-xl">
              Próximo duelo
            </p>
            <p className="mt-2 text-2xl font-semibold lg:text-3xl">Aguardando novo desafiante</p>
          </>
        ) : (
          <p className="text-xl font-semibold text-muted-foreground lg:text-2xl">
            Aguardando participantes para iniciar a Arena
          </p>
        )}
      </article>
    </section>
  );
}

/** X1 after_both_performances: "QUEM VOCÊ PREFERE?" screen; player is not mounted (no active performance). */
function X1DirectVoteTv({ match, participants }: { match: Match; participants: Participant[] }) {
  const open = match.voting_status === "open";
  const tally = useQuery({
    queryKey: ["x1-tally", match.id, match.voting_status],
    queryFn: () => getX1MatchTally({ data: { matchId: match.id } }),
    refetchInterval: open ? 2000 : false,
  });
  const offset = tally.data ? tally.data.serverNow - Date.now() : 0;
  const remaining = useVoteCountdown(open ? match.voting_ends_at : null, offset);
  const a = participants.find((p) => p.id === match.participant_a_id);
  const b = participants.find((p) => p.id === match.participant_b_id);
  const isOpen = open && remaining > 0;
  return (
    <section className="flex flex-col justify-center gap-6 rounded-2xl border border-primary/40 bg-card/70 p-6 text-center lg:p-10">
      <h1 className="font-display text-6xl leading-none text-primary lg:text-8xl">
        QUEM VOCÊ PREFERE?
      </h1>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <p className="break-words font-display text-5xl lg:text-7xl">{a ? displayName(a) : "—"}</p>
        <span className="font-display text-5xl text-accent">×</span>
        <p className="break-words font-display text-5xl lg:text-7xl">{b ? displayName(b) : "—"}</p>
      </div>
      {isOpen ? (
        <>
          <p className="font-display text-8xl text-primary" aria-live="polite">
            {remaining}
          </p>
          <p className="text-2xl text-muted-foreground lg:text-3xl">
            Escaneie o QR Code e vote pelo celular!
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-5xl lg:text-6xl">Votação encerrada</p>
          {tally.data && (
            <p className="font-display text-4xl lg:text-5xl">
              {tally.data.a} × {tally.data.b}
            </p>
          )}
          <p className="text-2xl text-muted-foreground lg:text-3xl">
            Aguardando a decisão do operador…
          </p>
        </>
      )}
    </section>
  );
}
