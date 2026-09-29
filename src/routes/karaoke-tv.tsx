import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Mic2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionLive } from "@/hooks/use-session-live";
import { commandChannel, displayName, getActiveSession, setPerformanceStatus } from "@/lib/karaoke";
import { PlaybackPlayer, type PlaybackPlayerRef } from "@/components/karaoke/PlaybackPlayer";

export const Route = createFileRoute("/karaoke-tv")({
  ssr: false,
  validateSearch: zodValidator(z.object({ session: fallback(z.string(), "").default("") })),
  head: () => ({
    meta: [
      { title: "Karaoke Arena — Tela pública" },
      { name: "description", content: "Tela pública do Karaoke Arena: cantor atual, música e player." },
      { property: "og:title", content: "Karaoke Arena — TV" },
      { property: "og:description", content: "Acompanhe a apresentação ao vivo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TvPage,
});

function TvPage() {
  const { session: sp } = Route.useSearch();
  const fallbackSession = useQuery({ queryKey: ["active-session"], queryFn: getActiveSession, enabled: !sp, retry: 2 });
  const sessionId = sp || fallbackSession.data?.id;
  const live = useSessionLive(sessionId);
  const active = live.active;
  const next = live.queued[0];
  const playerRef = useRef<PlaybackPlayerRef>(null);
  const [armed, setArmed] = useState(false);

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
    <header className="flex items-center justify-center gap-3 lg:justify-start">
      <Mic2 className="size-8 text-primary lg:size-10" aria-hidden />
      <p className="font-display text-4xl lg:text-5xl">Karaoke Arena</p>
    </header>
  );

  if (!sessionId) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">{fallbackSession.isLoading ? "Conectando…" : fallbackSession.error ? "Servidor indisponível. Tentando novamente…" : "Aguardando início da sessão"}</p></div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col gap-6 p-5 sm:p-8 lg:p-12">
      {brand}
      {live.error && <p role="alert" className="text-center text-xl text-destructive">Conexão perdida com o servidor.</p>}
      {active?.source && active.participant ? (
        <div className="grid flex-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section className="text-center lg:text-left animate-in fade-in slide-in-from-left-4 duration-700">
            <p className="text-xl text-muted-foreground lg:text-3xl">Cantor {active.participant.participant_number}</p>
            <h1 className="font-display text-6xl leading-none text-primary sm:text-7xl lg:text-8xl xl:text-9xl">🎤 {displayName(active.participant)}</h1>
            <p className="mt-4 font-display text-3xl uppercase leading-tight sm:text-4xl lg:text-6xl">{active.source.title}</p>
            <p className="mt-6 inline-flex items-center gap-3 rounded-full bg-accent/15 px-5 py-2 text-lg font-semibold uppercase tracking-widest text-accent lg:text-2xl">
              <span className="size-3 animate-pulse rounded-full bg-accent" /> Apresentação em andamento
            </p>
          </section>
          <section className="w-full">
            <PlaybackPlayer key={active.id} ref={playerRef} provider={active.source.provider} externalId={active.source.external_id}
              onState={(s) => { if (s === "ended") setPerformanceStatus(active.id, "completed").catch(() => {}); }} />
          </section>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <p className="text-3xl text-muted-foreground lg:text-5xl">Aguardando o próximo cantor</p>
            {next?.participant && (
              <p className="mt-6 font-display text-6xl lg:text-8xl">Próximo: <span className="text-primary">{displayName(next.participant)}</span></p>
            )}
          </div>
        </div>
      )}
      {!armed && (
        <button onClick={() => setArmed(true)} className="mx-auto rounded-full border px-6 py-3 text-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
          Toque aqui uma vez para permitir que o celular do operador inicie o playback nesta TV
        </button>
      )}
    </main>
  );
}
