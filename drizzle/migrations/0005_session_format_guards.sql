-- Event format is selected at creation and must never be rewritten.
-- Voting mode remains configurable only while a session has not started.
CREATE OR REPLACE FUNCTION public.guard_session_format() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.session_type IS DISTINCT FROM old.session_type THEN
    RAISE EXCEPTION 'session_type is immutable';
  END IF;

  IF new.voting_mode IS DISTINCT FROM old.voting_mode
     AND (old.status <> 'draft' OR old.started_at IS NOT NULL) THEN
    RAISE EXCEPTION 'voting_mode cannot be changed after the session has started';
  END IF;

  RETURN new;
END $$;

CREATE TRIGGER t_sessions_format_guard
  BEFORE UPDATE OF session_type, voting_mode ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_format();
