-- BatalhaOkê Campeonato: core data structures (additive)

CREATE TABLE public.championships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  format integer NOT NULL CHECK (format IN (8, 12, 16)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','registration_open','registration_closed','drawn','group_stage','group_stage_completed','quarter_finals','semi_finals','final','completed','cancelled')),
  event_starts_at timestamptz,
  registration_deadline timestamptz,
  location text,
  rules text,
  prize_info text,
  fee_info text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_deadline IS NULL OR event_starts_at IS NULL OR registration_deadline <= event_starts_at)
);
CREATE INDEX championships_venue_idx ON public.championships(venue_id);
CREATE TRIGGER t_championships BEFORE UPDATE ON public.championships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Canonical stage-session link (nullable; at most one stage session per championship)
ALTER TABLE public.sessions ADD COLUMN championship_id uuid REFERENCES public.championships(id) ON DELETE RESTRICT;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_championship_type_chk CHECK (championship_id IS NULL OR session_type = 'championship');
CREATE UNIQUE INDEX sessions_championship_unique ON public.sessions(championship_id) WHERE championship_id IS NOT NULL;

CREATE TABLE public.championship_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  championship_id uuid NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES public.participants(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  stage_name text,
  contact_phone text,
  contact_email text,
  admin_notes text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','waitlist','withdrawn','disqualified')),
  group_letter text CHECK (group_letter IN ('A','B','C','D')),
  seed_number integer CHECK (seed_number BETWEEN 1 AND 16),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_phone IS NOT NULL OR contact_email IS NOT NULL)
);
CREATE INDEX championship_entries_champ_idx ON public.championship_entries(championship_id, status, created_at);
-- Duplicate protection uses the contact identifiers actually collected, not the name
CREATE UNIQUE INDEX championship_entries_phone_unique ON public.championship_entries(championship_id, regexp_replace(contact_phone, '\D', '', 'g'))
  WHERE contact_phone IS NOT NULL AND status IN ('confirmed','waitlist');
CREATE UNIQUE INDEX championship_entries_email_unique ON public.championship_entries(championship_id, lower(btrim(contact_email)))
  WHERE contact_email IS NOT NULL AND status IN ('confirmed','waitlist');
CREATE UNIQUE INDEX championship_entries_seed_unique ON public.championship_entries(championship_id, seed_number) WHERE seed_number IS NOT NULL;
CREATE UNIQUE INDEX championship_entries_participant_unique ON public.championship_entries(participant_id) WHERE participant_id IS NOT NULL;
CREATE TRIGGER t_championship_entries BEFORE UPDATE ON public.championship_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.guard_championship_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.championships%ROWTYPE; confirmed_count integer; locked boolean;
BEGIN
  IF tg_op = 'DELETE' THEN
    SELECT * INTO c FROM public.championships WHERE id = old.championship_id;
    IF FOUND AND c.status NOT IN ('draft','registration_open','registration_closed') THEN
      RAISE EXCEPTION 'entries cannot be deleted after the draw';
    END IF;
    RETURN old;
  END IF;

  SELECT * INTO c FROM public.championships WHERE id = new.championship_id FOR UPDATE;
  locked := c.status NOT IN ('draft','registration_open','registration_closed');

  IF tg_op = 'INSERT' THEN
    IF locked THEN RAISE EXCEPTION 'registrations are locked after the draw'; END IF;
  ELSE
    IF new.championship_id IS DISTINCT FROM old.championship_id THEN
      RAISE EXCEPTION 'championship_id is immutable';
    END IF;
    IF locked THEN
      IF new.name IS DISTINCT FROM old.name OR new.stage_name IS DISTINCT FROM old.stage_name
         OR new.group_letter IS DISTINCT FROM old.group_letter OR new.seed_number IS DISTINCT FROM old.seed_number THEN
        RAISE EXCEPTION 'entry identity and draw position are locked after the draw';
      END IF;
      IF new.status IS DISTINCT FROM old.status AND new.status NOT IN ('withdrawn','disqualified') THEN
        RAISE EXCEPTION 'after the draw an entry can only become withdrawn or disqualified';
      END IF;
    END IF;
  END IF;

  IF new.status = 'confirmed' AND (tg_op = 'INSERT' OR old.status <> 'confirmed') THEN
    SELECT count(*) INTO confirmed_count FROM public.championship_entries
     WHERE championship_id = new.championship_id AND status = 'confirmed' AND id <> new.id;
    IF confirmed_count >= c.format THEN
      RAISE EXCEPTION 'championship capacity reached' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER t_championship_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON public.championship_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_entry();

