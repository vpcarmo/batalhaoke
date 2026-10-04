import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Mic2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSessionLive } from "@/hooks/use-session-live";
import { commandChannel, displayName, setPerformanceStatus } from "@/lib/karaoke";
import { getTvState, registerTvDevice } from "@/lib/venue.functions";
import { PlaybackPlayer, type PlaybackPlayerRef } from "@/components/karaoke/PlaybackPlayer";
import { SessionQr } from "@/components/karaoke/SessionQr";

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
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const tvStateFn = useServerFn(getTvState);
  const registerDeviceFn = useServerFn(registerTvDevice);
  useEffect(() => {
    const stored = window.localStorage.getItem("ka-tv-device-token");
    if (stored) setDeviceToken(stored);
    else if (!sp) {
      const bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      let token = "";
      for (let index = 0; index < bytes.length; index += 1) token += bytes[index]!.toString(16).padStart(2, "0");
      window.localStorage.setItem("ka-tv-device-token", token);
      setDeviceToken(token);
    }
    setTokenReady(true);
  }, [sp]);
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
  const sessionId = paired ? tvState.data?.activeSessionId ?? undefined : sp;
  const live = useSessionLive(sessionId);
  const active = live.active;
  const next = live.queued[0];
  const playerRef = useRef<PlaybackPlayerRef>(null);
  const [armed, setArmed] = useState(false);

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
    <header className="flex items-center justify-center gap-3 lg:justify-start">
      <Mic2 className="size-8 text-primary lg:size-10" aria-hidden />
      <p className="font-display text-4xl lg:text-5xl">BatalhaOkê</p>
    </header>
  );

  if (!tokenReady || (deviceToken && tvState.isLoading)) {
    return <main className="grid min-h-dvh place-items-center p-8 text-center"><div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Conectando…</p></div></main>;
  }

  if (tvState.data?.disabled || pairing.data?.disabled) {
    return <main className="grid min-h-dvh place-items-center p-8 text-center"><div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Esta TV foi desabilitada. Peça ajuda ao operador.</p></div></main>;
  }

  if (!sp && !paired) {
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

  const session = live.session.data;
  if (session && !session.tv_enabled) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div>{brand}<p className="mt-6 text-2xl text-muted-foreground lg:text-4xl">Tela da TV desativada para esta sessão.</p></div>
      </main>
    );
  }
  const showQr = !!session?.show_qr_on_tv;

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
        <div className="grid place-items-center text-center">
          <div>
            <p className="text-3xl text-muted-foreground lg:text-5xl">Aguardando o próximo cantor</p>
            {next?.participant && (
              <p className="mt-6 font-display text-6xl lg:text-8xl">Próximo: <span className="text-primary">{displayName(next.participant)}</span></p>
            )}
          </div>
        </div>
      )}
      {showQr && session && (
        <aside className="flex flex-col items-center justify-center gap-3 text-center">
          <SessionQr code={session.public_code} size={200} />
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
