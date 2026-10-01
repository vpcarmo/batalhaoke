-- Event format is immutable in application flows; all existing sessions are free.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'free';
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_session_type_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_session_type_check CHECK (session_type IN ('free', 'x1', 'championship'));

-- Non-free formats always require both voting options.
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_session_type_voting_mode_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_session_type_voting_mode_check CHECK (
  (session_type = 'free' AND voting_mode IN ('like_only', 'like_dislike'))
  OR (session_type IN ('x1', 'championship') AND voting_mode = 'like_dislike')
);
