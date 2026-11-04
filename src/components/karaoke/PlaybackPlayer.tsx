import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { getProvider } from "@/lib/playback/registry";
import type { PlayerHandle, PlayerState } from "@/lib/playback/types";

export interface PlaybackPlayerRef {
  play(): void;
  pause(): void;
  restart(): void;
}

export type PlaybackIntent = "play" | "pause" | "restart";

interface Props {
  provider: string;
  externalId: string;
  onState?: (s: PlayerState) => void;
  className?: string;
}

/** Generic player slot. Nothing is ever rendered on top of the provider's player. */
export const PlaybackPlayer = forwardRef<PlaybackPlayerRef, Props>(function PlaybackPlayer(
  { provider, externalId, onState, className },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<PlayerHandle | null>(null);
  const providerReady = useRef(false);
  const pendingIntent = useRef<PlaybackIntent | null>(null);
  const cb = useRef(onState);
  cb.current = onState;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useImperativeHandle(
    ref,
    () => ({
      play: () => issue("play"),
      pause: () => issue("pause"),
      restart: () => issue("restart"),
    }),
    [],
  );

  function issue(intent: PlaybackIntent) {
    const current = handle.current;
    if (!current || !providerReady.current) {
      pendingIntent.current = intent;
      return;
    }
    if (intent === "play") current.play();
    else if (intent === "pause") current.pause();
    else current.restart();
  }

  /* useEffect(() => {
    let alive = true;
    setError(null);
    setLoading(true);
    let isReady = false;
    const p = getProvider(provider);
    const t = setTimeout(() => alive && !isReady && setError("O player demorou demais para carregar. Verifique a internet."), 15000);
    p.mount(box.current!, externalId, {
      onReady: () => { isReady = true; clearTimeout(t); if (alive) setLoading(false); },
      onStateChange: (s) => cb.current?.(s),
      onError: (m) => { isReady = true; clearTimeout(t); if (alive) setError(m); },
    })
      .then((h) => { if (!alive) h.destroy(); else handle.current = h; })
      .catch((e) => alive && setError(e.message || "Player indisponível."));
    return () => { alive = false; clearTimeout(t); handle.current?.destroy(); handle.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, externalId]); */

  useEffect(() => {
    let alive = true;
    setError(null);
    setLoading(true);
    providerReady.current = false;
    pendingIntent.current = null;
    let isReady = false;
    const p = getProvider(provider);
    const t = setTimeout(
      () =>
        alive &&
        !isReady &&
        setError("O player demorou demais para carregar. Verifique a internet."),
      15000,
    );

    if (!box.current) return;

    // 1. Criar nó dedicado para esta montagem específica
    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    box.current.innerHTML = "";
    box.current.appendChild(host);

    const flushIntent = () => {
      const current = handle.current;
      if (!alive || !providerReady.current || !current) return;
      const intent = pendingIntent.current;
      pendingIntent.current = null;
      if (intent === "play") current.play();
      else if (intent === "pause") current.pause();
      else if (intent === "restart") current.restart();
    };

    // 2. Montar no host dedicado em vez de passar o box.current compartilhado
    p.mount(host, externalId, {
      onReady: () => {
        if (!alive) return;
        isReady = true;
        providerReady.current = true;
        clearTimeout(t);
        setLoading(false);
        flushIntent();
      },
      onStateChange: (s) => {
        if (alive) cb.current?.(s);
      },
      onError: (m) => {
        if (!alive) return;
        isReady = true;
        clearTimeout(t);
        setError(m);
      },
    })
      .then((h) => {
        if (!alive) {
          h.destroy();
          host.remove();
        } else {
          handle.current = h;
          flushIntent();
        }
      })
      .catch((e) => alive && setError(e.message || "Player indisponível."));

    // 3. Cleanup limpa apenas o seu host e o handle
    return () => {
      alive = false;
      clearTimeout(t);
      providerReady.current = false;
      pendingIntent.current = null;
      handle.current?.destroy();
      handle.current = null;
      host.remove();
    };
  }, [provider, externalId]);

  const attribution = getProvider(provider).attribution;
  return (
    <div className={className}>
      <div
        className="relative w-full min-w-[280px] overflow-hidden rounded-xl bg-muted"
        style={{ aspectRatio: "16 / 9" }}
      >
        <div ref={box} className="absolute inset-0" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{attribution}</span>
        {loading && !error && <span>Carregando player…</span>}
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
});
