REVOKE ALL ON public.championship_match_resolution_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_match_resolution_audit TO service_role;

REVOKE ALL ON public.championship_match_wo_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_match_wo_audit TO service_role;

REVOKE ALL ON public.championship_match_votes
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_match_votes TO service_role;

REVOKE ALL ON public.championship_group_stage_tie_decisions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_group_stage_tie_decisions TO service_role;

CREATE OR REPLACE FUNCTION public.guard_championship_group_stage_tie_decision_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  championship_row public.championships%ROWTYPE;
  tied_set uuid[];
  chosen_set uuid[];
  entry_count integer;
BEGIN
  IF tg_op <> 'INSERT' THEN
    RAISE EXCEPTION 'As decisões de desempate da fase de grupos são imutáveis.';
  END IF;

  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = new.championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF championship_row.status NOT IN ('group_stage', 'group_stage_completed')
     OR championship_row.format NOT IN (12, 16)
     OR new.operator_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.venue_operators AS vo
        WHERE vo.venue_id = championship_row.venue_id
          AND vo.user_id = new.operator_user_id
          AND vo.role IN ('owner', 'operator')
     ) THEN
    RAISE EXCEPTION 'A decisão não pertence a um Campeonato ou operador elegível.';
  END IF;

  IF new.group_letter IS NOT NULL
     AND new.group_letter NOT IN ('A', 'B', 'C', 'D') THEN
    RAISE EXCEPTION 'O grupo informado é inválido.';
  END IF;
  IF new.tied_entry_ids IS NULL
     OR cardinality(new.tied_entry_ids) < 2
     OR new.chosen_order IS NULL
     OR cardinality(new.chosen_order) <> cardinality(new.tied_entry_ids)
     OR array_position(new.tied_entry_ids, NULL::uuid) IS NOT NULL
     OR array_position(new.chosen_order, NULL::uuid) IS NOT NULL
     OR new.criteria_applied IS NULL
     OR cardinality(new.criteria_applied) < 3
     OR array_position(new.criteria_applied, 'approval') IS NULL
     OR array_position(new.criteria_applied, 'likes') IS NULL
     OR array_position(new.criteria_applied, 'dislikes') IS NULL
     OR array_position(new.criteria_applied, 'approval') > array_position(new.criteria_applied, 'likes')
     OR array_position(new.criteria_applied, 'likes') > array_position(new.criteria_applied, 'dislikes') THEN
    RAISE EXCEPTION 'A decisão de desempate não contém os participantes e critérios exigidos.';
  END IF;

  SELECT array_agg(DISTINCT item ORDER BY item)
    INTO tied_set
    FROM unnest(new.tied_entry_ids) AS item;
  SELECT array_agg(DISTINCT item ORDER BY item)
    INTO chosen_set
    FROM unnest(new.chosen_order) AS item;
  IF cardinality(tied_set) <> cardinality(new.tied_entry_ids)
     OR cardinality(chosen_set) <> cardinality(new.chosen_order)
     OR tied_set <> chosen_set THEN
    RAISE EXCEPTION 'A ordem escolhida deve conter cada participante empatado exatamente uma vez.';
  END IF;

  SELECT count(*)
    INTO entry_count
    FROM unnest(new.tied_entry_ids) AS item
    JOIN public.championship_entries AS e ON e.id = item
   WHERE e.championship_id = new.championship_id
     AND e.status = 'confirmed'
     AND (new.group_letter IS NULL OR e.group_letter = new.group_letter);
  IF entry_count <> cardinality(new.tied_entry_ids) THEN
    RAISE EXCEPTION 'Os participantes informados não pertencem ao conjunto elegível.';
  END IF;

  RETURN new;
END;
$function$;

CREATE TRIGGER t_championship_group_stage_tie_decisions_validate_insert
  BEFORE INSERT ON public.championship_group_stage_tie_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_group_stage_tie_decision_insert();
CREATE TRIGGER t_championship_group_stage_tie_decisions_no_truncate
  BEFORE TRUNCATE ON public.championship_group_stage_tie_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_championship_group_stage_tie_decision_insert();
REVOKE ALL ON FUNCTION public.guard_championship_group_stage_tie_decision_insert()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_confirmed_championship_resolution_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
BEGIN
  SELECT m.*
    INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = new.match_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
      FROM public.championship_entries AS entry_a
      JOIN public.championship_entries AS entry_b
        ON entry_b.id = match_row.entry_b_id
     WHERE entry_a.id = match_row.entry_a_id
       AND entry_a.championship_id = match_row.championship_id
       AND entry_b.championship_id = match_row.championship_id
       AND entry_a.status = 'confirmed'
       AND entry_b.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Uma resolução de votação exige dois participantes confirmados; use a operação de WO para desistências.';
  END IF;
  RETURN new;
END;
$function$;

CREATE TRIGGER t_championship_match_resolution_audit_confirmed_participants
  BEFORE INSERT ON public.championship_match_resolution_audit
  FOR EACH ROW EXECUTE FUNCTION public.require_confirmed_championship_resolution_participants();
