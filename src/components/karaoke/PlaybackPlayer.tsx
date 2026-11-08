import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { getProvider } from "@/lib/playback/registry";
import { commercialPlaybackError, createPlaybackPermit } from "@/lib/commercial-playback";
import type { PlayerHandle, PlayerState } from "@/lib/playback/types";
import {
  acquirePerformanceMeasurement,
  acquireTvPerformanceMeasurement,
  sendPerformanceHeartbeat,
  sendTvPerformanceHeartbeat,
} from "@/lib/measurement.functions";

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
  performanceId?: string;
  deviceToken?: string;
}

/** Generic player slot. Nothing is ever rendered on top of the provider's player. */
export const PlaybackPlayer = forwardRef<PlaybackPlayerRef, Props>(function PlaybackPlayer(
  { provider, externalId, onState, className, performanceId, deviceToken },
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
  const authorizationKey = performanceId
    ? performanceId + ":" + (deviceToken ?? "local")
    : "unmetered";
  const [authorizedFor, setAuthorizedFor] = useState<string | null>(null);
  const telemetryState = useRef<PlayerState>("unstarted");
  const sendTransition = useRef<((s: PlayerState) => void) | null>(null);

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

  useEffect(() => {
    if (performanceId && authorizedFor !== authorizationKey) return;
    let alive = true;
    setError(null);
    setLoading(true);
    providerReady.current = false;
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
        if (alive) {
          telemetryState.current = s;
          sendTransition.current?.(s);
          cb.current?.(s);
        }
      },
      onError: (m) => {
        if (!alive) return;
        telemetryState.current = "error";
        sendTransition.current?.("error");
        cb.current?.("error");
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
  }, [provider, externalId, performanceId, authorizationKey, authorizedFor]);

  useEffect(() => {
    if (!performanceId) return;
    let active = true;
    telemetryState.current = "unstarted";
    setAuthorizedFor(null);
    setError(null);
    setLoading(true);
    const permit = createPlaybackPermit((failure) => {
      if (!active) return;
      setAuthorizedFor(null);
      pendingIntent.current = null;
      providerReady.current = false;
      handle.current?.pause();
      handle.current?.destroy();
      handle.current = null;
      setLoading(false);
      setError(commercialPlaybackError(failure));
      cb.current?.("error");
    });
    const instanceId = crypto.randomUUID();
    let epochId: string | undefined;
    let sequence = 0;
    let commercialRequired = true;
    let acquiring = false;
    let lastTransitionState: PlayerState | undefined;
    const pendingTransitions: PlayerState[] = [];

    const heartbeat = async (eventState?: PlayerState, forceAcquire = false) => {
      if (
        !active ||
        permit.closed ||
        (!eventState &&
          (!epochId || telemetryState.current === "ended" || telemetryState.current === "error"))
      )
        return;
      if (acquiring) {
        if (eventState) pendingTransitions.push(eventState);
        return;
      }

      acquiring = true;
      const requestStartedAt = Date.now();
      try {
        if (!epochId || forceAcquire) {
          const lease = deviceToken
            ? await acquireTvPerformanceMeasurement({
                data: { performanceId, instanceId, deviceToken },
              })
            : await acquirePerformanceMeasurement({ data: { performanceId, instanceId } });
          if (!active || permit.closed) return;
          if (!lease?.epoch_id && lease?.commercial_required !== false)
            throw new Error("commercial_authorization_required");
          commercialRequired = lease.commercial_required !== false;
          if (!commercialRequired) permit.unmetered();
          epochId = lease.epoch_id;
          if (!permit.confirm(12_000 - (Date.now() - requestStartedAt))) return;
          setAuthorizedFor(authorizationKey);
        }
        if (!epochId) return;
        const positionSeconds = handle.current?.getPositionSeconds();
        if (positionSeconds == null) return;
        const data = {
          performanceId,
          instanceId,
          epochId,
          sequence: sequence++,
          state: eventState ?? telemetryState.current,
          positionSeconds,
        };
        const result = deviceToken
          ? await sendTvPerformanceHeartbeat({ data: { ...data, deviceToken } })
          : await sendPerformanceHeartbeat({ data });
        if (!result.accepted && result.reason !== "duplicate")
          throw new Error("commercial_authorization_required");
        if (active) permit.confirm(12_000 - (Date.now() - requestStartedAt));
      } catch (failure) {
        epochId = undefined;
        if (commercialRequired) permit.revoke(failure);
      } finally {
        acquiring = false;
        const next = pendingTransitions.shift();
        if (active && next) queueMicrotask(() => void heartbeat(next));
      }
    };
    sendTransition.current = (s) => {
      if (s === lastTransitionState) return;
      lastTransitionState = s;
      void heartbeat(s);
    };
    void heartbeat(telemetryState.current, true);
    const timer = setInterval(() => void heartbeat(), 5_000);
    const onOnline = () => {
      epochId = undefined;
      void heartbeat(telemetryState.current, true);
    };
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      permit.close();
      sendTransition.current = null;
      if (timer) clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [performanceId, deviceToken, authorizationKey]);

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
