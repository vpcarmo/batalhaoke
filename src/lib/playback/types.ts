// Provider-agnostic playback contracts. The rest of the app only talks to these types.
// YouTube is the first implementation; a licensed karaoke provider can be added later
// by implementing PlaybackProvider and registering it in ./registry.ts.

export type ProviderId = "youtube"; // future: | "licensed_karaoke"

export interface PlaybackSearchResult {
  provider: ProviderId;
  externalId: string;
  title: string;
  channelName: string | null;
  thumbnailUrl: string | null;
  duration: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export type PlayerState = "unstarted" | "playing" | "paused" | "buffering" | "ended" | "error";

export interface PlayerEvents {
  onReady?: () => void;
  onStateChange?: (state: PlayerState) => void;
  onError?: (message: string) => void;
}

export interface PlayerHandle {
  play(): void;
  pause(): void;
  destroy(): void;
}

export interface PlaybackProvider {
  id: ProviderId;
  label: string;
  /** Attribution shown next to the player (never over it). */
  attribution: string;
  search(query: string): Promise<PlaybackSearchResult[]>;
  mount(container: HTMLElement, externalId: string, events: PlayerEvents): Promise<PlayerHandle>;
}
