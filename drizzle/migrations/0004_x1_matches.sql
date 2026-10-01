-- X1 foundation: matches remain independent from the existing free-performance flow.
-- This supports the composite match foreign keys without changing existing identifiers.
ALTER TABLE public.participants
  ADD CONSTRAINT participants_session_id_id_key UNIQUE (session_id, id);

CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  participant_a_id uuid NOT NULL,
  participant_b_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  winner_participant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matches_distinct_participants CHECK (participant_a_id <> participant_b_id),
  CONSTRAINT matches_participant_a_session_fkey FOREIGN KEY (session_id, participant_a_id)
    REFERENCES public.participants(session_id, id),
  CONSTRAINT matches_participant_b_session_fkey FOREIGN KEY (session_id, participant_b_id)
    REFERENCES public.participants(session_id, id),
  CONSTRAINT matches_winner_check CHECK (
    (status IN ('scheduled', 'in_progress', 'cancelled') AND winner_participant_id IS NULL)
    OR (status = 'completed' AND winner_participant_id IN (participant_a_id, participant_b_id))
  )
);

ALTER TABLE public.performances
  ADD COLUMN match_id uuid REFERENCES public.matches(id) ON DELETE RESTRICT,
  ADD COLUMN match_slot text;
ALTER TABLE public.performances
  ADD CONSTRAINT performances_match_slot_check CHECK (match_slot IS NULL OR match_slot IN ('a', 'b')),
  ADD CONSTRAINT performances_match_reference_check CHECK (
    (match_id IS NULL AND match_slot IS NULL) OR (match_id IS NOT NULL AND match_slot IS NOT NULL)
  );

-- A match can have no more than one performance for each position.
CREATE UNIQUE INDEX performances_match_slot_unique
  ON public.performances(match_id, match_slot) WHERE match_id IS NOT NULL;
-- Validate existing data before installing the active-performance constraint. The
-- migration intentionally aborts without changing history if an old session has
-- more than one active performance.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.performances
    WHERE status = 'active'
    GROUP BY session_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot create performances_one_active_per_session: existing sessions have multiple active performances';
  END IF;
END $$;
-- The X1 sequence and public vote lookup require one active performance per session.
CREATE UNIQUE INDEX performances_one_active_per_session
  ON public.performances(session_id) WHERE status = 'active';
CREATE UNIQUE INDEX matches_one_in_progress_per_session
  ON public.matches(session_id) WHERE status = 'in_progress';
CREATE INDEX matches_session_id_idx ON public.matches(session_id);

-- Composite foreign keys enforce match participants' session. This focused trigger
-- additionally enforces the performance participant/slot mapping for all writers.
CREATE OR REPLACE FUNCTION public.validate_match_performance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.matches%ROWTYPE;
BEGIN
  IF new.match_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT * INTO m FROM public.matches WHERE id = new.match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found';
  END IF;
  IF new.session_id <> m.session_id THEN
    RAISE EXCEPTION 'performance session must match match session';
  END IF;
  IF (new.match_slot = 'a' AND new.participant_id <> m.participant_a_id)
     OR (new.match_slot = 'b' AND new.participant_id <> m.participant_b_id) THEN
    RAISE EXCEPTION 'performance participant must match its match slot';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER t_performances_match_guard
  BEFORE INSERT OR UPDATE OF match_id, match_slot, session_id, participant_id ON public.performances
  FOR EACH ROW EXECUTE FUNCTION public.validate_match_performance();

CREATE TRIGGER t_matches BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.matches TO anon, authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mvp read matches" ON public.matches FOR SELECT USING (true);