CREATE TABLE public.championship_entry_songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.championship_entries(id) ON DELETE CASCADE,
  playback_source_id uuid NOT NULL REFERENCES public.playback_sources(id) ON DELETE RESTRICT,
  song_type text NOT NULL CHECK (song_type IN ('main','reserve')),
  song_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((song_type = 'main' AND song_order BETWEEN 1 AND 4) OR (song_type = 'reserve' AND song_order BETWEEN 1 AND 2)),
  UNIQUE (entry_id, song_type, song_order)
);
CREATE INDEX championship_entry_songs_source_idx ON public.championship_entry_songs(playback_source_id);

CREATE TABLE public.championship_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  championship_id uuid NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('quarter_final','semi_final','final')),
  match_number integer NOT NULL,
  entry_a_id uuid REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  entry_b_id uuid REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  winner_entry_id uuid REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  performance_a_id uuid REFERENCES public.performances(id) ON DELETE RESTRICT,
  performance_b_id uuid REFERENCES public.performances(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled','wo')),
  voting_status text NOT NULL DEFAULT 'idle' CHECK (voting_status IN ('idle','open','closed')),
  voting_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (championship_id, stage, match_number),
  CHECK ((stage = 'quarter_final' AND match_number BETWEEN 1 AND 4) OR (stage = 'semi_final' AND match_number BETWEEN 1 AND 2) OR (stage = 'final' AND match_number = 1)),
  CHECK (entry_a_id IS NULL OR entry_b_id IS NULL OR entry_a_id <> entry_b_id),
  CHECK (performance_a_id IS NULL OR performance_b_id IS NULL OR performance_a_id <> performance_b_id),
  CHECK (winner_entry_id IS NULL OR winner_entry_id = entry_a_id OR winner_entry_id = entry_b_id),
  CHECK (voting_status <> 'open' OR voting_ends_at IS NOT NULL)
);
CREATE UNIQUE INDEX championship_matches_perf_a_unique ON public.championship_matches(performance_a_id) WHERE performance_a_id IS NOT NULL;
CREATE UNIQUE INDEX championship_matches_perf_b_unique ON public.championship_matches(performance_b_id) WHERE performance_b_id IS NOT NULL;
CREATE TRIGGER t_championship_matches BEFORE UPDATE ON public.championship_matches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.validate_championship_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e public.championship_entries%ROWTYPE; p public.performances%ROWTYPE; s_champ uuid; slot text; eid uuid; pid uuid;
BEGIN
  IF tg_op = 'UPDATE' AND (new.championship_id IS DISTINCT FROM old.championship_id
     OR new.stage IS DISTINCT FROM old.stage OR new.match_number IS DISTINCT FROM old.match_number) THEN
    RAISE EXCEPTION 'match identity is immutable';
  END IF;
  IF tg_op = 'UPDATE' AND old.status IN ('completed','wo') AND old.winner_entry_id IS NOT NULL
     AND new.winner_entry_id IS DISTINCT FROM old.winner_entry_id THEN
    RAISE EXCEPTION 'winner of a finished match cannot be changed';
  END IF;
  FOREACH slot IN ARRAY ARRAY['a','b'] LOOP
    eid := CASE slot WHEN 'a' THEN new.entry_a_id ELSE new.entry_b_id END;
    pid := CASE slot WHEN 'a' THEN new.performance_a_id ELSE new.performance_b_id END;
    IF eid IS NOT NULL THEN
      SELECT * INTO e FROM public.championship_entries WHERE id = eid;
      IF e.championship_id <> new.championship_id THEN
        RAISE EXCEPTION 'entry % does not belong to this championship', slot;
      END IF;
    END IF;
    IF pid IS NOT NULL THEN
      IF eid IS NULL THEN RAISE EXCEPTION 'performance % requires entry %', slot, slot; END IF;
      SELECT * INTO p FROM public.performances WHERE id = pid;
      SELECT championship_id INTO s_champ FROM public.sessions WHERE id = p.session_id;
      IF s_champ IS DISTINCT FROM new.championship_id THEN
        RAISE EXCEPTION 'performance % is not in this championship stage session', slot;
      END IF;
      IF e.participant_id IS NULL OR p.participant_id <> e.participant_id THEN
        RAISE EXCEPTION 'performance % participant does not match entry %', slot, slot;
      END IF;
    END IF;
  END LOOP;
  RETURN new;
