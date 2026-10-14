-- Backfills the SQL changes made locally after migrations 0013, 0015 and 0016
-- had already been applied to the production database.

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
  song_title text;
  song_channel_name text;
  song_thumbnail_url text;
  song_duration text;
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

    IF pg_catalog.jsonb_object_length(song) <> 8
       OR NOT (song ? 'song_type')
       OR NOT (song ? 'song_order')
       OR NOT (song ? 'provider')
       OR NOT (song ? 'external_id')
       OR NOT (song ? 'title')
       OR NOT (song ? 'channel_name')
       OR NOT (song ? 'thumbnail_url')
       OR NOT (song ? 'duration')
       OR pg_catalog.jsonb_typeof(song -> 'song_type') <> 'string'
       OR pg_catalog.jsonb_typeof(song -> 'song_order') <> 'number'
       OR pg_catalog.jsonb_typeof(song -> 'provider') <> 'string'
       OR pg_catalog.jsonb_typeof(song -> 'external_id') <> 'string'
       OR pg_catalog.jsonb_typeof(song -> 'title') <> 'string'
       OR pg_catalog.jsonb_typeof(song -> 'channel_name') NOT IN ('string', 'null')
       OR pg_catalog.jsonb_typeof(song -> 'thumbnail_url') NOT IN ('string', 'null')
       OR pg_catalog.jsonb_typeof(song -> 'duration') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Dados de música inválidos.' USING ERRCODE = '22023';
    END IF;

    song_type := song ->> 'song_type';
    song_order := (song ->> 'song_order')::numeric;
    song_provider := song ->> 'provider';
    song_external_id := song ->> 'external_id';
    song_title := pg_catalog.btrim(song ->> 'title');
    song_channel_name := NULLIF(pg_catalog.btrim(song ->> 'channel_name'), '');
    song_thumbnail_url := song ->> 'thumbnail_url';
    song_duration := NULLIF(pg_catalog.btrim(song ->> 'duration'), '');

    IF song_type NOT IN ('main', 'reserve')
       OR song_order <> pg_catalog.trunc(song_order)
       OR (song_type = 'main' AND song_order NOT BETWEEN 1 AND 4)
       OR (song_type = 'reserve' AND song_order NOT BETWEEN 1 AND 2) THEN
      RAISE EXCEPTION 'Posição de música inválida.' USING ERRCODE = '22023';
    END IF;

    IF song_provider !~ '^[a-z][a-z0-9_-]{0,39}$'
       OR song_external_id !~ '^[A-Za-z0-9_-]{1,200}$'
       OR pg_catalog.length(song_title) NOT BETWEEN 1 AND 500
       OR (song_channel_name IS NOT NULL AND pg_catalog.length(song_channel_name) > 200)
       OR (song_thumbnail_url IS NOT NULL AND (
         pg_catalog.length(song_thumbnail_url) > 2048 OR song_thumbnail_url !~ '^https://'
       ))
       OR (song_duration IS NOT NULL AND pg_catalog.length(song_duration) > 32) THEN
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
  IF main_count = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos uma música principal.' USING ERRCODE = '22023';
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
    song_title := pg_catalog.btrim(song ->> 'title');
    song_channel_name := NULLIF(pg_catalog.btrim(song ->> 'channel_name'), '');
    song_thumbnail_url := song ->> 'thumbnail_url';
    song_duration := NULLIF(pg_catalog.btrim(song ->> 'duration'), '');

    INSERT INTO public.playback_sources (
      provider, external_id, title, channel_name, thumbnail_url, duration, metadata
    ) VALUES (
      song_provider,
      song_external_id,
      song_title,
      song_channel_name,
      song_thumbnail_url,
      song_duration,
      '{}'::jsonb
    )
    ON CONFLICT (provider, external_id) DO UPDATE
       SET title = CASE
             WHEN public.playback_sources.title = (EXCLUDED.provider || ' ' || EXCLUDED.external_id)
             THEN EXCLUDED.title
             ELSE public.playback_sources.title
           END,
           channel_name = COALESCE(public.playback_sources.channel_name, EXCLUDED.channel_name),
           thumbnail_url = COALESCE(public.playback_sources.thumbnail_url, EXCLUDED.thumbnail_url),
           duration = COALESCE(public.playback_sources.duration, EXCLUDED.duration)
    RETURNING id INTO source_id;

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

CREATE OR REPLACE FUNCTION public.normalize_championship_tie_entry_ids(p_entry_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT ids.entry_id ORDER BY ids.entry_id),
    ARRAY[]::uuid[]
  )
    FROM pg_catalog.unnest(COALESCE(p_entry_ids, ARRAY[]::uuid[])) AS ids(entry_id)
