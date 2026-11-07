import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlaybackSearchResult } from "./types";

const Input = z.object({ venueId: z.string().uuid() }).strict();
const PAGE_SIZE = 1000;
const MAX_PERFORMANCES = 10_000;
const MAX_RESULTS = 50;

type PlayedRow = {
  started_at: string | null;
  ended_at: string | null;
  status: string;
  source: {
    provider: string;
    external_id: string;
    title: string;
    channel_name: string | null;
    thumbnail_url: string | null;
    duration: string | null;
    metadata: Record<string, string | number | boolean | null>;
  } | null;
};

export function countablePerformance(
  row: Pick<PlayedRow, "started_at" | "ended_at" | "status">,
): boolean {
  if (!row.started_at || !row.ended_at || !["completed", "cancelled"].includes(row.status))
    return false;
  const started = Date.parse(row.started_at);
  const ended = Date.parse(row.ended_at);
  return Number.isFinite(started) && Number.isFinite(ended) && ended - started >= 30_000;
}

export function rankVenueSongs(rows: PlayedRow[]) {
  const grouped = new Map<
    string,
    { result: PlaybackSearchResult; playCount: number; lastPlayedAt: string }
  >();
  for (const row of rows) {
    if (!countablePerformance(row) || !row.source) continue;
    const key = `${row.source.provider}:${row.source.external_id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.playCount += 1;
      if (row.ended_at! > existing.lastPlayedAt) existing.lastPlayedAt = row.ended_at!;
    } else {
      grouped.set(key, {
        result: {
          provider: row.source.provider as PlaybackSearchResult["provider"],
          externalId: row.source.external_id,
          title: row.source.title,
          channelName: row.source.channel_name,
          thumbnailUrl: row.source.thumbnail_url,
          duration: row.source.duration,
          metadata: row.source.metadata ?? {},
        },
        playCount: 1,
        lastPlayedAt: row.ended_at!,
      });
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt.localeCompare(a.lastPlayedAt))
    .slice(0, MAX_RESULTS);
}

export const getVenueTopSongsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const [{ supabaseAdmin }, auth] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/auth.server"),
    ]);
    try {
      await auth.assertVenueOperator(supabaseAdmin, context.userId, data.venueId);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Acesso negado.");
    }

    const rows: PlayedRow[] = [];
    for (let from = 0; from < MAX_PERFORMANCES; from += PAGE_SIZE) {
      const { data: page, error } = await supabaseAdmin
        .from("performances")
        .select(
          "started_at, ended_at, status, source:playback_sources!inner(provider, external_id, title, channel_name, thumbnail_url, duration, metadata), session:sessions!inner(venue_id)",
        )
        .eq("session.venue_id", data.venueId)
        .not("started_at", "is", null)
        .not("ended_at", "is", null)
        .in("status", ["completed", "cancelled"])
        .order("ended_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error("Não foi possível carregar as músicas mais tocadas.");
      rows.push(...((page ?? []) as unknown as PlayedRow[]));
      if (!page || page.length < PAGE_SIZE) break;
    }
    return rankVenueSongs(rows);
  });
