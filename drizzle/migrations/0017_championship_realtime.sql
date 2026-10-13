CREATE OR REPLACE FUNCTION public.broadcast_karaoke_live_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_session_id uuid;
  target_venue_id uuid;
  target_championship_id uuid;
  target_entry_id uuid;
  target_match_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'sessions' THEN
    target_session_id := COALESCE(NEW.id, OLD.id);
    target_venue_id := COALESCE(NEW.venue_id, OLD.venue_id);
  ELSIF TG_TABLE_NAME = 'championships' THEN
    target_championship_id := COALESCE(NEW.id, OLD.id);
    target_venue_id := COALESCE(NEW.venue_id, OLD.venue_id);
  ELSIF TG_TABLE_NAME = 'championship_entry_songs' THEN
    target_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
    SELECT e.championship_id
      INTO target_championship_id
      FROM public.championship_entries AS e
     WHERE e.id = target_entry_id;
  ELSIF TG_TABLE_NAME = 'championship_match_votes' THEN
    target_match_id := COALESCE(NEW.match_id, OLD.match_id);
    SELECT m.championship_id
      INTO target_championship_id
      FROM public.championship_matches AS m
     WHERE m.id = target_match_id;
  ELSIF TG_TABLE_NAME IN (
    'championship_entries',
    'championship_matches',
    'championship_group_stage_tie_decisions'
  ) THEN
    target_championship_id := COALESCE(NEW.championship_id, OLD.championship_id);
  ELSE
    target_session_id := COALESCE(NEW.session_id, OLD.session_id);
  END IF;

  IF target_championship_id IS NOT NULL THEN
    SELECT c.venue_id
      INTO target_venue_id
      FROM public.championships AS c
     WHERE c.id = target_championship_id;
    SELECT s.id
      INTO target_session_id
      FROM public.sessions AS s
     WHERE s.championship_id = target_championship_id;
  ELSIF TG_TABLE_NAME <> 'sessions' THEN
    SELECT s.venue_id
      INTO target_venue_id
      FROM public.sessions AS s
     WHERE s.id = target_session_id;
  END IF;

  IF target_session_id IS NOT NULL THEN
    PERFORM realtime.send(
      pg_catalog.jsonb_build_object('invalidate', true),
      'invalidate',
      'session-live:' || target_session_id::text,
      false
    );
  END IF;

  IF TG_TABLE_NAME = 'sessions' THEN
    IF TG_OP = 'UPDATE' AND OLD.venue_id IS DISTINCT FROM NEW.venue_id
       AND OLD.venue_id IS NOT NULL THEN
      PERFORM realtime.send(
        pg_catalog.jsonb_build_object('invalidate', true),
        'invalidate',
        'venue-live:' || OLD.venue_id::text,
        false
      );
    END IF;
    IF target_venue_id IS NOT NULL THEN
      PERFORM realtime.send(
        pg_catalog.jsonb_build_object('invalidate', true),
        'invalidate',
        'venue-live:' || target_venue_id::text,
        false
      );
    END IF;
  ELSIF target_venue_id IS NOT NULL THEN
    PERFORM realtime.send(
      pg_catalog.jsonb_build_object('invalidate', true),
      'invalidate',
      'venue-live:' || target_venue_id::text,
      false
    );
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER championships_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.championships
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER championship_entries_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.championship_entries
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER championship_matches_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.championship_matches
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER championship_match_votes_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.championship_match_votes
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER championship_entry_songs_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.championship_entry_songs
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER championship_group_stage_tie_decisions_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.championship_group_stage_tie_decisions
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();

REVOKE ALL ON FUNCTION public.broadcast_karaoke_live_change()
  FROM PUBLIC, anon, authenticated;
