CREATE TABLE public.venue_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_operators_venue_user_unique UNIQUE (venue_id, user_id)
);
CREATE INDEX venue_operators_user_idx ON public.venue_operators(user_id);
CREATE TRIGGER t_venue_operators BEFORE UPDATE ON public.venue_operators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
REVOKE ALL ON public.venue_operators FROM anon, authenticated;
GRANT ALL ON public.venue_operators TO service_role;
ALTER TABLE public.venue_operators ENABLE ROW LEVEL SECURITY;

-- Format guard. The UPDATE holds the championships row lock; guard_championship_entry
-- takes FOR UPDATE on the same row before inserting, so the two are serialized.
CREATE OR REPLACE FUNCTION public.guard_championship_format_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF new.format IS DISTINCT FROM old.format THEN
    IF old.status <> 'draft' THEN
      RAISE EXCEPTION 'championship format can only change while in draft' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.championship_entries WHERE championship_id = old.id) THEN
      RAISE EXCEPTION 'championship format cannot change once entries exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER t_championship_format_guard BEFORE UPDATE OF format ON public.championships
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_format_change();
REVOKE EXECUTE ON FUNCTION public.guard_championship_format_change() FROM PUBLIC, anon, authenticated;