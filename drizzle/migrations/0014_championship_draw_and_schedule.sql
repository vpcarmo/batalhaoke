CREATE OR REPLACE FUNCTION public.draw_championship(p_championship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  championship_row public.championships%ROWTYPE;
  confirmed_count integer;
  assigned_count integer;
  matches_count integer;
BEGIN
  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF championship_row.status <> 'registration_closed' THEN
    RAISE EXCEPTION 'O sorteio só pode ser realizado após o encerramento das inscrições.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format NOT IN (8, 12, 16) THEN
    RAISE EXCEPTION 'Formato de Campeonato inválido.' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO confirmed_count
    FROM public.championship_entries AS e
   WHERE e.championship_id = p_championship_id
     AND e.status = 'confirmed';

  IF confirmed_count <> championship_row.format THEN
    RAISE EXCEPTION 'A quantidade de inscrições confirmadas deve corresponder ao formato do Campeonato.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public.championship_entries AS e
        WHERE e.championship_id = p_championship_id
          AND (e.group_letter IS NOT NULL OR e.seed_number IS NOT NULL)
     )
     OR EXISTS (
       SELECT 1
         FROM public.championship_matches AS m
        WHERE m.championship_id = p_championship_id
     ) THEN
    RAISE EXCEPTION 'O sorteio deste Campeonato já foi realizado.' USING ERRCODE = 'P0001';
  END IF;

  WITH randomized AS MATERIALIZED (
    SELECT
      e.id,
      pg_catalog.row_number() OVER (ORDER BY pg_catalog.random())::integer AS draw_position
    FROM public.championship_entries AS e
    WHERE e.championship_id = p_championship_id
      AND e.status = 'confirmed'
  )
  UPDATE public.championship_entries AS e
     SET group_letter = CASE
           WHEN championship_row.format = 8 THEN NULL
           ELSE pg_catalog.substr(
             'ABCD',
             (((randomized.draw_position - 1) % (championship_row.format / 4)) + 1),
             1
           )
         END,
         seed_number = randomized.draw_position
    FROM randomized
   WHERE e.id = randomized.id
     AND e.status = 'confirmed';

  GET DIAGNOSTICS assigned_count = ROW_COUNT;
  IF assigned_count <> championship_row.format THEN
    RAISE EXCEPTION 'Não foi possível atribuir todas as posições do sorteio.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format = 8 THEN
    INSERT INTO public.championship_matches (
      championship_id, stage, match_number, entry_a_id, entry_b_id
    )
    SELECT
      p_championship_id,
      'quarter_final',
      match_number,
      entry_a.id,
      entry_b.id
    FROM pg_catalog.generate_series(1, 4) AS generated(match_number)
    JOIN public.championship_entries AS entry_a
      ON entry_a.championship_id = p_championship_id
     AND entry_a.status = 'confirmed'
     AND entry_a.seed_number = (generated.match_number * 2) - 1
    JOIN public.championship_entries AS entry_b
      ON entry_b.championship_id = p_championship_id
     AND entry_b.status = 'confirmed'
     AND entry_b.seed_number = generated.match_number * 2;

    GET DIAGNOSTICS matches_count = ROW_COUNT;
    IF matches_count <> 4 THEN
      RAISE EXCEPTION 'Não foi possível preparar todos os confrontos das quartas de final.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.championships AS c
     SET status = 'drawn'
   WHERE c.id = p_championship_id;

  RETURN pg_catalog.jsonb_build_object(
    'championship_id', p_championship_id,
    'format', championship_row.format,
    'status', 'drawn',
    'entry_count', assigned_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.draw_championship(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draw_championship(uuid) TO service_role;