END $$;
CREATE TRIGGER t_championship_matches_validate BEFORE INSERT OR UPDATE ON public.championship_matches
  FOR EACH ROW EXECUTE FUNCTION public.validate_championship_match();

CREATE TABLE public.championship_match_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.championship_matches(id) ON DELETE CASCADE,
  voter_session_id uuid NOT NULL REFERENCES public.voter_sessions(id) ON DELETE CASCADE,
  chosen_entry_id uuid NOT NULL REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, voter_session_id)
);
CREATE INDEX championship_match_votes_tally_idx ON public.championship_match_votes(match_id, chosen_entry_id);

CREATE OR REPLACE FUNCTION public.validate_championship_match_vote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m public.championship_matches%ROWTYPE; vs_champ uuid;
BEGIN
  SELECT * INTO m FROM public.championship_matches WHERE id = new.match_id FOR SHARE;
  IF NOT FOUND OR m.status <> 'in_progress' OR m.voting_status <> 'open'
     OR m.voting_ends_at IS NULL OR m.voting_ends_at <= now() THEN
    RAISE EXCEPTION 'championship voting is closed' USING ERRCODE = 'P0001';
  END IF;
  IF new.chosen_entry_id IS DISTINCT FROM m.entry_a_id AND new.chosen_entry_id IS DISTINCT FROM m.entry_b_id THEN
    RAISE EXCEPTION 'chosen entry is not in this match';
  END IF;
  SELECT s.championship_id INTO vs_champ FROM public.voter_sessions v JOIN public.sessions s ON s.id = v.session_id WHERE v.id = new.voter_session_id;
  IF vs_champ IS DISTINCT FROM m.championship_id THEN
    RAISE EXCEPTION 'voter session does not belong to this championship';
  END IF;
  new.created_at := now();
  RETURN new;
END $$;
CREATE TRIGGER t_championship_match_votes_validate BEFORE INSERT ON public.championship_match_votes
  FOR EACH ROW EXECUTE FUNCTION public.validate_championship_match_vote();
CREATE OR REPLACE FUNCTION public.block_championship_vote_update()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'championship votes are immutable'; END $$;
CREATE TRIGGER t_championship_match_votes_immutable BEFORE UPDATE ON public.championship_match_votes
  FOR EACH ROW EXECUTE FUNCTION public.block_championship_vote_update();

-- Server-only access: no client grants, RLS on, no policies
REVOKE ALL ON public.championships, public.championship_entries, public.championship_entry_songs, public.championship_matches, public.championship_match_votes FROM anon, authenticated;
GRANT ALL ON public.championships, public.championship_entries, public.championship_entry_songs, public.championship_matches, public.championship_match_votes TO service_role;
ALTER TABLE public.championships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_entry_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.championship_match_votes ENABLE ROW LEVEL SECURITY;
REVOKE EXECUTE ON FUNCTION public.guard_championship_entry(), public.validate_championship_match(), public.validate_championship_match_vote(), public.block_championship_vote_update() FROM PUBLIC, anon, authenticated;
