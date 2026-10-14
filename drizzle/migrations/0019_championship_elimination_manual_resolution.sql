CREATE TABLE public.championship_match_resolution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.championship_matches(id) ON DELETE RESTRICT,
  original_result text NOT NULL CHECK (original_result IN ('tie', 'no_votes')),
  votes_a bigint NOT NULL CHECK (votes_a >= 0),
  votes_b bigint NOT NULL CHECK (votes_b >= 0),
  winner_entry_id uuid NOT NULL REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (original_result = 'tie' AND votes_a = votes_b AND votes_a + votes_b > 0)
    OR (original_result = 'no_votes' AND votes_a = 0 AND votes_b = 0)
  )
);
ALTER TABLE public.championship_match_resolution_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.championship_match_resolution_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_match_resolution_audit TO service_role;

CREATE OR REPLACE FUNCTION public.guard_championship_match_resolution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF tg_op <> 'INSERT' THEN
    RAISE EXCEPTION 'A auditoria da resolução é imutável.';
  END IF;
  RETURN new;
END;
$function$;
CREATE TRIGGER t_championship_match_resolution_audit_immutable
  BEFORE UPDATE OR DELETE ON public.championship_match_resolution_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_match_resolution_audit();
CREATE TRIGGER t_championship_match_resolution_audit_no_truncate
  BEFORE TRUNCATE ON public.championship_match_resolution_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_championship_match_resolution_audit();

CREATE OR REPLACE FUNCTION public.guard_championship_match_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  votes_a_count bigint;
  votes_b_count bigint;
  validate_completed_result boolean;
