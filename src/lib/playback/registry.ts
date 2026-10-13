import type { PlaybackProvider, ProviderId } from "./types";
import { youtubeProvider } from "./youtube-provider";

// Register future providers (e.g. licensed karaoke) here. Nothing else needs to change.
const providers: Record<ProviderId, PlaybackProvider> = { youtube: youtubeProvider };

export const DEFAULT_PROVIDER: ProviderId = "youtube";
export function isRegisteredProvider(id: string): id is ProviderId {
  return Object.hasOwn(providers, id);
}

export function isValidPlaybackSource(providerId: string, externalId: string): boolean {
  return isRegisteredProvider(providerId) && providers[providerId].isValidExternalId(externalId);
}

export function getProvider(id: string): PlaybackProvider {
  const p = providers[id as ProviderId];
  if (!p) throw new Error(`Provider desconhecido: ${id}`);
  return p;
}
