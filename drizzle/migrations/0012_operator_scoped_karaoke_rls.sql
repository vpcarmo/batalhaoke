-- Administrative and public reads are served by scoped server functions.
DROP POLICY IF EXISTS "mvp insert sessions" ON public.sessions;
DROP POLICY IF EXISTS "mvp update sessions" ON public.sessions;
DROP POLICY IF EXISTS "mvp insert participants" ON public.participants;
DROP POLICY IF EXISTS "mvp update participants" ON public.participants;
DROP POLICY IF EXISTS "mvp insert performances" ON public.performances;
DROP POLICY IF EXISTS "mvp update performances" ON public.performances;
DROP POLICY IF EXISTS "mvp insert sources" ON public.playback_sources;
DROP POLICY IF EXISTS "mvp read sessions" ON public.sessions;
DROP POLICY IF EXISTS "mvp read participants" ON public.participants;
DROP POLICY IF EXISTS "mvp read performances" ON public.performances;
DROP POLICY IF EXISTS "mvp read matches" ON public.matches;
DROP POLICY IF EXISTS "mvp read sources" ON public.playback_sources;
DROP POLICY IF EXISTS "mvp read api calls" ON public.provider_api_calls;

REVOKE ALL ON public.sessions, public.participants, public.performances,
  public.matches, public.playback_sources
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_api_calls FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.broadcast_karaoke_live_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session_id uuid;
  venue_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'sessions' THEN
    session_id := COALESCE(NEW.id, OLD.id);
    venue_id := COALESCE(NEW.venue_id, OLD.venue_id);
  ELSE
    session_id := COALESCE(NEW.session_id, OLD.session_id);
    SELECT s.venue_id INTO venue_id
    FROM public.sessions s
    WHERE s.id = session_id;
  END IF;

  IF session_id IS NOT NULL THEN
    PERFORM realtime.send(
      pg_catalog.jsonb_build_object('invalidate', true),
      'invalidate',
      'session-live:' || session_id::text,
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
    IF venue_id IS NOT NULL THEN
      PERFORM realtime.send(
        pg_catalog.jsonb_build_object('invalidate', true),
        'invalidate',
        'venue-live:' || venue_id::text,
        false
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_karaoke_live_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sessions_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER participants_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER performances_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.performances
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
CREATE TRIGGER matches_live_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_karaoke_live_change();
