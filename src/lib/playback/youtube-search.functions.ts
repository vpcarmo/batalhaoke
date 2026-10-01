import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PlaybackSearchResult } from "./types";

// Short-lived, per-instance cache of search METADATA only (no media). Conservative: 10 min.
const cache = new Map<string, { at: number; results: PlaybackSearchResult[] }>();
const TTL = 10 * 60 * 1000;
const MAX_RESULTS = 8;

function isoDuration(d?: string): string | null {
  if (!d) return null;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = +(m[1] ?? 0), mi = +(m[2] ?? 0), s = +(m[3] ?? 0);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(mi).padStart(2, "0")}:${ss}` : `${mi}:${ss}`;
}

async function logCall(endpoint: string, query: string, cached: boolean, ok: boolean, error?: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("provider_api_calls").insert({ provider: "youtube", endpoint, query, cached, ok, error: error ?? null });
  } catch (e) {
    console.error("log failed", e);
  }
}

export type SearchResponse =
  | { ok: true; results: PlaybackSearchResult[]; cached: boolean }
  | { ok: false; code: "missing_key" | "invalid_key" | "quota" | "network" | "bad_request"; message: string };

export const youtubeSearch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ query: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }): Promise<SearchResponse> => {
    const key = process.env["YOUTUBE_API_KEY"];
    if (!key) return { ok: false, code: "missing_key", message: "A chave da YouTube API não está configurada." };
    /* const q = data.query.toLowerCase();
    const hit = cache.get(q);
    if (hit && Date.now() - hit.at < TTL) {
      await logCall("search.list", q, true, true);
      return { ok: true, results: hit.results, cached: true };
    }
    try {
      const sp = new URLSearchParams({ part: "snippet", q: data.query, type: "video", videoEmbeddable: "true", maxResults: String(MAX_RESULTS), key }); */
          // Adiciona "karaoke" automaticamente se o operador não tiver digitado
    const rawQuery = data.query.trim();
    const jaTemTermo = /\b(karaok[eê]|playback)\b/i.test(rawQuery);
    const searchQuery = jaTemTermo ? rawQuery : `${rawQuery} karaoke`;

    const q = searchQuery.toLowerCase();
    const hit = cache.get(q);
    if (hit && Date.now() - hit.at < TTL) {
      await logCall("search.list", q, true, true);
      return { ok: true, results: hit.results, cached: true };
    }
    try {
      const sp = new URLSearchParams({ part: "snippet", q: searchQuery, type: "video", videoEmbeddable: "true", maxResults: String(MAX_RESULTS), key });

      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${sp}`);
      const j: any = await r.json();
      if (!r.ok) {
        const reason = j?.error?.errors?.[0]?.reason ?? "";
        await logCall("search.list", q, false, false, reason || String(r.status));
        if (reason.includes("quota") || reason === "rateLimitExceeded") return { ok: false, code: "quota", message: "Cota diária da YouTube API esgotada. Tente novamente amanhã." };
        if (reason === "keyInvalid" || r.status === 400 || r.status === 403) return { ok: false, code: "invalid_key", message: "A chave da YouTube API é inválida ou não tem permissão." };
        return { ok: false, code: "bad_request", message: "O YouTube recusou a pesquisa." };
      }
      await logCall("search.list", q, false, true);
      const items: any[] = j.items ?? [];
      const ids = items.map((i) => i.id?.videoId).filter(Boolean);
      const durations: Record<string, string | null> = {};
      if (ids.length) {
        const vp = new URLSearchParams({ part: "contentDetails,status", id: ids.join(","), key });
        const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?${vp}`);
        const vj: any = await vr.json().catch(() => ({}));
        await logCall("videos.list", q, false, vr.ok);
        for (const v of vj.items ?? []) if (v.status?.embeddable !== false) durations[v.id] = isoDuration(v.contentDetails?.duration);
      }
      const results: PlaybackSearchResult[] = items
        .filter((i) => i.id?.videoId && (!Object.keys(durations).length || i.id.videoId in durations))
        .map((i) => ({
          provider: "youtube",
          externalId: i.id.videoId,
          title: decode(i.snippet?.title ?? ""),
          channelName: decode(i.snippet?.channelTitle ?? "") || null,
          thumbnailUrl: i.snippet?.thumbnails?.medium?.url ?? null,
          duration: durations[i.id.videoId] ?? null,
          metadata: {},
        }));
      cache.set(q, { at: Date.now(), results });
      return { ok: true, results, cached: false };
    } catch (e) {
      await logCall("search.list", q, false, false, "network");
      return { ok: false, code: "network", message: "Não foi possível falar com o YouTube. Verifique a internet." };
    }
  });

function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
