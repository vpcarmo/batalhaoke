-- Per-session voting mode and dislike counts (additive, safe for existing sessions)
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS voting_mode text NOT NULL DEFAULT 'like_only';
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_voting_mode_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_voting_mode_check CHECK (voting_mode IN ('like_only', 'like_dislike'));

ALTER TABLE public.performances ADD COLUMN IF NOT EXISTS dislike_count integer NOT NULL DEFAULT 0;

-- The original vote_type constraint already accepts like and dislike. Remove only
-- the temporary public-voting constraint that restricted votes to likes.
ALTER TABLE public.votes DROP CONSTRAINT IF EXISTS votes_type_check;

-- Keep both denormalized counters in sync through the existing trigger function.
CREATE OR REPLACE FUNCTION public.bump_like_count() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  perform set_config('karaoke.vote_trigger','on',true);
  if new.vote_type = 'like' then
    update public.performances set like_count = like_count + 1 where id = new.performance_id;
  elsif new.vote_type = 'dislike' then
    update public.performances set dislike_count = dislike_count + 1 where id = new.performance_id;
  end if;
  return new;
end $$;

-- Preserve direct-edit protection for the original counter and extend it to the
-- new counter. The vote trigger is the sole permitted counter writer.
CREATE OR REPLACE FUNCTION public.protect_like_count() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if coalesce(current_setting('karaoke.vote_trigger', true),'') <> 'on' then
    if tg_op = 'INSERT' then
      new.like_count := 0;
      new.dislike_count := 0;
    else
      new.like_count := old.like_count;
      new.dislike_count := old.dislike_count;
    end if;
  end if;
  return new;
end $$;