REVOKE ALL ON FUNCTION public.require_confirmed_championship_resolution_participants()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.championship_match_result_is_valid(
  p_match public.championship_matches
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  votes_a_count bigint;
  votes_b_count bigint;
  votes_total bigint;
  resolution_row public.championship_match_resolution_audit%ROWTYPE;
  wo_row public.championship_match_wo_audit%ROWTYPE;
BEGIN
  IF p_match.id IS NULL
     OR p_match.entry_a_id IS NULL
     OR p_match.entry_b_id IS NULL
     OR p_match.entry_a_id = p_match.entry_b_id
     OR p_match.winner_entry_id IS NULL
     OR p_match.winner_entry_id NOT IN (p_match.entry_a_id, p_match.entry_b_id)
     OR p_match.voting_status <> 'closed'
     OR NOT EXISTS (
       SELECT 1
         FROM public.championship_entries AS entry_a
         JOIN public.championship_entries AS entry_b
           ON entry_b.id = p_match.entry_b_id
         JOIN public.championship_entries AS winner
           ON winner.id = p_match.winner_entry_id
        WHERE entry_a.id = p_match.entry_a_id
          AND entry_a.championship_id = p_match.championship_id
          AND entry_b.championship_id = p_match.championship_id
          AND winner.championship_id = p_match.championship_id
          AND winner.status = 'confirmed'
     ) THEN
    RETURN false;
  END IF;

  IF p_match.status = 'wo' THEN
    SELECT wa.*
      INTO wo_row
      FROM public.championship_match_wo_audit AS wa
      JOIN public.championship_entries AS withdrawn
        ON withdrawn.id = wa.withdrawn_entry_id
      JOIN public.championship_entries AS winner
        ON winner.id = wa.winner_entry_id
     WHERE wa.match_id = p_match.id
       AND wa.winner_entry_id = p_match.winner_entry_id
       AND wa.withdrawn_entry_id = CASE
         WHEN p_match.winner_entry_id = p_match.entry_a_id THEN p_match.entry_b_id
         ELSE p_match.entry_a_id
       END
       AND withdrawn.championship_id = p_match.championship_id
       AND withdrawn.status IN ('withdrawn', 'disqualified')
       AND winner.championship_id = p_match.championship_id
       AND winner.status = 'confirmed'
       AND length(btrim(wa.reason)) BETWEEN 1 AND 1000;
    RETURN FOUND;
  END IF;

  IF p_match.status <> 'completed' THEN
    RETURN false;
  END IF;

  SELECT count(*) FILTER (WHERE v.chosen_entry_id = p_match.entry_a_id),
         count(*) FILTER (WHERE v.chosen_entry_id = p_match.entry_b_id),
         count(*)
    INTO votes_a_count, votes_b_count, votes_total
    FROM public.championship_match_votes AS v
   WHERE v.match_id = p_match.id;

  IF votes_total <> votes_a_count + votes_b_count THEN
    RETURN false;
  END IF;

  IF votes_a_count > votes_b_count THEN
    RETURN p_match.winner_entry_id = p_match.entry_a_id
       AND NOT EXISTS (
         SELECT 1 FROM public.championship_match_resolution_audit AS ra
          WHERE ra.match_id = p_match.id
       );
  ELSIF votes_b_count > votes_a_count THEN
    RETURN p_match.winner_entry_id = p_match.entry_b_id
       AND NOT EXISTS (
         SELECT 1 FROM public.championship_match_resolution_audit AS ra
          WHERE ra.match_id = p_match.id
       );
  END IF;

  SELECT ra.*
    INTO resolution_row
    FROM public.championship_match_resolution_audit AS ra
   WHERE ra.match_id = p_match.id
     AND ra.winner_entry_id = p_match.winner_entry_id
     AND ra.winner_entry_id IN (p_match.entry_a_id, p_match.entry_b_id)
     AND ra.votes_a = votes_a_count
     AND ra.votes_b = votes_b_count
     AND length(btrim(ra.reason)) BETWEEN 1 AND 1000
     AND (
       (ra.original_result = 'tie'
         AND votes_a_count = votes_b_count
         AND votes_a_count + votes_b_count > 0)
       OR (ra.original_result = 'no_votes'
         AND votes_a_count = 0
         AND votes_b_count = 0)
     );
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.championship_match_result_is_valid(public.championship_matches)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.championship_elimination_bracket_is_valid(
  p_championship_id uuid,
  p_through_stage text,
  p_require_final_result boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_count integer;
  distinct_entry_count integer;
  championship_format integer;
  final_match public.championship_matches%ROWTYPE;
BEGIN
  IF p_championship_id IS NULL
     OR p_through_stage IS NULL
     OR p_through_stage NOT IN ('quarter_final', 'semi_final', 'final') THEN
    RETURN false;
  END IF;

  SELECT c.format
    INTO championship_format
    FROM public.championships AS c
   WHERE c.id = p_championship_id;
  IF NOT FOUND OR championship_format NOT IN (8, 12, 16) THEN
    RETURN false;
  END IF;

  SELECT count(*)
    INTO match_count
    FROM public.championship_matches AS m
   WHERE m.championship_id = p_championship_id
     AND m.stage = 'quarter_final';
  IF match_count <> 4 OR EXISTS (
    SELECT 1
      FROM pg_catalog.generate_series(1, 4) AS expected(match_number)
      LEFT JOIN public.championship_matches AS m
        ON m.championship_id = p_championship_id
       AND m.stage = 'quarter_final'
       AND m.match_number = expected.match_number
     WHERE m.id IS NULL
        OR NOT public.championship_match_result_is_valid(m)
  ) THEN
    RETURN false;
  END IF;

  SELECT count(DISTINCT entry_id)
    INTO distinct_entry_count
    FROM (
      SELECT m.entry_a_id AS entry_id
        FROM public.championship_matches AS m
       WHERE m.championship_id = p_championship_id
         AND m.stage = 'quarter_final'
      UNION ALL
      SELECT m.entry_b_id
        FROM public.championship_matches AS m
       WHERE m.championship_id = p_championship_id
         AND m.stage = 'quarter_final'
    ) AS participants;
  IF distinct_entry_count <> 8 THEN
    RETURN false;
  END IF;

  IF championship_format = 8 AND EXISTS (
    SELECT 1
      FROM (VALUES (1), (2), (3), (4)) AS expected(match_number)
      JOIN public.championship_matches AS m
        ON m.championship_id = p_championship_id
       AND m.stage = 'quarter_final'
       AND m.match_number = expected.match_number
      JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
      JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
     WHERE entry_a.championship_id <> p_championship_id
        OR entry_b.championship_id <> p_championship_id
        OR entry_a.seed_number IS DISTINCT FROM (expected.match_number * 2) - 1
        OR entry_b.seed_number IS DISTINCT FROM expected.match_number * 2
  ) THEN
    RETURN false;
  ELSIF championship_format = 16 AND EXISTS (
    SELECT 1
      FROM (VALUES (1, 1, 6), (2, 2, 5), (3, 3, 8), (4, 4, 7))
        AS expected(match_number, seed_a, seed_b)
      JOIN public.championship_matches AS m
        ON m.championship_id = p_championship_id
       AND m.stage = 'quarter_final'
       AND m.match_number = expected.match_number
      JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
      JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
     WHERE entry_a.championship_id <> p_championship_id
        OR entry_b.championship_id <> p_championship_id
        OR entry_a.seed_number IS DISTINCT FROM expected.seed_a
        OR entry_b.seed_number IS DISTINCT FROM expected.seed_b
  ) THEN
    RETURN false;
  ELSIF championship_format = 12 AND (
    NOT EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
        JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
        JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
       WHERE m.championship_id = p_championship_id
         AND m.stage = 'quarter_final'
         AND m.match_number = 1
         AND entry_a.championship_id = p_championship_id
         AND entry_b.championship_id = p_championship_id
         AND entry_a.seed_number = 1
         AND entry_b.seed_number = 5
    )
    OR NOT EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
        JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
        JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
       WHERE m.championship_id = p_championship_id
         AND m.stage = 'quarter_final'
         AND m.match_number = 2
         AND entry_a.championship_id = p_championship_id
         AND entry_b.championship_id = p_championship_id
         AND entry_a.seed_number = 2
         AND entry_b.seed_number = 4
    )
    OR NOT EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
        JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
        JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
       WHERE m.championship_id = p_championship_id
         AND m.stage = 'quarter_final'
         AND m.match_number = 3
         AND entry_a.championship_id = p_championship_id
         AND entry_b.championship_id = p_championship_id
         AND entry_a.seed_number = 3
         AND entry_b.seed_number IN (7, 8, 9)
    )
    OR NOT EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
        JOIN public.championship_matches AS third_match
          ON third_match.championship_id = p_championship_id
         AND third_match.stage = 'quarter_final'
         AND third_match.match_number = 3
        JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
        JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
       WHERE m.championship_id = p_championship_id
         AND m.stage = 'quarter_final'
         AND m.match_number = 4
         AND entry_a.championship_id = p_championship_id
         AND entry_b.championship_id = p_championship_id
         AND entry_a.seed_number IN (7, 8, 9)
         AND entry_a.id IS DISTINCT FROM third_match.entry_b_id
         AND entry_b.seed_number = 6
    )
  ) THEN
    RETURN false;
  END IF;

  IF p_through_stage = 'quarter_final' THEN
    RETURN true;
  END IF;

  SELECT count(*)
    INTO match_count
    FROM public.championship_matches AS m
   WHERE m.championship_id = p_championship_id
     AND m.stage = 'semi_final';
  IF match_count <> 2 OR EXISTS (
    SELECT 1
      FROM (VALUES (1), (2)) AS expected(match_number)
      LEFT JOIN public.championship_matches AS semi
        ON semi.championship_id = p_championship_id
       AND semi.stage = 'semi_final'
       AND semi.match_number = expected.match_number
      LEFT JOIN public.championship_matches AS q1
        ON q1.championship_id = p_championship_id
       AND q1.stage = 'quarter_final'
       AND q1.match_number = CASE expected.match_number WHEN 1 THEN 1 ELSE 3 END
      LEFT JOIN public.championship_matches AS q2
        ON q2.championship_id = p_championship_id
       AND q2.stage = 'quarter_final'
       AND q2.match_number = CASE expected.match_number WHEN 1 THEN 2 ELSE 4 END
     WHERE semi.id IS NULL
        OR semi.entry_a_id IS DISTINCT FROM q1.winner_entry_id
        OR semi.entry_b_id IS DISTINCT FROM q2.winner_entry_id
        OR semi.entry_a_id IS NULL
        OR semi.entry_b_id IS NULL
        OR semi.entry_a_id = semi.entry_b_id
  ) THEN
    RETURN false;
  END IF;

  IF p_through_stage = 'semi_final' THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES (1), (2)) AS expected(match_number)
      LEFT JOIN public.championship_matches AS semi
        ON semi.championship_id = p_championship_id
       AND semi.stage = 'semi_final'
       AND semi.match_number = expected.match_number
     WHERE semi.id IS NULL
        OR NOT public.championship_match_result_is_valid(semi)
  ) THEN
    RETURN false;
  END IF;

  SELECT count(*)
    INTO match_count
    FROM public.championship_matches AS m
   WHERE m.championship_id = p_championship_id
     AND m.stage = 'final';
  IF match_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM public.championship_matches AS final_match
      JOIN public.championship_matches AS semi1
        ON semi1.championship_id = p_championship_id
       AND semi1.stage = 'semi_final'
       AND semi1.match_number = 1
      JOIN public.championship_matches AS semi2
        ON semi2.championship_id = p_championship_id
       AND semi2.stage = 'semi_final'
       AND semi2.match_number = 2
     WHERE final_match.championship_id = p_championship_id
       AND final_match.stage = 'final'
       AND final_match.match_number = 1
       AND final_match.entry_a_id = semi1.winner_entry_id
       AND final_match.entry_b_id = semi2.winner_entry_id
       AND final_match.entry_a_id IS NOT NULL
       AND final_match.entry_b_id IS NOT NULL
       AND final_match.entry_a_id <> final_match.entry_b_id
  ) THEN
    RETURN false;
  END IF;

  IF p_require_final_result THEN
    SELECT m.*
      INTO final_match
      FROM public.championship_matches AS m
     WHERE m.championship_id = p_championship_id
       AND m.stage = 'final'
       AND m.match_number = 1;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    RETURN public.championship_match_result_is_valid(final_match);
  END IF;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.championship_elimination_bracket_is_valid(uuid, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_championship_match_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
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

  IF new.entry_a_id IS DISTINCT FROM old.entry_a_id
     OR new.entry_b_id IS DISTINCT FROM old.entry_b_id THEN
    RAISE EXCEPTION 'Os participantes de um confronto são imutáveis após sua criação.';
  END IF;

  IF old.status <> 'scheduled'
     AND (new.performance_a_id IS DISTINCT FROM old.performance_a_id
       OR new.performance_b_id IS DISTINCT FROM old.performance_b_id) THEN
    RAISE EXCEPTION 'As apresentações não podem ser alteradas após o início.';
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

  IF new.status = 'completed' THEN
    IF old.status NOT IN ('in_progress', 'completed')
       OR new.voting_status <> 'closed'
       OR NOT public.championship_match_result_is_valid(new) THEN
      RAISE EXCEPTION 'O resultado concluído não corresponde a uma votação ou resolução auditada válida.';
    END IF;
  ELSIF new.status = 'wo' THEN
    IF old.status NOT IN ('scheduled', 'in_progress', 'wo')
       OR new.voting_status <> 'closed'
       OR NOT public.championship_match_result_is_valid(new) THEN
      RAISE EXCEPTION 'O WO exige uma auditoria compatível com o confronto e inscrições elegíveis.';
    END IF;
  ELSIF new.winner_entry_id IS DISTINCT FROM old.winner_entry_id THEN
    RAISE EXCEPTION 'O vencedor só pode ser definido por votação válida, resolução auditada ou WO.';
  END IF;

  IF old.status = 'scheduled'
     AND new.status NOT IN ('scheduled', 'in_progress', 'wo', 'cancelled') THEN
    RAISE EXCEPTION 'Transição de estado de confronto inválida.';
  END IF;
  IF old.status = 'in_progress'
     AND new.status NOT IN ('in_progress', 'completed', 'wo', 'cancelled') THEN
    RAISE EXCEPTION 'Transição de estado de confronto inválida.';
  END IF;

  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_championship_match_wo_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  withdrawn_entry public.championship_entries%ROWTYPE;
  winner_entry public.championship_entries%ROWTYPE;
BEGIN
  IF tg_op <> 'INSERT' THEN
    RAISE EXCEPTION 'A auditoria de WO é imutável.';
  END IF;

  SELECT m.*
    INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = new.match_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, new.operator_user_id);

  SELECT e.*
    INTO withdrawn_entry
    FROM public.championship_entries AS e
   WHERE e.id = new.withdrawn_entry_id
   FOR SHARE;
  SELECT e.*
    INTO winner_entry
    FROM public.championship_entries AS e
   WHERE e.id = new.winner_entry_id
   FOR SHARE;

  IF match_row.status NOT IN ('scheduled', 'in_progress')
     OR match_row.entry_a_id IS NULL
     OR match_row.entry_b_id IS NULL
     OR match_row.entry_a_id = match_row.entry_b_id
     OR new.withdrawn_entry_id NOT IN (match_row.entry_a_id, match_row.entry_b_id)
     OR new.winner_entry_id NOT IN (match_row.entry_a_id, match_row.entry_b_id)
     OR new.withdrawn_entry_id = new.winner_entry_id
     OR withdrawn_entry.id IS NULL
     OR withdrawn_entry.championship_id <> match_row.championship_id
     OR withdrawn_entry.status NOT IN ('withdrawn', 'disqualified')
     OR winner_entry.id IS NULL
     OR winner_entry.championship_id <> match_row.championship_id
     OR winner_entry.status <> 'confirmed'
     OR length(btrim(new.reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'A auditoria de WO não corresponde a desistência e vencedor elegíveis.';
  END IF;

  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_championship_match_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_championship_match_wo_audit()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_championship_match_vote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  chosen_entry public.championship_entries%ROWTYPE;
  voter_championship_id uuid;
  accepted_at timestamptz;
BEGIN
  SELECT m.*
    INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = new.match_id
   FOR SHARE;
  IF NOT FOUND
     OR match_row.status <> 'in_progress'
     OR match_row.voting_status <> 'open'
     OR match_row.voting_ends_at IS NULL
     OR match_row.voting_ends_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'A votação deste confronto está encerrada.' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.*
    INTO chosen_entry
    FROM public.championship_entries AS e
   WHERE e.id = new.chosen_entry_id
     AND e.championship_id = match_row.championship_id
     AND e.status = 'confirmed'
   FOR SHARE;
  IF NOT FOUND
     OR (new.chosen_entry_id IS DISTINCT FROM match_row.entry_a_id
       AND new.chosen_entry_id IS DISTINCT FROM match_row.entry_b_id) THEN
    RAISE EXCEPTION 'A inscrição escolhida não pertence ao confronto ou não está elegível.';
  END IF;

  SELECT s.championship_id
    INTO voter_championship_id
    FROM public.voter_sessions AS vs
    JOIN public.sessions AS s ON s.id = vs.session_id
   WHERE vs.id = new.voter_session_id
     AND s.status = 'active';
  IF voter_championship_id IS DISTINCT FROM match_row.championship_id THEN
    RAISE EXCEPTION 'A sessão votante ativa não pertence a este Campeonato.';
  END IF;

  accepted_at := clock_timestamp();
  IF match_row.voting_ends_at <= accepted_at THEN
    RAISE EXCEPTION 'O prazo da votação expirou antes do registro do voto.' USING ERRCODE = 'P0001';
  END IF;
  new.created_at := accepted_at;
  RETURN new;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_championship_match_vote()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_championship_match_voting(
  p_match_id uuid,
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
BEGIN
  SELECT m.championship_id
    INTO match_championship_id
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id;
  IF match_championship_id IS NULL THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = match_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  SELECT m.*
    INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
     AND m.championship_id = championship_row.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF match_row.status <> 'in_progress'
     OR match_row.voting_status <> 'idle'
     OR NOT (
       (match_row.stage = 'quarter_final' AND (
         championship_row.status = 'quarter_finals'
         OR (championship_row.status = 'drawn' AND championship_row.format = 8)
       ))
       OR (match_row.stage = 'semi_final' AND championship_row.status = 'semi_finals')
       OR (match_row.stage = 'final' AND championship_row.status = 'final')
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public.performances AS pa
         JOIN public.performances AS pb ON pb.id = match_row.performance_b_id
         JOIN public.championship_entries AS entry_a
           ON entry_a.id = match_row.entry_a_id
         JOIN public.championship_entries AS entry_b
           ON entry_b.id = match_row.entry_b_id
        WHERE pa.id = match_row.performance_a_id
          AND pa.status = 'completed'
          AND pb.status = 'completed'
          AND entry_a.championship_id = championship_row.id
          AND entry_a.status = 'confirmed'
          AND entry_b.championship_id = championship_row.id
          AND entry_b.status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'A votação só pode ser aberta uma vez após as duas apresentações válidas.';
  END IF;

  UPDATE public.championship_matches AS m
     SET voting_status = 'open',
         voting_ends_at = clock_timestamp() + interval '30 seconds'
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  RETURN pg_catalog.jsonb_build_object(
    'match_id', match_row.id,
    'voting_status', match_row.voting_status,
    'voting_ends_at', match_row.voting_ends_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_championship_match_voting(
  p_match_id uuid,
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
  votes_a bigint;
  votes_b bigint;
  votes_total bigint;
  winner_id uuid;
  result_name text;
BEGIN
  SELECT m.championship_id
    INTO match_championship_id
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id;
  IF match_championship_id IS NULL THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = match_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  SELECT m.*
    INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
     AND m.championship_id = championship_row.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF match_row.voting_status = 'closed' THEN
    SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
           count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id),
           count(*)
      INTO votes_a, votes_b, votes_total
      FROM public.championship_match_votes AS v
     WHERE v.match_id = match_row.id;
    IF votes_total <> votes_a + votes_b THEN
      RAISE EXCEPTION 'A votação contém votos que não pertencem aos participantes.';
    END IF;
    IF match_row.winner_entry_id IS NOT NULL THEN
      IF match_row.status NOT IN ('completed', 'wo')
         OR NOT public.championship_match_result_is_valid(match_row) THEN
        RAISE EXCEPTION 'O resultado já encerrado não é válido.';
      END IF;
      result_name := 'winner';
    ELSE
      IF match_row.status <> 'in_progress' OR votes_a <> votes_b THEN
        RAISE EXCEPTION 'A votação encerrada não possui um estado válido.';
      END IF;
      result_name := CASE WHEN votes_total = 0 THEN 'no_votes' ELSE 'tie' END;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'match_id', match_row.id,
      'voting_status', 'closed',
      'votes_a', votes_a,
      'votes_b', votes_b,
      'result', result_name,
      'winner_entry_id', match_row.winner_entry_id
    );
  END IF;

  IF match_row.status <> 'in_progress' OR match_row.voting_status <> 'open' THEN
    RAISE EXCEPTION 'Não há votação aberta para encerrar.';
  END IF;
  IF match_row.voting_ends_at IS NULL OR match_row.voting_ends_at > clock_timestamp() THEN
    RAISE EXCEPTION 'A votação só pode ser encerrada após o prazo definido pelo servidor.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.championship_entries AS entry_a
      JOIN public.championship_entries AS entry_b
        ON entry_b.id = match_row.entry_b_id
     WHERE entry_a.id = match_row.entry_a_id
       AND entry_a.championship_id = match_row.championship_id
       AND entry_b.championship_id = match_row.championship_id
       AND entry_a.status = 'confirmed'
       AND entry_b.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'Um participante não está mais confirmado; registre o WO em vez de apurar os votos.';
  END IF;

  SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
         count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id),
         count(*)
    INTO votes_a, votes_b, votes_total
    FROM public.championship_match_votes AS v
   WHERE v.match_id = match_row.id;
  IF votes_total <> votes_a + votes_b THEN
    RAISE EXCEPTION 'A votação contém votos que não pertencem aos participantes.';
  END IF;

  IF votes_a > votes_b THEN
    winner_id := match_row.entry_a_id;
  ELSIF votes_b > votes_a THEN
    winner_id := match_row.entry_b_id;
  END IF;

  IF winner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.championship_entries AS e
     WHERE e.id = winner_id
       AND e.championship_id = match_row.championship_id
       AND e.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'A inscrição vencedora foi retirada ou desqualificada; registre o WO auditável.';
  END IF;

  UPDATE public.championship_matches AS m
     SET voting_status = 'closed',
         status = CASE WHEN winner_id IS NULL THEN 'in_progress' ELSE 'completed' END,
         winner_entry_id = winner_id
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  result_name := CASE
    WHEN winner_id IS NOT NULL THEN 'winner'
    WHEN votes_total = 0 THEN 'no_votes'
    ELSE 'tie'
  END;
  RETURN pg_catalog.jsonb_build_object(
    'match_id', match_row.id,
    'voting_status', match_row.voting_status,
    'votes_a', votes_a,
    'votes_b', votes_b,
    'result', result_name,
    'winner_entry_id', winner_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_championship_elimination(
  p_championship_id uuid,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  championship_row public.championships%ROWTYPE;
  resolved_match_count integer;
BEGIN
  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  IF championship_row.status = 'quarter_finals'
     OR (championship_row.status = 'drawn' AND championship_row.format = 8) THEN
    IF NOT public.championship_elimination_bracket_is_valid(
      championship_row.id, 'quarter_final', false
    ) THEN
      RAISE EXCEPTION 'As quatro quartas precisam ter resultados válidos e participantes distintos.';
    END IF;

    INSERT INTO public.championship_matches (
      championship_id, stage, match_number, entry_a_id, entry_b_id
    )
    SELECT championship_row.id,
           'semi_final',
           expected.match_number,
           CASE expected.match_number WHEN 1 THEN q1.winner_entry_id ELSE q3.winner_entry_id END,
           CASE expected.match_number WHEN 1 THEN q2.winner_entry_id ELSE q4.winner_entry_id END
      FROM (VALUES (1), (2)) AS expected(match_number)
      JOIN public.championship_matches AS q1
        ON q1.championship_id = championship_row.id
       AND q1.stage = 'quarter_final'
       AND q1.match_number = 1
      JOIN public.championship_matches AS q2
        ON q2.championship_id = championship_row.id
       AND q2.stage = 'quarter_final'
       AND q2.match_number = 2
      JOIN public.championship_matches AS q3
        ON q3.championship_id = championship_row.id
       AND q3.stage = 'quarter_final'
       AND q3.match_number = 3
      JOIN public.championship_matches AS q4
        ON q4.championship_id = championship_row.id
       AND q4.stage = 'quarter_final'
       AND q4.match_number = 4
    ON CONFLICT (championship_id, stage, match_number) DO NOTHING;

    IF NOT public.championship_elimination_bracket_is_valid(
      championship_row.id, 'semi_final', false
    ) THEN
      RAISE EXCEPTION 'O chaveamento das semifinais não corresponde às vencedoras das quartas.';
    END IF;

    UPDATE public.championships AS c
       SET status = 'semi_finals'
     WHERE c.id = championship_row.id;
    RETURN pg_catalog.jsonb_build_object(
      'championship_id', championship_row.id,
      'status', 'semi_finals',
      'matches_generated', 2
    );
  END IF;

  IF championship_row.status = 'semi_finals' THEN
    IF NOT public.championship_elimination_bracket_is_valid(
      championship_row.id, 'semi_final', false
    ) THEN
      RAISE EXCEPTION 'O chaveamento das semifinais não corresponde aos resultados das quartas.';
    END IF;

    SELECT count(*) FILTER (
             WHERE public.championship_match_result_is_valid(m)
           )
      INTO resolved_match_count
      FROM (VALUES (1), (2)) AS expected(match_number)
      LEFT JOIN public.championship_matches AS m
        ON m.championship_id = championship_row.id
       AND m.stage = 'semi_final'
       AND m.match_number = expected.match_number;
    IF resolved_match_count <> 2 THEN
      RETURN pg_catalog.jsonb_build_object(
        'championship_id', championship_row.id,
        'status', 'semi_finals',
        'matches_generated', 0
      );
    END IF;

    INSERT INTO public.championship_matches (
      championship_id, stage, match_number, entry_a_id, entry_b_id
    )
    SELECT championship_row.id, 'final', 1,
           semi1.winner_entry_id, semi2.winner_entry_id
      FROM public.championship_matches AS semi1
      JOIN public.championship_matches AS semi2
        ON semi2.championship_id = semi1.championship_id
       AND semi2.stage = 'semi_final'
       AND semi2.match_number = 2
     WHERE semi1.championship_id = championship_row.id
       AND semi1.stage = 'semi_final'
       AND semi1.match_number = 1
    ON CONFLICT (championship_id, stage, match_number) DO NOTHING;

    IF NOT public.championship_elimination_bracket_is_valid(
      championship_row.id, 'final', false
    ) THEN
      RAISE EXCEPTION 'O chaveamento da final não corresponde às vencedoras das semifinais.';
    END IF;

    UPDATE public.championships AS c
       SET status = 'final'
     WHERE c.id = championship_row.id;
    RETURN pg_catalog.jsonb_build_object(
      'championship_id', championship_row.id,
      'status', 'final',
      'matches_generated', 1
    );
  END IF;

  IF championship_row.status = 'final'
     AND public.championship_elimination_bracket_is_valid(
       championship_row.id, 'final', false
     ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'championship_id', championship_row.id,
      'status', 'final',
      'matches_generated', 0
    );
  END IF;

  RAISE EXCEPTION 'O Campeonato não está pronto para avançar para a próxima fase.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_championship_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF old.status = 'completed' AND new.status IS DISTINCT FROM old.status THEN
    RAISE EXCEPTION 'Um Campeonato concluído não pode ser reaberto.';
  END IF;

  IF new.status = 'completed'
     AND old.status IS DISTINCT FROM 'completed'
     AND (old.status <> 'final'
       OR NOT public.championship_elimination_bracket_is_valid(new.id, 'final', true)) THEN
    RAISE EXCEPTION 'O Campeonato só pode ser encerrado após um resultado válido e auditável da final.';
  END IF;

  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_championship_match_wo(
  p_match_id uuid,
  p_withdrawn_entry_id uuid,
  p_reason text,
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
  withdrawn_entry public.championship_entries%ROWTYPE;
  opposing_entry public.championship_entries%ROWTYPE;
  existing_wo public.championship_match_wo_audit%ROWTYPE;
  winner_id uuid;
BEGIN
  SELECT m.championship_id
    INTO match_championship_id
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id;
  IF match_championship_id IS NULL THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = match_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  SELECT m.*
    INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
     AND m.championship_id = championship_row.id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT wa.*
    INTO existing_wo
    FROM public.championship_match_wo_audit AS wa
   WHERE wa.match_id = match_row.id;
  IF FOUND THEN
    IF existing_wo.withdrawn_entry_id <> p_withdrawn_entry_id
       OR match_row.status <> 'wo'
       OR match_row.winner_entry_id <> existing_wo.winner_entry_id
       OR NOT public.championship_match_result_is_valid(match_row) THEN
      RAISE EXCEPTION 'Este confronto já possui uma decisão de WO conflitante ou inconsistente.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'match_id', match_row.id,
      'status', match_row.status,
      'withdrawn_entry_id', existing_wo.withdrawn_entry_id,
      'winner_entry_id', existing_wo.winner_entry_id,
      'operator_user_id', existing_wo.operator_user_id,
      'reason', existing_wo.reason,
      'created_at', existing_wo.created_at,
      'idempotent', true
    );
  END IF;

  IF match_row.status NOT IN ('scheduled', 'in_progress')
     OR match_row.winner_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Só é possível registrar WO em um confronto ainda sem resultado.';
  END IF;
  IF NOT (
    (match_row.stage = 'quarter_final' AND (
      championship_row.status = 'quarter_finals'
      OR (championship_row.status = 'drawn' AND championship_row.format = 8)
    ))
    OR (match_row.stage = 'semi_final' AND championship_row.status = 'semi_finals')
    OR (match_row.stage = 'final' AND championship_row.status = 'final')
  ) THEN
    RAISE EXCEPTION 'O confronto não pertence à fase atual do Campeonato.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Informe a justificativa do WO.' USING ERRCODE = '22023';
  END IF;

  IF p_withdrawn_entry_id = match_row.entry_a_id THEN
    SELECT e.*
      INTO withdrawn_entry
      FROM public.championship_entries AS e
     WHERE e.id = match_row.entry_a_id
     FOR UPDATE;
    SELECT e.*
      INTO opposing_entry
      FROM public.championship_entries AS e
     WHERE e.id = match_row.entry_b_id
     FOR UPDATE;
    winner_id := match_row.entry_b_id;
  ELSIF p_withdrawn_entry_id = match_row.entry_b_id THEN
    SELECT e.*
      INTO withdrawn_entry
      FROM public.championship_entries AS e
     WHERE e.id = match_row.entry_b_id
     FOR UPDATE;
    SELECT e.*
      INTO opposing_entry
      FROM public.championship_entries AS e
     WHERE e.id = match_row.entry_a_id
     FOR UPDATE;
    winner_id := match_row.entry_a_id;
  ELSE
    RAISE EXCEPTION 'A inscrição desistente precisa pertencer a este confronto.';
  END IF;

  IF withdrawn_entry.id IS NULL
     OR opposing_entry.id IS NULL
     OR withdrawn_entry.championship_id <> championship_row.id
     OR opposing_entry.championship_id <> championship_row.id
     OR withdrawn_entry.status NOT IN ('confirmed', 'withdrawn', 'disqualified')
     OR opposing_entry.status <> 'confirmed' THEN
    RAISE EXCEPTION 'A inscrição adversária não está elegível para receber o WO.';
  END IF;

  IF match_row.status = 'scheduled' AND EXISTS (
    SELECT 1
      FROM public.performances AS p
     WHERE p.id IN (match_row.performance_a_id, match_row.performance_b_id)
       AND p.status NOT IN ('queued')
  ) THEN
    RAISE EXCEPTION 'O confronto já possui apresentação iniciada; registre a desistência como WO durante o confronto.';
  END IF;

  UPDATE public.championship_entries AS e
     SET status = 'withdrawn'
   WHERE e.id = withdrawn_entry.id
     AND e.status = 'confirmed';

  UPDATE public.performances AS p
     SET status = 'completed',
         ended_at = clock_timestamp()
   WHERE p.id IN (match_row.performance_a_id, match_row.performance_b_id)
     AND p.status = 'active';

  INSERT INTO public.championship_match_wo_audit (
    match_id, withdrawn_entry_id, winner_entry_id, operator_user_id, reason
  ) VALUES (
    match_row.id, withdrawn_entry.id, winner_id, p_operator_user_id, btrim(p_reason)
  )
  RETURNING * INTO existing_wo;

  UPDATE public.championship_matches AS m
     SET status = 'wo',
         voting_status = 'closed',
         winner_entry_id = winner_id
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  IF championship_row.status = 'drawn' THEN
    UPDATE public.championships AS c
       SET status = 'quarter_finals'
     WHERE c.id = championship_row.id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'match_id', match_row.id,
    'status', match_row.status,
    'withdrawn_entry_id', existing_wo.withdrawn_entry_id,
    'winner_entry_id', existing_wo.winner_entry_id,
    'operator_user_id', existing_wo.operator_user_id,
    'reason', existing_wo.reason,
    'created_at', existing_wo.created_at,
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_championship(
  p_championship_id uuid,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  championship_row public.championships%ROWTYPE;
  final_match public.championship_matches%ROWTYPE;
BEGIN
  SELECT c.*
    INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  IF championship_row.status NOT IN ('final', 'completed') THEN
    RAISE EXCEPTION 'O Campeonato só pode ser encerrado após a final.';
  END IF;
  IF NOT public.championship_elimination_bracket_is_valid(
    championship_row.id, 'final', true
  ) THEN
    RAISE EXCEPTION 'O chaveamento e o resultado da final precisam ser válidos e auditáveis.';
  END IF;

  SELECT m.*
    INTO final_match
    FROM public.championship_matches AS m
   WHERE m.championship_id = championship_row.id
     AND m.stage = 'final'
     AND m.match_number = 1
   FOR UPDATE;
  IF NOT FOUND
     OR final_match.status NOT IN ('completed', 'wo')
     OR NOT public.championship_match_result_is_valid(final_match) THEN
    RAISE EXCEPTION 'A final ainda não possui um resultado válido.';
  END IF;

  IF championship_row.status <> 'completed' THEN
    UPDATE public.championships AS c
       SET status = 'completed'
     WHERE c.id = championship_row.id
     RETURNING c.* INTO championship_row;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'championship_id', championship_row.id,
    'status', championship_row.status,
    'winner_entry_id', final_match.winner_entry_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_championship_elimination(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_championship_elimination(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.open_championship_match_voting(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_championship_match_voting(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.close_championship_match_voting(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_championship_match_voting(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.record_championship_match_wo(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_championship_match_wo(uuid, uuid, text, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.complete_championship(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_championship(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.guard_championship_completion()
  FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
  caller record;
BEGIN
  FOR caller IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(p.proowner) AS role_name
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid IN (
       'public.championship_elimination_bracket_is_valid(uuid,text,boolean)'::regprocedure,
       'public.guard_championship_match_lifecycle()'::regprocedure,
       'public.close_championship_match_voting(uuid,uuid)'::regprocedure,
       'public.advance_championship_elimination(uuid,uuid)'::regprocedure,
       'public.record_championship_match_wo(uuid,uuid,text,uuid)'::regprocedure,
       'public.guard_championship_completion()'::regprocedure,
       'public.complete_championship(uuid,uuid)'::regprocedure
     )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.championship_match_result_is_valid(public.championship_matches) TO %I',
      caller.role_name
    );
  END LOOP;

  FOR caller IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(p.proowner) AS role_name
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid IN (
       'public.guard_championship_completion()'::regprocedure,
       'public.advance_championship_elimination(uuid,uuid)'::regprocedure,
       'public.complete_championship(uuid,uuid)'::regprocedure
     )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.championship_elimination_bracket_is_valid(uuid,text,boolean) TO %I',
      caller.role_name
    );
  END LOOP;

  FOR caller IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(p.proowner) AS role_name
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid IN (
       'public.resolve_championship_match_tie(uuid,uuid,text,uuid)'::regprocedure
     )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.advance_championship_elimination(uuid,uuid) TO %I',
      caller.role_name
    );
  END LOOP;

  FOR caller IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(p.proowner) AS role_name
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid IN (
       'public.record_group_stage_tie_break(uuid,text,uuid[],text[],uuid[],text,uuid)'::regprocedure
     )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.normalize_championship_tie_entry_ids(uuid[]) TO %I',
      caller.role_name
    );
  END LOOP;

  FOR caller IN
    SELECT DISTINCT pg_catalog.pg_get_userbyid(p.proowner) AS role_name
      FROM pg_catalog.pg_proc AS p
     WHERE p.oid IN (
       'public.assert_championship_operator(uuid,uuid)'::regprocedure,
       'public.link_championship_entry_participant(uuid,uuid,uuid)'::regprocedure,
       'public.set_championship_match_performances(uuid,uuid,uuid,uuid)'::regprocedure,
       'public.start_championship_match(uuid,uuid)'::regprocedure,
       'public.start_championship_presentation(uuid,text,uuid)'::regprocedure,
       'public.complete_championship_presentation(uuid,text,uuid)'::regprocedure,
       'public.open_championship_match_voting(uuid,uuid)'::regprocedure,
       'public.close_championship_match_voting(uuid,uuid)'::regprocedure,
       'public.guard_championship_match_resolution_audit()'::regprocedure,
       'public.guard_championship_match_wo_audit()'::regprocedure,
       'public.get_championship_match_score(uuid,uuid)'::regprocedure,
       'public.advance_championship_elimination(uuid,uuid)'::regprocedure,
       'public.record_championship_match_wo(uuid,uuid,text,uuid)'::regprocedure,
       'public.complete_championship(uuid,uuid)'::regprocedure,
       'public.resolve_championship_match_tie(uuid,uuid,text,uuid)'::regprocedure
     )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.assert_championship_operator(uuid,uuid) TO %I',
      caller.role_name
    );
  END LOOP;
END;
$migration$;
