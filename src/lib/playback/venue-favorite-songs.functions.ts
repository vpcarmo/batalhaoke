import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlaybackSearchResult } from "./types";

const Venue = z.string().uuid();
const Source = z
  .object({
    provider: z.enum(["youtube"]),
    externalId: z.string().trim().min(1).max(256),
    title: z.string().trim().min(1).max(500),
    channelName: z.string().max(500).nullable().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    duration: z.string().max(32).nullable().optional(),
    metadata: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
  })
  .strict();
export const venueFavoriteSongInputSchema = z.object({ venueId: Venue, song: Source }).strict();

async function assertVenue(userId: string, venueId: string) {
  const [{ supabaseAdmin }, auth] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/auth.server"),
  ]);
  await auth.assertVenueOperator(supabaseAdmin, userId, venueId);
  return supabaseAdmin;
}

async function resolveSource(
  db: Awaited<ReturnType<typeof assertVenue>>,
  song: PlaybackSearchResult,
) {
  const { data: existing, error } = await db
    .from("playback_sources")
    .select("id")
    .eq("provider", song.provider)
    .eq("external_id", song.externalId)
    .maybeSingle();
  if (error) throw new Error("Não foi possível localizar a fonte musical.");
  if (existing) return existing.id;
  const { data, error: insertError } = await db
    .from("playback_sources")
    .insert({
      provider: song.provider,
      external_id: song.externalId,
      title: song.title,
      channel_name: song.channelName,
      thumbnail_url: song.thumbnailUrl,
      duration: song.duration,
      metadata: song.metadata,
    })
    .select("id")
    .single();
  if (!insertError && data) return data.id;
  if (insertError?.code === "23505") {
    const raced = await db
      .from("playback_sources")
      .select("id")
      .eq("provider", song.provider)
      .eq("external_id", song.externalId)
      .single();
    if (!raced.error && raced.data) return raced.data.id;
  }
  throw new Error("Não foi possível salvar a fonte musical.");
}

export const addVenueFavoriteSongFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z.object({ venueId: Venue, song: Source }).strict().parse(value),
  )
  .handler(async ({ data, context }) => {
    const db = await assertVenue(context.userId, data.venueId);
    const playbackSourceId = await resolveSource(db, {
      ...data.song,
      channelName: data.song.channelName ?? null,
      thumbnailUrl: data.song.thumbnailUrl ?? null,
      duration: data.song.duration ?? null,
    });
    const { error } = await db.from("venue_favorite_songs").upsert(
      {
        venue_id: data.venueId,
        playback_source_id: playbackSourceId,
        created_by: context.userId,
      },
      { onConflict: "venue_id,playback_source_id", ignoreDuplicates: true },
    );
    if (error) throw new Error("Não foi possível adicionar a música aos favoritos.");
    return { ok: true };
  });

export const removeVenueFavoriteSongFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        venueId: Venue,
        provider: z.enum(["youtube"]),
        externalId: z.string().min(1).max(256),
      })
      .strict()
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const db = await assertVenue(context.userId, data.venueId);
    const { data: source, error: sourceError } = await db
      .from("playback_sources")
      .select("id")
      .eq("provider", data.provider)
      .eq("external_id", data.externalId)
      .maybeSingle();
    if (sourceError) throw new Error("Não foi possível localizar a fonte musical.");
    if (source) {
      const { error } = await db
        .from("venue_favorite_songs")
        .delete()
        .eq("venue_id", data.venueId)
        .eq("playback_source_id", source.id);
      if (error) throw new Error("Não foi possível remover a música dos favoritos.");
    }
    return { ok: true };
  });

export const listVenueFavoriteSongsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ venueId: Venue }).strict().parse(value))
  .handler(async ({ data, context }) => {
    const db = await assertVenue(context.userId, data.venueId);
    const { data: rows, error } = await db
      .from("venue_favorite_songs")
      .select(
        "created_at, source:playback_sources!inner(provider, external_id, title, channel_name, thumbnail_url, duration, metadata)",
      )
      .eq("venue_id", data.venueId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Não foi possível carregar as músicas favoritas.");
    return favoriteRowsToResults((rows ?? []) as unknown as FavoriteSourceRow[]);
  });

type FavoriteSourceRow = {
  source: {
    provider: PlaybackSearchResult["provider"];
    external_id: string;
    title: string;
    channel_name: string | null;
    thumbnail_url: string | null;
    duration: string | null;
    metadata: PlaybackSearchResult["metadata"] | null;
  };
};

export function favoriteRowsToResults(rows: FavoriteSourceRow[]): PlaybackSearchResult[] {
  return rows.map(({ source }) => ({
    provider: source.provider,
    externalId: source.external_id,
    title: source.title,
    channelName: source.channel_name,
    thumbnailUrl: source.thumbnail_url,
    duration: source.duration,
    metadata: source.metadata ?? {},
  }));
}
