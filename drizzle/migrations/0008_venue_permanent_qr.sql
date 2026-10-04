ALTER TABLE public.venues ADD COLUMN slug text UNIQUE;

UPDATE public.venues
SET slug = 'v-' || replace(gen_random_uuid()::text, '-', '')
WHERE slug IS NULL;