CREATE OR REPLACE FUNCTION public.register_championship_entry(
  p_championship_id uuid,
  p_name text,
  p_stage_name text,
  p_contact_phone text,
  p_contact_email text,
  p_songs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  championship_row public.championships%ROWTYPE;
  confirmed_count integer;
  entry_status text;
  entry_id uuid;
  song jsonb;
  song_type text;
  song_order numeric;
  song_provider text;
  song_external_id text;
  source_id uuid;
  main_count integer := 0;
  reserve_count integer := 0;
  seen_slots text[] := ARRAY[]::text[];
  slot_key text;
BEGIN
  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF championship_row.status <> 'registration_open' THEN
    RAISE EXCEPTION 'As inscrições deste Campeonato não estão abertas.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.registration_deadline IS NOT NULL
     AND championship_row.registration_deadline <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'O prazo de inscrição deste Campeonato terminou.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format NOT IN (8, 12, 16) THEN
    RAISE EXCEPTION 'Formato de Campeonato inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF p_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_name)) < 1
     OR pg_catalog.length(pg_catalog.btrim(p_name)) > 120 THEN
    RAISE EXCEPTION 'Informe um nome válido.' USING ERRCODE = '22023';
  END IF;

  IF p_stage_name IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(p_stage_name)) > 120 THEN
    RAISE EXCEPTION 'Nome artístico inválido.' USING ERRCODE = '22023';
  END IF;

  IF (p_contact_phone IS NULL OR pg_catalog.length(pg_catalog.btrim(p_contact_phone)) = 0)
     AND (p_contact_email IS NULL OR pg_catalog.length(pg_catalog.btrim(p_contact_email)) = 0) THEN
    RAISE EXCEPTION 'Informe um telefone ou e-mail.' USING ERRCODE = '22023';
  END IF;

  IF p_contact_phone IS NOT NULL AND (
    pg_catalog.length(pg_catalog.btrim(p_contact_phone)) > 40
    OR pg_catalog.length(pg_catalog.btrim(p_contact_phone)) = 0
  ) THEN
    RAISE EXCEPTION 'Telefone inválido.' USING ERRCODE = '22023';
  END IF;

  IF p_contact_email IS NOT NULL AND (
    pg_catalog.length(pg_catalog.btrim(p_contact_email)) > 320
    OR p_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) THEN
    RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE = '22023';
  END IF;

  IF p_songs IS NULL OR pg_catalog.jsonb_typeof(p_songs) <> 'array' THEN
    RAISE EXCEPTION 'Informe até quatro músicas principais e duas reservas.' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.jsonb_array_length(p_songs) > 6 THEN
    RAISE EXCEPTION 'Informe até quatro músicas principais e duas reservas.' USING ERRCODE = '22023';
  END IF;

  FOR song IN SELECT value FROM pg_catalog.jsonb_array_elements(p_songs)
  LOOP
    IF pg_catalog.jsonb_typeof(song) <> 'object' THEN
      RAISE EXCEPTION 'Dados de música inválidos.' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.jsonb_object_length(song) <> 4
       OR NOT (song ? 'song_type')
       OR NOT (song ? 'song_order')
       OR NOT (song ? 'provider')
       OR NOT (song ? 'external_id')
       OR pg_catalog.jsonb_typeof(song -> 'song_type') <> 'string'
       OR pg_catalog.jsonb_typeof(song -> 'song_order') <> 'number'
       OR pg_catalog.jsonb_typeof(song -> 'provider') <> 'string'
       OR pg_catalog.jsonb_typeof(song -> 'external_id') <> 'string' THEN
      RAISE EXCEPTION 'Dados de música inválidos.' USING ERRCODE = '22023';
    END IF;

    song_type := song ->> 'song_type';
    song_order := (song ->> 'song_order')::numeric;
    song_provider := song ->> 'provider';
    song_external_id := song ->> 'external_id';

    IF song_type NOT IN ('main', 'reserve')
       OR song_order <> pg_catalog.trunc(song_order)
       OR (song_type = 'main' AND song_order NOT BETWEEN 1 AND 4)
       OR (song_type = 'reserve' AND song_order NOT BETWEEN 1 AND 2) THEN
      RAISE EXCEPTION 'Posição de música inválida.' USING ERRCODE = '22023';
    END IF;

    IF song_provider !~ '^[a-z][a-z0-9_-]{0,39}$'
       OR song_external_id !~ '^[A-Za-z0-9_-]{1,200}$' THEN
      RAISE EXCEPTION 'Fonte de música inválida.' USING ERRCODE = '22023';
    END IF;

    slot_key := song_type || ':' || song_order::text;
    IF slot_key = ANY(seen_slots) THEN
      RAISE EXCEPTION 'Cada posição de música deve ser única.' USING ERRCODE = '22023';
    END IF;
    seen_slots := pg_catalog.array_append(seen_slots, slot_key);

    IF song_type = 'main' THEN
      main_count := main_count + 1;
    ELSE
      reserve_count := reserve_count + 1;
    END IF;
  END LOOP;

  IF main_count > 4 OR reserve_count > 2 THEN
    RAISE EXCEPTION 'Informe até quatro músicas principais e duas reservas.' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO confirmed_count
    FROM public.championship_entries AS e
   WHERE e.championship_id = p_championship_id
     AND e.status = 'confirmed';

  IF confirmed_count < championship_row.format THEN
    entry_status := 'confirmed';
  ELSE
    entry_status := 'waitlist';
  END IF;

  INSERT INTO public.championship_entries (
    championship_id, name, stage_name, contact_phone, contact_email, status
  ) VALUES (
    p_championship_id,
    pg_catalog.btrim(p_name),
    NULLIF(pg_catalog.btrim(p_stage_name), ''),
    NULLIF(pg_catalog.btrim(p_contact_phone), ''),
    NULLIF(pg_catalog.btrim(p_contact_email), ''),
    entry_status
  )
  RETURNING id INTO entry_id;

  FOR song IN SELECT value FROM pg_catalog.jsonb_array_elements(p_songs)
  LOOP
    song_type := song ->> 'song_type';
    song_order := (song ->> 'song_order')::numeric;
    song_provider := song ->> 'provider';
    song_external_id := song ->> 'external_id';

    INSERT INTO public.playback_sources (
      provider, external_id, title, metadata
    ) VALUES (
      song_provider,
      song_external_id,
      song_provider || ' ' || song_external_id,
      '{}'::jsonb
    )
    ON CONFLICT (provider, external_id) DO NOTHING
    RETURNING id INTO source_id;

    IF source_id IS NULL THEN
      SELECT s.id
        INTO source_id
        FROM public.playback_sources AS s
       WHERE s.provider = song_provider
         AND s.external_id = song_external_id;
    END IF;

    IF source_id IS NULL THEN
      RAISE EXCEPTION 'Não foi possível resolver uma fonte de música.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.championship_entry_songs (
      entry_id, playback_source_id, song_type, song_order
    ) VALUES (
      entry_id, source_id, song_type, song_order::integer
    );
    source_id := NULL;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('id', entry_id, 'status', entry_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.register_championship_entry(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_championship_entry(uuid, text, text, text, text, jsonb)
  TO service_role;