$function$;

REVOKE ALL ON FUNCTION public.normalize_championship_tie_entry_ids(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_championship_tie_entry_ids(uuid[])
  TO service_role;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.championship_group_stage_tie_decisions
     GROUP BY championship_id,
              COALESCE(group_letter, ''),
              public.normalize_championship_tie_entry_ids(tied_entry_ids)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      '0018 found tie decisions with the same canonical participant set for the same championship and group. Review them before retrying; no historical decisions were changed.';
  END IF;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS championship_group_stage_tie_decisions_semantic_unique
  ON public.championship_group_stage_tie_decisions(
    championship_id,
    (COALESCE(group_letter, '')),
    (public.normalize_championship_tie_entry_ids(tied_entry_ids))
  );

CREATE OR REPLACE FUNCTION public.prevent_championship_tie_decision_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'Uma decisão de desempate registrada não pode ser alterada ou removida.';
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_championship_tie_decision_changes()
  FROM PUBLIC, anon, authenticated;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS t
      JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'championship_group_stage_tie_decisions'
       AND t.tgname = 'championship_group_stage_tie_decisions_immutable'
       AND NOT t.tgisinternal
  ) THEN
    CREATE TRIGGER championship_group_stage_tie_decisions_immutable
      BEFORE UPDATE OR DELETE ON public.championship_group_stage_tie_decisions
      FOR EACH ROW EXECUTE FUNCTION public.prevent_championship_tie_decision_changes();
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.record_group_stage_tie_break(
  p_championship_id uuid,
  p_group_letter text,
  p_tied_entry_ids uuid[],
  p_criteria_applied text[],
  p_decision_order uuid[],
  p_rationale text,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  championship_row public.championships%ROWTYPE;
  tied_set uuid[];
  chosen_set uuid[];
  entry_count integer;
  existing_decision public.championship_group_stage_tie_decisions%ROWTYPE;
BEGIN
  SELECT *
    INTO championship_row
    FROM public.championships
   WHERE id = p_championship_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF championship_row.status NOT IN ('group_stage', 'group_stage_completed') THEN
    RAISE EXCEPTION 'A decisão manual só pode ser registrada durante a fase de grupos.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format NOT IN (12, 16) THEN
    RAISE EXCEPTION 'A fase de grupos só é válida para os formatos 12 e 16.' USING ERRCODE = 'P0001';
  END IF;

  IF p_group_letter IS NOT NULL AND p_group_letter NOT IN ('A', 'B', 'C', 'D') THEN
    RAISE EXCEPTION 'O grupo informado é inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF p_tied_entry_ids IS NULL OR cardinality(p_tied_entry_ids) = 0 THEN
    RAISE EXCEPTION 'Informe os participantes empatados.' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(p_tied_entry_ids) < 2 THEN
    RAISE EXCEPTION 'É necessário informar pelo menos dois participantes empatados.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision_order IS NULL OR cardinality(p_decision_order) = 0 THEN
    RAISE EXCEPTION 'Informe a ordem escolhida para os participantes empatados.' USING ERRCODE = 'P0001';
  END IF;

  IF array_position(p_tied_entry_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'A lista de participantes empatados não pode conter valores nulos.' USING ERRCODE = 'P0001';
  END IF;

  IF array_position(p_decision_order, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'A ordem escolhida não pode conter valores nulos.' USING ERRCODE = 'P0001';
  END IF;

  IF cardinality(p_decision_order) <> cardinality(p_tied_entry_ids) THEN
    RAISE EXCEPTION 'A ordem escolhida deve conter todos os participantes empatados.' USING ERRCODE = 'P0001';
  END IF;

  IF p_criteria_applied IS NULL OR cardinality(p_criteria_applied) < 3 THEN
    RAISE EXCEPTION 'Os critérios aplicados antes da decisão manual devem ser registrados.' USING ERRCODE = 'P0001';
  END IF;

  IF array_position(p_criteria_applied, 'approval') IS NULL
     OR array_position(p_criteria_applied, 'likes') IS NULL
     OR array_position(p_criteria_applied, 'dislikes') IS NULL THEN
    RAISE EXCEPTION 'A decisão manual deve preservar a ordem de aprovação, likes e dislikes.' USING ERRCODE = 'P0001';
  END IF;

  IF array_position(p_criteria_applied, 'approval') > array_position(p_criteria_applied, 'likes')
     OR array_position(p_criteria_applied, 'likes') > array_position(p_criteria_applied, 'dislikes') THEN
    RAISE EXCEPTION 'Os critérios aplicados devem respeitar a ordem aprovação > likes > dislikes antes da decisão manual.' USING ERRCODE = 'P0001';
  END IF;

  tied_set := public.normalize_championship_tie_entry_ids(p_tied_entry_ids);

  chosen_set := public.normalize_championship_tie_entry_ids(p_decision_order);

  IF cardinality(tied_set) <> cardinality(p_tied_entry_ids)
     OR cardinality(chosen_set) <> cardinality(p_decision_order) THEN
    RAISE EXCEPTION 'Cada participante deve aparecer uma única vez na decisão.' USING ERRCODE = 'P0001';
  END IF;

  IF tied_set <> chosen_set THEN
    RAISE EXCEPTION 'A ordem escolhida deve conter exatamente os mesmos participantes empatados.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
    INTO entry_count
    FROM unnest(p_tied_entry_ids) AS item
    JOIN public.championship_entries AS e
      ON e.id = item
   WHERE e.championship_id = p_championship_id
     AND e.status = 'confirmed'
     AND (p_group_letter IS NULL OR e.group_letter = p_group_letter);

  IF entry_count <> cardinality(p_tied_entry_ids) THEN
    RAISE EXCEPTION 'Os participantes informados não pertencem ao mesmo grupo ou ao conjunto elegível.' USING ERRCODE = 'P0001';
  END IF;

  SELECT d.*
    INTO existing_decision
    FROM public.championship_group_stage_tie_decisions AS d
   WHERE d.championship_id = p_championship_id
     AND d.group_letter IS NOT DISTINCT FROM p_group_letter
     AND public.normalize_championship_tie_entry_ids(d.tied_entry_ids) = tied_set
   FOR UPDATE;
  IF FOUND THEN
    IF existing_decision.chosen_order IS DISTINCT FROM p_decision_order THEN
      RAISE EXCEPTION 'Este desempate já foi decidido e não pode ser alterado.' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'championship_id', existing_decision.championship_id,
      'group_letter', existing_decision.group_letter,
      'tied_entry_ids', to_jsonb(existing_decision.tied_entry_ids),
      'criteria_applied', to_jsonb(existing_decision.criteria_applied),
      'chosen_order', to_jsonb(existing_decision.chosen_order),
      'operator_user_id', existing_decision.operator_user_id,
      'rationale', existing_decision.rationale
    );
  END IF;

  INSERT INTO public.championship_group_stage_tie_decisions (
    championship_id,
    group_letter,
    tied_entry_ids,
    criteria_applied,
    chosen_order,
    operator_user_id,
    rationale
  )
  VALUES (
    p_championship_id,
    p_group_letter,
    tied_set,
    p_criteria_applied,
    p_decision_order,
    p_operator_user_id,
    p_rationale
  );

  RETURN jsonb_build_object(
    'championship_id', p_championship_id,
    'group_letter', p_group_letter,
    'tied_entry_ids', to_jsonb(tied_set),
    'criteria_applied', to_jsonb(p_criteria_applied),
    'chosen_order', to_jsonb(p_decision_order),
    'operator_user_id', p_operator_user_id,
    'rationale', p_rationale
  );
END $$;

REVOKE ALL ON FUNCTION public.record_group_stage_tie_break(uuid, text, uuid[], text[], uuid[], text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_group_stage_tie_break(uuid, text, uuid[], text[], uuid[], text, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.link_championship_entry_participant(
  p_entry_id uuid,
  p_participant_id uuid,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  championship_id uuid;
  championship_row public.championships%ROWTYPE;
  entry_row public.championship_entries%ROWTYPE;
  stage_session_id uuid;
  participant_session_id uuid;
BEGIN
  SELECT e.championship_id
    INTO championship_id
    FROM public.championship_entries AS e
   WHERE e.id = p_entry_id;
  IF championship_id IS NULL THEN
    RAISE EXCEPTION 'Inscrição não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = championship_id
   FOR UPDATE;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);
  IF championship_row.status <> 'drawn' THEN
    RAISE EXCEPTION 'Os cantores só podem ser associados antes do encerramento da fase de grupos.';
  END IF;

  SELECT e.*
    INTO entry_row
    FROM public.championship_entries AS e
   WHERE e.id = p_entry_id
     AND e.championship_id = championship_row.id
   FOR UPDATE;
  IF entry_row.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Somente inscrições confirmadas podem ser associadas a um cantor.';
  END IF;
  IF entry_row.participant_id IS NOT NULL THEN
    IF entry_row.participant_id = p_participant_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'entry_id', entry_row.id,
        'participant_id', entry_row.participant_id
      );
    END IF;
    RAISE EXCEPTION 'Esta inscrição já está associada a outro cantor.';
  END IF;

  SELECT s.id
    INTO stage_session_id
    FROM public.sessions AS s
   WHERE s.championship_id = championship_row.id
     AND s.session_type = 'championship'
     AND s.status IN ('draft', 'active')
   FOR SHARE;
  IF stage_session_id IS NULL THEN
    RAISE EXCEPTION 'Prepare uma sessão de palco disponível antes de associar cantores.';
  END IF;

  SELECT p.session_id
    INTO participant_session_id
    FROM public.participants AS p
   WHERE p.id = p_participant_id
   FOR SHARE;
  IF participant_session_id IS DISTINCT FROM stage_session_id THEN
    RAISE EXCEPTION 'O cantor precisa pertencer à sessão de palco deste Campeonato.';
  END IF;

  UPDATE public.championship_entries AS e
     SET participant_id = p_participant_id
   WHERE e.id = entry_row.id
     AND e.participant_id IS NULL;

  RETURN pg_catalog.jsonb_build_object(
    'entry_id', entry_row.id,
    'participant_id', p_participant_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.link_championship_entry_participant(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_championship_entry_participant(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.start_championship_match(
  p_match_id uuid,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  championship_row public.championships%ROWTYPE;
  match_championship_id uuid;
  session_row public.sessions%ROWTYPE;
  entry_a public.championship_entries%ROWTYPE;
  entry_b public.championship_entries%ROWTYPE;
  performance_a public.performances%ROWTYPE;
  performance_b public.performances%ROWTYPE;
BEGIN
  SELECT m.championship_id INTO match_championship_id
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id;
  IF match_championship_id IS NULL THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  SELECT c.* INTO championship_row
    FROM public.championships AS c
   WHERE c.id = match_championship_id
   FOR UPDATE;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
     AND m.championship_id = championship_row.id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;

  IF match_row.status <> 'scheduled'
     OR NOT (
       (match_row.stage = 'quarter_final' AND (
         championship_row.status = 'quarter_finals'
         OR (championship_row.status = 'drawn' AND championship_row.format = 8)
       ))
       OR (match_row.stage = 'semi_final' AND championship_row.status = 'semi_finals')
       OR (match_row.stage = 'final' AND championship_row.status = 'final')
     ) THEN
    RAISE EXCEPTION 'O confronto não está agendado na fase atual do Campeonato.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.championship_matches AS other_match
     WHERE other_match.championship_id = championship_row.id
       AND other_match.id <> match_row.id
       AND other_match.status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'Conclua ou registre o WO do confronto em andamento antes de iniciar outro.';
  END IF;

  SELECT s.* INTO session_row
    FROM public.sessions AS s
   WHERE s.championship_id = championship_row.id
     AND s.session_type = 'championship'
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A sessão de palco do Campeonato não foi preparada.'; END IF;
  IF session_row.status <> 'active' THEN
    RAISE EXCEPTION 'A sessão de palco precisa estar ativa; o início do confronto não a ativa automaticamente.';
  END IF;

  SELECT e.* INTO entry_a FROM public.championship_entries AS e WHERE e.id = match_row.entry_a_id FOR SHARE;
  SELECT e.* INTO entry_b FROM public.championship_entries AS e WHERE e.id = match_row.entry_b_id FOR SHARE;
  SELECT p.* INTO performance_a FROM public.performances AS p WHERE p.id = match_row.performance_a_id FOR SHARE;
  SELECT p.* INTO performance_b FROM public.performances AS p WHERE p.id = match_row.performance_b_id FOR SHARE;
  IF entry_a.id IS NULL OR entry_b.id IS NULL
     OR entry_a.status <> 'confirmed' OR entry_b.status <> 'confirmed'
     OR entry_a.participant_id IS NULL OR entry_b.participant_id IS NULL
     OR performance_a.id IS NULL OR performance_b.id IS NULL
     OR performance_a.session_id <> session_row.id OR performance_b.session_id <> session_row.id
     OR performance_a.participant_id <> entry_a.participant_id
     OR performance_b.participant_id <> entry_b.participant_id
     OR performance_a.status <> 'queued' OR performance_b.status <> 'queued'
     OR performance_a.playback_source_id IS NULL OR performance_b.playback_source_id IS NULL THEN
    RAISE EXCEPTION 'Prepare apresentações A e B válidas na sessão de palco antes de iniciar.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.performances AS p
     WHERE p.session_id = session_row.id AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Encerre a apresentação ativa antes de iniciar este confronto.';
  END IF;

  UPDATE public.championship_matches AS m
     SET status = 'in_progress'
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  IF championship_row.status = 'drawn' THEN
    UPDATE public.championships AS c SET status = 'quarter_finals' WHERE c.id = championship_row.id;
  END IF;

  RETURN pg_catalog.to_jsonb(match_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.start_championship_match(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_championship_match(uuid, uuid)
  TO service_role;