BEGIN
  IF new.championship_id IS DISTINCT FROM old.championship_id
     OR new.stage IS DISTINCT FROM old.stage
     OR new.match_number IS DISTINCT FROM old.match_number THEN
    RAISE EXCEPTION 'A identidade do confronto é imutável.';
  END IF;

  IF old.status IN ('completed', 'wo', 'cancelled')
     AND (new.entry_a_id IS DISTINCT FROM old.entry_a_id
       OR new.entry_b_id IS DISTINCT FROM old.entry_b_id
       OR new.performance_a_id IS DISTINCT FROM old.performance_a_id
       OR new.performance_b_id IS DISTINCT FROM old.performance_b_id
       OR new.winner_entry_id IS DISTINCT FROM old.winner_entry_id
       OR new.status IS DISTINCT FROM old.status
       OR new.voting_status IS DISTINCT FROM old.voting_status
       OR new.voting_ends_at IS DISTINCT FROM old.voting_ends_at) THEN
    RAISE EXCEPTION 'Um confronto concluído não pode ser alterado.';
  END IF;

  IF old.status <> 'scheduled'
     AND (new.entry_a_id IS DISTINCT FROM old.entry_a_id
       OR new.entry_b_id IS DISTINCT FROM old.entry_b_id
       OR new.performance_a_id IS DISTINCT FROM old.performance_a_id
       OR new.performance_b_id IS DISTINCT FROM old.performance_b_id) THEN
    RAISE EXCEPTION 'Participantes e apresentações não podem ser alterados após o início.';
  END IF;

  IF new.voting_status = 'open'
     AND (old.voting_status <> 'idle'
       OR new.status <> 'in_progress'
       OR new.voting_ends_at IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public.performances AS pa
           JOIN public.performances AS pb
             ON pb.id = new.performance_b_id
          WHERE pa.id = new.performance_a_id
            AND pa.status = 'completed'
            AND pb.status = 'completed'
       )) THEN
    RAISE EXCEPTION 'A votação só pode abrir após as apresentações A e B.';
  END IF;

  IF old.voting_status = 'open' AND new.voting_status = 'closed'
     AND new.status <> 'wo'
     AND (old.voting_ends_at IS NULL OR old.voting_ends_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'O prazo de votação ainda não terminou.';
  END IF;

  IF old.voting_status = 'closed' AND new.voting_status <> 'closed' THEN
    RAISE EXCEPTION 'A votação encerrada não pode ser reaberta.';
  END IF;

  validate_completed_result :=
    new.status = 'completed'
    AND (
      old.status IS DISTINCT FROM 'completed'
      OR new.winner_entry_id IS DISTINCT FROM old.winner_entry_id
    );

  IF validate_completed_result THEN
    IF old.status <> 'in_progress'
       OR new.winner_entry_id IS NULL
       OR new.voting_status <> 'closed' THEN
      RAISE EXCEPTION 'Somente um confronto em andamento com votação fechada e vencedor pode ser concluído.';
    END IF;

    SELECT count(*) FILTER (WHERE v.chosen_entry_id = new.entry_a_id),
           count(*) FILTER (WHERE v.chosen_entry_id = new.entry_b_id)
      INTO votes_a_count, votes_b_count
      FROM public.championship_match_votes AS v
     WHERE v.match_id = new.id;

    IF votes_a_count > votes_b_count AND new.winner_entry_id = new.entry_a_id THEN
      NULL;
    ELSIF votes_b_count > votes_a_count AND new.winner_entry_id = new.entry_b_id THEN
      NULL;
    ELSIF EXISTS (
      SELECT 1
        FROM public.championship_match_resolution_audit AS ra
        JOIN public.championship_entries AS winner_entry
          ON winner_entry.id = ra.winner_entry_id
       WHERE ra.match_id = new.id
         AND ra.winner_entry_id = new.winner_entry_id
         AND ra.winner_entry_id IN (new.entry_a_id, new.entry_b_id)
         AND winner_entry.championship_id = new.championship_id
         AND ra.votes_a = votes_a_count
         AND ra.votes_b = votes_b_count
         AND (
           (ra.original_result = 'tie'
             AND votes_a_count = votes_b_count
             AND votes_a_count + votes_b_count > 0)
           OR (ra.original_result = 'no_votes'
             AND votes_a_count = 0
             AND votes_b_count = 0)
         )
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'O vencedor não corresponde à votação nem a uma resolução auditada válida.';
    END IF;
  ELSIF new.winner_entry_id IS DISTINCT FROM old.winner_entry_id THEN
    IF new.status = 'wo' AND EXISTS (
      SELECT 1
        FROM public.championship_match_wo_audit AS wa
       WHERE wa.match_id = new.id
         AND wa.winner_entry_id = new.winner_entry_id
         AND wa.withdrawn_entry_id IN (new.entry_a_id, new.entry_b_id)
         AND wa.winner_entry_id IN (new.entry_a_id, new.entry_b_id)
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'O vencedor só pode ser definido pela votação válida, por WO ou por resolução auditada.';
    END IF;
  END IF;

  IF new.status = 'completed'
     AND (old.status <> 'in_progress'
       OR new.winner_entry_id IS NULL
       OR new.voting_status <> 'closed') THEN
    RAISE EXCEPTION 'Somente um confronto em andamento com votação apurada pode ser concluído.';
  END IF;

  IF new.status = 'wo'
     AND (old.status NOT IN ('scheduled', 'in_progress')
       OR new.winner_entry_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public.championship_match_wo_audit AS wa
          WHERE wa.match_id = new.id
            AND wa.winner_entry_id = new.winner_entry_id
            AND wa.withdrawn_entry_id IN (new.entry_a_id, new.entry_b_id)
       )) THEN
    RAISE EXCEPTION 'O WO exige registro administrativo auditável.';
  END IF;

  IF old.status = 'scheduled' AND new.status NOT IN ('scheduled', 'in_progress', 'wo', 'cancelled') THEN
    RAISE EXCEPTION 'Transição de estado de confronto inválida.';
  END IF;
  IF old.status = 'in_progress' AND new.status NOT IN ('in_progress', 'completed', 'wo', 'cancelled') THEN
    RAISE EXCEPTION 'Transição de estado de confronto inválida.';
  END IF;

  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_championship_match_tie(
  p_match_id uuid,
  p_winner_entry_id uuid,
  p_reason text,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_championship_id uuid;
  championship_row public.championships%ROWTYPE;
  match_row public.championship_matches%ROWTYPE;
  existing_resolution public.championship_match_resolution_audit%ROWTYPE;
  votes_a bigint;
  votes_b bigint;
  original_result text;
  stage_match_count integer;
  resolved_match_count integer;
BEGIN
  SELECT m.championship_id INTO match_championship_id
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id;
  IF match_championship_id IS NULL THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT ra.* INTO existing_resolution
    FROM public.championship_match_resolution_audit AS ra
   WHERE ra.match_id = match_row.id;
  IF FOUND THEN
    IF existing_resolution.winner_entry_id <> p_winner_entry_id THEN
      RAISE EXCEPTION 'Este confronto já foi resolvido com outra decisão.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'match_id', match_row.id,
      'winner_entry_id', existing_resolution.winner_entry_id,
      'original_result', existing_resolution.original_result,
      'votes_a', existing_resolution.votes_a,
      'votes_b', existing_resolution.votes_b,
      'operator_user_id', existing_resolution.operator_user_id,
      'reason', existing_resolution.reason,
      'created_at', existing_resolution.created_at,
      'idempotent', true
    );
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Informe a justificativa da decisão.' USING ERRCODE = '22023';
  END IF;
  IF p_winner_entry_id IS DISTINCT FROM match_row.entry_a_id
     AND p_winner_entry_id IS DISTINCT FROM match_row.entry_b_id THEN
    RAISE EXCEPTION 'Escolha somente uma das inscrições deste confronto.';
  END IF;
  PERFORM 1
    FROM public.championship_entries AS e
   WHERE e.id = p_winner_entry_id
     AND e.championship_id = championship_row.id
     AND e.status = 'confirmed'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A inscrição escolhida não está elegível para avançar.';
  END IF;
  IF NOT (
    (match_row.stage = 'quarter_final' AND (
      championship_row.status = 'quarter_finals'
      OR (championship_row.status = 'drawn' AND championship_row.format = 8)
    ))
    OR (match_row.stage = 'semi_final' AND championship_row.status = 'semi_finals')
    OR (match_row.stage = 'final' AND championship_row.status = 'final')
  ) THEN
    RAISE EXCEPTION 'O confronto não pertence à fase atual ou a fase já avançou.';
  END IF;
  IF (match_row.stage = 'quarter_final' AND EXISTS (
        SELECT 1 FROM public.championship_matches AS later_match
         WHERE later_match.championship_id = championship_row.id
           AND later_match.stage = 'semi_final'
      ))
     OR (match_row.stage = 'semi_final' AND EXISTS (
        SELECT 1 FROM public.championship_matches AS later_match
         WHERE later_match.championship_id = championship_row.id
           AND later_match.stage = 'final'
      )) THEN
    RAISE EXCEPTION 'A fase seguinte já foi gerada; o resultado não pode ser alterado.';
  END IF;
  IF match_row.status <> 'in_progress'
     OR match_row.voting_status <> 'closed'
     OR match_row.winner_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'A resolução só pode ser feita após uma votação encerrada sem vencedor.';
  END IF;

  SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
         count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id)
    INTO votes_a, votes_b
    FROM public.championship_match_votes AS v
   WHERE v.match_id = match_row.id;
  IF votes_a = votes_b AND votes_a + votes_b = 0 THEN
    original_result := 'no_votes';
  ELSIF votes_a = votes_b THEN
    original_result := 'tie';
  ELSE
    RAISE EXCEPTION 'A votação tem um vencedor normal; não é permitida uma decisão administrativa.';
  END IF;

  INSERT INTO public.championship_match_resolution_audit (
    match_id, original_result, votes_a, votes_b, winner_entry_id, operator_user_id, reason
  ) VALUES (
    match_row.id, original_result, votes_a, votes_b, p_winner_entry_id,
    p_operator_user_id, btrim(p_reason)
  );

  UPDATE public.championship_matches AS m
     SET status = 'completed',
         winner_entry_id = p_winner_entry_id
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  IF match_row.stage IN ('quarter_final', 'semi_final') THEN
    SELECT count(*),
           count(*) FILTER (WHERE m.status IN ('completed', 'wo') AND m.winner_entry_id IS NOT NULL)
      INTO stage_match_count, resolved_match_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id
       AND m.stage = match_row.stage;
    IF (match_row.stage = 'quarter_final' AND stage_match_count = 4 AND resolved_match_count = 4)
       OR (match_row.stage = 'semi_final' AND stage_match_count = 2 AND resolved_match_count = 2) THEN
      PERFORM public.advance_championship_elimination(championship_row.id, p_operator_user_id);
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'match_id', match_row.id,
    'winner_entry_id', p_winner_entry_id,
    'original_result', original_result,
    'votes_a', votes_a,
    'votes_b', votes_b,
    'operator_user_id', p_operator_user_id,
    'reason', btrim(p_reason),
    'created_at', (
      SELECT ra.created_at
        FROM public.championship_match_resolution_audit AS ra
       WHERE ra.match_id = match_row.id
    ),
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_championship_match_tie(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_championship_match_tie(uuid, uuid, text, uuid)
  TO service_role;
