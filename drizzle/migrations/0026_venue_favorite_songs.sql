CREATE TABLE public.venue_favorite_songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  playback_source_id uuid NOT NULL REFERENCES public.playback_sources(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT venue_favorite_songs_venue_source_key UNIQUE (venue_id, playback_source_id)
);

CREATE INDEX venue_favorite_songs_venue_created_idx
  ON public.venue_favorite_songs (venue_id, created_at DESC);

ALTER TABLE public.venue_favorite_songs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_favorite_songs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_favorite_songs TO service_role;
