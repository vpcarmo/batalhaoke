ALTER TABLE public.matches
  ADD COLUMN withdrawn_slot text
  CHECK (withdrawn_slot IS NULL OR withdrawn_slot IN ('a', 'b', 'both'));
