ALTER TABLE public.sessions
  ADD COLUMN x1_voting_mode text NOT NULL DEFAULT 'during_performance'
  CONSTRAINT sessions_x1_voting_mode_check CHECK (x1_voting_mode IN ('during_performance','after_both_performances'));

ALTER TABLE public.matches
  ADD COLUMN voting_status text NOT NULL DEFAULT 'idle'
    CONSTRAINT matches_voting_status_check CHECK (voting_status IN ('idle','open','closed')),
  ADD COLUMN voting_ends_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.guard_x1_voting_mode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.x1_voting_mode IS DISTINCT FROM old.x1_voting_mode THEN
    IF old.session_type <> 'x1' THEN
      RAISE EXCEPTION 'x1_voting_mode only applies to X1 sessions';
    END IF;
    IF EXISTS (SELECT 1 FROM public.matches WHERE session_id = old.id) THEN
      RAISE EXCEPTION 'x1_voting_mode is locked once a match exists';
    END IF;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER t_sessions_x1_voting_mode_guard
  BEFORE UPDATE OF x1_voting_mode ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_x1_voting_mode();

CREATE OR REPLACE FUNCTION public.open_x1_vote_on_b_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.match_id IS NOT NULL AND new.match_slot = 'b'
     AND new.status = 'completed' AND old.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.matches m
       SET voting_status = 'open', voting_ends_at = now() + interval '30 seconds'
      FROM public.sessions s
     WHERE m.id = new.match_id AND s.id = m.session_id
       AND s.session_type = 'x1' AND s.x1_voting_mode = 'after_both_performances'
       AND m.status = 'in_progress' AND m.voting_status = 'idle';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER t_performances_open_x1_vote
  AFTER UPDATE OF status ON public.performances
  FOR EACH ROW EXECUTE FUNCTION public.open_x1_vote_on_b_complete();

CREATE TABLE public.x1_match_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE NOT NULL,
  voter_session_id uuid REFERENCES public.voter_sessions(id) ON DELETE CASCADE NOT NULL,
  chosen_participant_id uuid REFERENCES public.participants(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT x1_match_votes_match_voter_unique UNIQUE (match_id, voter_session_id)
);
CREATE INDEX x1_match_votes_match_idx ON public.x1_match_votes(match_id);
GRANT ALL ON public.x1_match_votes TO service_role;
REVOKE ALL ON public.x1_match_votes FROM anon, authenticated;
ALTER TABLE public.x1_match_votes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.validate_x1_match_vote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.matches%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.matches WHERE id = new.match_id FOR SHARE;
  IF NOT FOUND OR m.status <> 'in_progress' OR m.voting_status <> 'open'
     OR m.voting_ends_at IS NULL OR m.voting_ends_at <= now() THEN
    RAISE EXCEPTION 'x1 voting is closed' USING ERRCODE = 'P0001';
  END IF;
  IF new.chosen_participant_id NOT IN (m.participant_a_id, m.participant_b_id) THEN
    RAISE EXCEPTION 'chosen participant is not in this match';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER t_x1_match_votes_validate
  BEFORE INSERT ON public.x1_match_votes
  FOR EACH ROW EXECUTE FUNCTION public.validate_x1_match_vote();

ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;