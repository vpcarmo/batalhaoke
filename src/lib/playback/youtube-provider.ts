import type { PlaybackProvider, PlayerState } from "./types";
import { youtubeSearch } from "./youtube-search.functions";

// Official YouTube IFrame Player API only. No overlays, no audio extraction, no downloads.
let apiPromise: Promise<any> | null = null;
function loadApi(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube indisponível"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

const STATES: Record<number, PlayerState> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "unstarted",
};
const ERRORS: Record<number, string> = {
  2: "ID de vídeo inválido.",
  5: "Erro no player HTML5.",
  100: "Vídeo removido ou privado.",
  101: "O dono do vídeo não permite reprodução incorporada.",
  150: "O dono do vídeo não permite reprodução incorporada.",
};

export const youtubeProvider: PlaybackProvider = {
  id: "youtube",
  label: "YouTube",
  attribution: "Playback fornecido pelo YouTube",
  isValidExternalId: (externalId) => /^[A-Za-z0-9_-]{11}$/.test(externalId),
  async search(query) {
    const r = await youtubeSearch({ data: { query } });
    if (!r.ok) throw new Error(r.message);
    return r.results;
  },
  async mount(container, externalId, events) {
    const YT = await loadApi();
    const el = document.createElement("div");
    container.innerHTML = "";
    container.appendChild(el);
    const player = new YT.Player(el, {
      videoId: externalId,
      width: "100%",
      height: "100%",
      playerVars: { autoplay: 0, controls: 1, playsinline: 1, rel: 0 },
      events: {
        onReady: () => events.onReady?.(),
        onStateChange: (e: any) => events.onStateChange?.(STATES[e.data] ?? "unstarted"),
        onError: (e: any) => {
          events.onStateChange?.("error");
          events.onError?.(ERRORS[e.data] ?? "Erro de reprodução.");
        },
      },
    });
    return {
      play: () => player.playVideo?.(),
      pause: () => player.pauseVideo?.(),
      restart: () => {
        player.seekTo?.(0, true);
        player.playVideo?.();
      },
      getPositionSeconds: () => {
        const value = player.getCurrentTime?.();
        return typeof value === "number" && Number.isFinite(value) ? value : null;
      },
      destroy: () => {
        try {
          player.destroy();
        } catch {
          /* noop */
        }
        container.innerHTML = "";
      },
    };
  },
};
