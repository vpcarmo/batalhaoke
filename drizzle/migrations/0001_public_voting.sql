-- Sessions: permanent public code for QR + public display settings (additive)
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS public_code text NOT NULL DEFAULT substr(replace(gen_random_uuid()::text,'-',''),1,10);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_public_code_key ON public.sessions(public_code);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS tv_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS show_qr_on_tv boolean NOT NULL DEFAULT false;

-- Denormalized like counter on performances (already streamed via Realtime)
ALTER TABLE public.performances ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

-- Anonymous voters (only a hash of the browser token is stored)
CREATE TABLE public.voter_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id),
  voter_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, voter_token_hash)
);
GRANT ALL ON public.voter_sessions TO service_role;
ALTER TABLE public.voter_sessions ENABLE ROW LEVEL SECURITY;
-- no client policies: server-only

-- Votes: controller becomes optional, voter_session added
ALTER TABLE public.votes ALTER COLUMN controller_id DROP NOT NULL;
ALTER TABLE public.votes ADD COLUMN IF NOT EXISTS voter_session_id uuid REFERENCES public.voter_sessions(id);
COMMENT ON COLUMN public.votes.controller_id IS 'Optional: reserved for future physical controllers (not used in MVP)';
ALTER TABLE public.votes ADD CONSTRAINT votes_type_check CHECK (vote_type IN ('like'));
ALTER TABLE public.votes ADD CONSTRAINT votes_voter_present CHECK (voter_session_id IS NOT NULL OR controller_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS votes_one_per_voter_perf ON public.votes(performance_id, voter_session_id) WHERE voter_session_id IS NOT NULL;
GRANT ALL ON public.votes TO service_role;

-- Keep like_count in sync; block clients from editing it
CREATE OR REPLACE FUNCTION public.bump_like_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if new.vote_type = 'like' then
    perform set_config('karaoke.vote_trigger','on',true);
    update public.performances set like_count = like_count + 1 where id = new.performance_id;
  end if;
  return new;
end $$;
CREATE TRIGGER t_votes_like AFTER INSERT ON public.votes FOR EACH ROW EXECUTE FUNCTION public.bump_like_count();

CREATE OR REPLACE FUNCTION public.protect_like_count() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if coalesce(current_setting('karaoke.vote_trigger', true),'') <> 'on' then
    if tg_op = 'INSERT' then new.like_count := 0; else new.like_count := old.like_count; end if;
  end if;
  return new;
end $$;
CREATE TRIGGER t_performances_like_guard BEFORE INSERT OR UPDATE ON public.performances FOR EACH ROW EXECUTE FUNCTION public.protect_like_count();