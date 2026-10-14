REVOKE ALL ON public.championship_match_resolution_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_match_resolution_audit TO service_role;

CREATE OR REPLACE FUNCTION public.guard_championship_match_resolution_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  votes_a_count bigint;
  votes_b_count bigint;
  original_result text;
  winner_entry public.championship_entries%ROWTYPE;
BEGIN
  IF tg_op <> 'INSERT' THEN
    RAISE EXCEPTION 'A auditoria da resolução é imutável.';
  END IF;

  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = new.match_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, new.operator_user_id);

  IF match_row.status <> 'in_progress'
     OR match_row.voting_status <> 'closed'
     OR match_row.winner_entry_id IS NOT NULL
     OR (new.winner_entry_id IS DISTINCT FROM match_row.entry_a_id
       AND new.winner_entry_id IS DISTINCT FROM match_row.entry_b_id)
     OR match_row.entry_a_id IS NULL
     OR match_row.entry_b_id IS NULL
     OR match_row.entry_a_id = match_row.entry_b_id
     OR NOT EXISTS (
       SELECT 1
         FROM public.championship_entries AS entry_a
         JOIN public.championship_entries AS entry_b
           ON entry_b.id = match_row.entry_b_id
        WHERE entry_a.id = match_row.entry_a_id
          AND entry_a.championship_id = match_row.championship_id
          AND entry_b.championship_id = match_row.championship_id
     ) THEN
    RAISE EXCEPTION 'A auditoria não corresponde a um confronto elegível para resolução.';
  END IF;

  IF NOT (
    (match_row.stage = 'quarter_final' AND (
      EXISTS (
        SELECT 1 FROM public.championships AS c
         WHERE c.id = match_row.championship_id
           AND (c.status = 'quarter_finals' OR (c.status = 'drawn' AND c.format = 8))
      )
    ))
    OR (match_row.stage = 'semi_final' AND EXISTS (
      SELECT 1 FROM public.championships AS c
       WHERE c.id = match_row.championship_id AND c.status = 'semi_finals'
    ))
    OR (match_row.stage = 'final' AND EXISTS (
      SELECT 1 FROM public.championships AS c
       WHERE c.id = match_row.championship_id AND c.status = 'final'
    ))
  ) OR (match_row.stage = 'quarter_final' AND EXISTS (
        SELECT 1 FROM public.championship_matches AS later_match
         WHERE later_match.championship_id = match_row.championship_id
           AND later_match.stage = 'semi_final'
      ))
     OR (match_row.stage = 'semi_final' AND EXISTS (
        SELECT 1 FROM public.championship_matches AS later_match
         WHERE later_match.championship_id = match_row.championship_id
           AND later_match.stage = 'final'
      )) THEN
    RAISE EXCEPTION 'A auditoria não pertence a uma resolução permitida na fase atual.';
  END IF;

  SELECT e.* INTO winner_entry
    FROM public.championship_entries AS e
   WHERE e.id = new.winner_entry_id
     AND e.championship_id = match_row.championship_id
     AND e.status = 'confirmed'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A inscrição escolhida não está confirmada neste Campeonato.';
  END IF;

  SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
         count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id)
    INTO votes_a_count, votes_b_count
    FROM public.championship_match_votes AS v
   WHERE v.match_id = match_row.id;

  IF votes_a_count = votes_b_count AND votes_a_count + votes_b_count = 0 THEN
    original_result := 'no_votes';
  ELSIF votes_a_count = votes_b_count THEN
    original_result := 'tie';
  ELSE
    RAISE EXCEPTION 'A votação possui vencedor e não admite resolução administrativa.';
  END IF;

  IF new.original_result IS DISTINCT FROM original_result
     OR new.votes_a IS DISTINCT FROM votes_a_count
     OR new.votes_b IS DISTINCT FROM votes_b_count THEN
    RAISE EXCEPTION 'O resultado ou as contagens da auditoria não correspondem à votação.';
  END IF;
  RETURN new;
END;
$function$;

CREATE TRIGGER t_championship_match_resolution_audit_validate_insert
  BEFORE INSERT ON public.championship_match_resolution_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_match_resolution_audit();

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

  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = new.match_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, new.operator_user_id);

  SELECT e.* INTO withdrawn_entry
    FROM public.championship_entries AS e
   WHERE e.id = new.withdrawn_entry_id
   FOR SHARE;
  SELECT e.* INTO winner_entry
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
     OR withdrawn_entry.status <> 'withdrawn'
     OR winner_entry.id IS NULL
     OR winner_entry.championship_id <> match_row.championship_id
     OR winner_entry.status <> 'confirmed'
     OR length(btrim(new.reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'A auditoria de WO não corresponde a desistência e vencedor elegíveis.';
  END IF;

  RETURN new;
END;
$function$;

CREATE TRIGGER t_championship_match_wo_audit_validate_insert
  BEFORE INSERT ON public.championship_match_wo_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_match_wo_audit();
CREATE TRIGGER t_championship_match_wo_audit_immutable
  BEFORE UPDATE OR DELETE ON public.championship_match_wo_audit
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_match_wo_audit();
CREATE TRIGGER t_championship_match_wo_audit_no_truncate
  BEFORE TRUNCATE ON public.championship_match_wo_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_championship_match_wo_audit();
REVOKE ALL ON public.championship_match_wo_audit
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.championship_match_wo_audit TO service_role;

CREATE OR REPLACE FUNCTION public.guard_championship_match_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  votes_a_count bigint;
  votes_b_count bigint;
  wo_audit public.championship_match_wo_audit%ROWTYPE;
  withdrawn_entry public.championship_entries%ROWTYPE;
  winner_entry public.championship_entries%ROWTYPE;
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

  IF new.status = 'completed' THEN
    IF old.status NOT IN ('in_progress', 'completed')
       OR new.winner_entry_id IS NULL
       OR new.entry_a_id IS NULL
       OR new.entry_b_id IS NULL
       OR new.entry_a_id = new.entry_b_id
       OR new.voting_status <> 'closed' THEN
      RAISE EXCEPTION 'Somente um confronto em andamento com votação fechada e vencedor pode ser concluído.';
    END IF;

    PERFORM 1
      FROM public.championship_entries AS winner_entry
     WHERE winner_entry.id = new.winner_entry_id
       AND winner_entry.championship_id = new.championship_id
       AND winner_entry.status = 'confirmed'
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A inscrição vencedora não pertence ao Campeonato ou não está confirmada.';
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
  ELSIF new.winner_entry_id IS DISTINCT FROM old.winner_entry_id
     AND new.status <> 'wo' THEN
    RAISE EXCEPTION 'O vencedor só pode ser definido por votação válida, resolução auditada ou WO.';
  END IF;

  IF new.status = 'wo' THEN
    IF old.status NOT IN ('scheduled', 'in_progress', 'wo')
       OR new.winner_entry_id IS NULL
       OR new.entry_a_id IS NULL
       OR new.entry_b_id IS NULL
       OR new.entry_a_id = new.entry_b_id
       OR new.voting_status <> 'closed' THEN
      RAISE EXCEPTION 'O WO exige um confronto ainda aberto, vencedor e votação encerrada.';
    END IF;

    SELECT wa.* INTO wo_audit
      FROM public.championship_match_wo_audit AS wa
     WHERE wa.match_id = new.id
       AND wa.winner_entry_id = new.winner_entry_id
       AND wa.withdrawn_entry_id IN (new.entry_a_id, new.entry_b_id)
       AND wa.winner_entry_id IN (new.entry_a_id, new.entry_b_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O WO exige uma auditoria compatível com o confronto.';
    END IF;
    SELECT e.* INTO withdrawn_entry
      FROM public.championship_entries AS e
     WHERE e.id = wo_audit.withdrawn_entry_id
       AND e.championship_id = new.championship_id
     FOR SHARE;
    SELECT e.* INTO winner_entry
      FROM public.championship_entries AS e
     WHERE e.id = wo_audit.winner_entry_id
       AND e.championship_id = new.championship_id
     FOR SHARE;
    IF wo_audit.withdrawn_entry_id = wo_audit.winner_entry_id
       OR withdrawn_entry.id IS NULL
       OR withdrawn_entry.status <> 'withdrawn'
       OR winner_entry.id IS NULL
       OR winner_entry.status <> 'confirmed'
       OR length(btrim(wo_audit.reason)) NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'O WO exige uma auditoria compatível com os participantes e inscrições elegíveis.';
    END IF;
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

CREATE OR REPLACE FUNCTION public.validate_championship_match_vote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  voter_championship_id uuid;
BEGIN
  -- Vote insertion takes a shared match lock; closure and resolution take an exclusive one.
  SELECT m.* INTO match_row
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
  IF new.chosen_entry_id IS DISTINCT FROM match_row.entry_a_id
     AND new.chosen_entry_id IS DISTINCT FROM match_row.entry_b_id THEN
    RAISE EXCEPTION 'A inscrição escolhida não pertence a este confronto.';
  END IF;

  SELECT s.championship_id INTO voter_championship_id
    FROM public.voter_sessions AS vs
    JOIN public.sessions AS s ON s.id = vs.session_id
   WHERE vs.id = new.voter_session_id;
  IF voter_championship_id IS DISTINCT FROM match_row.championship_id THEN
    RAISE EXCEPTION 'A sessão votante não pertence a este Campeonato.';
  END IF;
  new.created_at := clock_timestamp();
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_championship_vote_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'Votos de confrontos do Campeonato são imutáveis.';
END;
$function$;
DROP TRIGGER t_championship_match_votes_immutable ON public.championship_match_votes;
CREATE TRIGGER t_championship_match_votes_immutable
  BEFORE UPDATE OR DELETE ON public.championship_match_votes
  FOR EACH ROW EXECUTE FUNCTION public.block_championship_vote_update();
CREATE TRIGGER t_championship_match_votes_no_truncate
  BEFORE TRUNCATE ON public.championship_match_votes
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_championship_vote_update();

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
  match_row public.championship_matches%ROWTYPE;
  votes_a bigint;
  votes_b bigint;
  winner_id uuid;
  result_name text;
BEGIN
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, p_operator_user_id);

  IF match_row.voting_status = 'closed' THEN
    SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
           count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id)
      INTO votes_a, votes_b
      FROM public.championship_match_votes AS v
     WHERE v.match_id = match_row.id;
    result_name := CASE
      WHEN match_row.winner_entry_id IS NOT NULL THEN 'winner'
      WHEN votes_a + votes_b = 0 THEN 'no_votes'
      ELSE 'tie'
    END;
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

  SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
         count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id)
    INTO votes_a, votes_b
    FROM public.championship_match_votes AS v
   WHERE v.match_id = match_row.id;

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
    WHEN votes_a + votes_b = 0 THEN 'no_votes'
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
  expected_match_count integer;
  valid_match_count integer;
BEGIN
  SELECT c.* INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  IF championship_row.status = 'quarter_finals' THEN
    SELECT count(*),
           count(*) FILTER (
             WHERE m.status IN ('completed', 'wo')
               AND m.winner_entry_id IS NOT NULL
               AND m.winner_entry_id IN (m.entry_a_id, m.entry_b_id)
               AND m.entry_a_id IS NOT NULL
               AND m.entry_b_id IS NOT NULL
               AND m.entry_a_id <> m.entry_b_id
               AND EXISTS (
                 SELECT 1
                   FROM public.championship_entries AS entry_a
                   JOIN public.championship_entries AS entry_b
                     ON entry_b.id = m.entry_b_id
                  WHERE entry_a.id = m.entry_a_id
                    AND entry_a.championship_id = championship_row.id
                    AND entry_b.championship_id = championship_row.id
               )
               AND winner_entry.championship_id = championship_row.id
               AND winner_entry.status = 'confirmed'
           )
      INTO expected_match_count, valid_match_count
      FROM pg_catalog.generate_series(1, 4) AS expected(match_number)
      LEFT JOIN public.championship_matches AS m
        ON m.championship_id = championship_row.id
       AND m.stage = 'quarter_final'
       AND m.match_number = expected.match_number
      LEFT JOIN public.championship_entries AS winner_entry
        ON winner_entry.id = m.winner_entry_id;

    IF expected_match_count <> 4 OR valid_match_count <> 4 OR EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id
         AND m.stage = 'quarter_final'
         AND m.match_number NOT BETWEEN 1 AND 4
    ) THEN
      RAISE EXCEPTION 'Cada um dos quatro confrontos das quartas precisa de resultado válido.';
    END IF;

    INSERT INTO public.championship_matches (
      championship_id, stage, match_number, entry_a_id, entry_b_id
    )
    SELECT championship_row.id, 'semi_final', expected.match_number,
           CASE expected.match_number
             WHEN 1 THEN q1.winner_entry_id
             ELSE q3.winner_entry_id
           END,
           CASE expected.match_number
             WHEN 1 THEN q2.winner_entry_id
             ELSE q4.winner_entry_id
           END
      FROM (VALUES (1), (2)) AS expected(match_number)
      JOIN public.championship_matches AS q1
        ON q1.championship_id = championship_row.id
       AND q1.stage = 'quarter_final' AND q1.match_number = 1
      JOIN public.championship_matches AS q2
        ON q2.championship_id = championship_row.id
       AND q2.stage = 'quarter_final' AND q2.match_number = 2
      JOIN public.championship_matches AS q3
        ON q3.championship_id = championship_row.id
       AND q3.stage = 'quarter_final' AND q3.match_number = 3
      JOIN public.championship_matches AS q4
        ON q4.championship_id = championship_row.id
       AND q4.stage = 'quarter_final' AND q4.match_number = 4
    ON CONFLICT (championship_id, stage, match_number) DO NOTHING;

    SELECT count(*) INTO valid_match_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id
       AND m.stage = 'semi_final'
       AND (
         (m.match_number = 1
           AND m.entry_a_id = (SELECT q.winner_entry_id FROM public.championship_matches AS q
                                WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 1)
           AND m.entry_b_id = (SELECT q.winner_entry_id FROM public.championship_matches AS q
                                WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 2))
         OR
         (m.match_number = 2
           AND m.entry_a_id = (SELECT q.winner_entry_id FROM public.championship_matches AS q
                                WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 3)
           AND m.entry_b_id = (SELECT q.winner_entry_id FROM public.championship_matches AS q
                                WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 4))
       );
    IF valid_match_count <> 2 OR (
      SELECT count(*) FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final'
    ) <> 2 THEN
      RAISE EXCEPTION 'O chaveamento das semifinais não corresponde aos vencedores das quartas.';
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
    SELECT count(*),
           count(*) FILTER (
             WHERE m.entry_a_id IS NOT NULL
               AND m.entry_b_id IS NOT NULL
               AND m.entry_a_id <> m.entry_b_id
               AND m.winner_entry_id IS NOT NULL
               AND m.winner_entry_id IN (m.entry_a_id, m.entry_b_id)
               AND (
                 (m.match_number = 1
                   AND m.entry_a_id = (
                     SELECT q.winner_entry_id
                       FROM public.championship_matches AS q
                      WHERE q.championship_id = championship_row.id
                        AND q.stage = 'quarter_final'
                        AND q.match_number = 1
                   )
                   AND m.entry_b_id = (
                     SELECT q.winner_entry_id
                       FROM public.championship_matches AS q
                      WHERE q.championship_id = championship_row.id
                        AND q.stage = 'quarter_final'
                        AND q.match_number = 2
                   ))
                 OR
                 (m.match_number = 2
                   AND m.entry_a_id = (
                     SELECT q.winner_entry_id
                       FROM public.championship_matches AS q
                      WHERE q.championship_id = championship_row.id
                        AND q.stage = 'quarter_final'
                        AND q.match_number = 3
                   )
                   AND m.entry_b_id = (
                     SELECT q.winner_entry_id
                       FROM public.championship_matches AS q
                      WHERE q.championship_id = championship_row.id
                        AND q.stage = 'quarter_final'
                        AND q.match_number = 4
                   ))
               )
               AND EXISTS (
                 SELECT 1
                   FROM public.championship_entries AS entry_a
                   JOIN public.championship_entries AS entry_b
                     ON entry_b.id = m.entry_b_id
                  WHERE entry_a.id = m.entry_a_id
                    AND entry_a.championship_id = championship_row.id
                    AND entry_b.championship_id = championship_row.id
               )
               AND m.status IN ('completed', 'wo')
               AND winner_entry.championship_id = championship_row.id
               AND winner_entry.status = 'confirmed'
           )
      INTO expected_match_count, valid_match_count
      FROM pg_catalog.generate_series(1, 2) AS expected(match_number)
      LEFT JOIN public.championship_matches AS m
        ON m.championship_id = championship_row.id
       AND m.stage = 'semi_final'
       AND m.match_number = expected.match_number
      LEFT JOIN public.championship_entries AS winner_entry
        ON winner_entry.id = m.winner_entry_id;
    IF expected_match_count <> 2 OR (
      SELECT count(*) FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final'
    ) <> 2 OR EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id
         AND m.stage = 'semi_final'
         AND m.match_number NOT BETWEEN 1 AND 2
    ) THEN
      RAISE EXCEPTION 'Os dois confrontos das semifinais precisam estar presentes.';
    END IF;
    IF valid_match_count <> 2 THEN
      RETURN pg_catalog.jsonb_build_object(
        'championship_id', championship_row.id,
        'status', 'semi_finals',
        'matches_generated', 0
      );
    END IF;

    INSERT INTO public.championship_matches (
      championship_id, stage, match_number, entry_a_id, entry_b_id
    )
    SELECT championship_row.id, 'final', 1, semi1.winner_entry_id, semi2.winner_entry_id
      FROM public.championship_matches AS semi1
      JOIN public.championship_matches AS semi2
        ON semi2.championship_id = semi1.championship_id
       AND semi2.stage = 'semi_final'
       AND semi2.match_number = 2
     WHERE semi1.championship_id = championship_row.id
       AND semi1.stage = 'semi_final'
       AND semi1.match_number = 1
    ON CONFLICT (championship_id, stage, match_number) DO NOTHING;

    SELECT count(*) INTO valid_match_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id
       AND m.stage = 'final'
       AND m.match_number = 1
       AND m.entry_a_id = (SELECT s.winner_entry_id FROM public.championship_matches AS s
                            WHERE s.championship_id = championship_row.id AND s.stage = 'semi_final' AND s.match_number = 1)
       AND m.entry_b_id = (SELECT s.winner_entry_id FROM public.championship_matches AS s
                            WHERE s.championship_id = championship_row.id AND s.stage = 'semi_final' AND s.match_number = 2);
    IF valid_match_count <> 1 OR (
      SELECT count(*) FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'final'
    ) <> 1 THEN
      RAISE EXCEPTION 'O chaveamento da final não corresponde às vencedoras das semifinais.';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.championship_matches AS final_match
        JOIN public.championship_entries AS entry_a ON entry_a.id = final_match.entry_a_id
        JOIN public.championship_entries AS entry_b ON entry_b.id = final_match.entry_b_id
       WHERE final_match.championship_id = championship_row.id
         AND final_match.stage = 'final'
         AND (entry_a.championship_id <> championship_row.id
           OR entry_b.championship_id <> championship_row.id
           OR entry_a.id = entry_b.id)
    ) THEN
      RAISE EXCEPTION 'Os participantes da final não pertencem ao chaveamento deste Campeonato.';
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

  IF championship_row.status = 'final' THEN
    SELECT count(*) INTO valid_match_count
      FROM public.championship_matches AS m
      JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
      JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
     WHERE m.championship_id = championship_row.id
       AND m.stage = 'final'
       AND m.match_number = 1;
    IF valid_match_count = 1
       AND EXISTS (
         SELECT 1
           FROM public.championship_matches AS m
           JOIN public.championship_entries AS entry_a ON entry_a.id = m.entry_a_id
           JOIN public.championship_entries AS entry_b ON entry_b.id = m.entry_b_id
          WHERE m.championship_id = championship_row.id
            AND m.stage = 'final'
            AND m.match_number = 1
            AND m.entry_a_id <> m.entry_b_id
            AND entry_a.championship_id = championship_row.id
            AND entry_b.championship_id = championship_row.id
            AND m.entry_a_id = (
              SELECT s.winner_entry_id
                FROM public.championship_matches AS s
               WHERE s.championship_id = championship_row.id
                 AND s.stage = 'semi_final'
                 AND s.match_number = 1
                 AND s.status IN ('completed', 'wo')
                 AND s.winner_entry_id IN (s.entry_a_id, s.entry_b_id)
                 AND EXISTS (
                   SELECT 1 FROM public.championship_entries AS winner
                    WHERE winner.id = s.winner_entry_id
                      AND winner.championship_id = championship_row.id
                      AND winner.status = 'confirmed'
                 )
            )
            AND m.entry_b_id = (
              SELECT s.winner_entry_id
                FROM public.championship_matches AS s
               WHERE s.championship_id = championship_row.id
                 AND s.stage = 'semi_final'
                 AND s.match_number = 2
                 AND s.status IN ('completed', 'wo')
                 AND s.winner_entry_id IN (s.entry_a_id, s.entry_b_id)
                 AND EXISTS (
                   SELECT 1 FROM public.championship_entries AS winner
                    WHERE winner.id = s.winner_entry_id
                      AND winner.championship_id = championship_row.id
                      AND winner.status = 'confirmed'
                 )
            )
       )
       AND (
      SELECT count(*) FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'final'
       ) = 1
       AND (
         SELECT count(*) FROM public.championship_matches AS m
          WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final'
       ) = 2 THEN
      RETURN pg_catalog.jsonb_build_object(
        'championship_id', championship_row.id,
        'status', 'final',
        'matches_generated', 0
      );
    END IF;
  END IF;

  RAISE EXCEPTION 'O Campeonato não está pronto para avançar para a próxima fase.';
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
  ready_to_advance boolean;
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

  IF match_row.stage = 'quarter_final' THEN
    SELECT NOT EXISTS (
      SELECT 1
        FROM pg_catalog.generate_series(1, 4) AS expected(match_number)
        LEFT JOIN public.championship_matches AS m
          ON m.championship_id = championship_row.id
         AND m.stage = 'quarter_final'
         AND m.match_number = expected.match_number
        LEFT JOIN public.championship_entries AS winner_entry
          ON winner_entry.id = m.winner_entry_id
       WHERE m.id IS NULL
          OR m.status NOT IN ('completed', 'wo')
          OR m.winner_entry_id IS NULL
          OR m.winner_entry_id NOT IN (m.entry_a_id, m.entry_b_id)
          OR m.entry_a_id IS NULL
          OR m.entry_b_id IS NULL
          OR m.entry_a_id = m.entry_b_id
          OR NOT EXISTS (
            SELECT 1
              FROM public.championship_entries AS entry_a
              JOIN public.championship_entries AS entry_b
                ON entry_b.id = m.entry_b_id
             WHERE entry_a.id = m.entry_a_id
               AND entry_a.championship_id = championship_row.id
               AND entry_b.championship_id = championship_row.id
          )
          OR winner_entry.championship_id <> championship_row.id
          OR winner_entry.status <> 'confirmed'
    ) INTO ready_to_advance;
  ELSIF match_row.stage = 'semi_final' THEN
    SELECT NOT EXISTS (
      SELECT 1
        FROM pg_catalog.generate_series(1, 2) AS expected(match_number)
        LEFT JOIN public.championship_matches AS m
          ON m.championship_id = championship_row.id
         AND m.stage = 'semi_final'
         AND m.match_number = expected.match_number
        LEFT JOIN public.championship_entries AS winner_entry
          ON winner_entry.id = m.winner_entry_id
       WHERE m.id IS NULL
          OR m.status NOT IN ('completed', 'wo')
          OR m.winner_entry_id IS NULL
          OR m.winner_entry_id NOT IN (m.entry_a_id, m.entry_b_id)
          OR m.entry_a_id IS NULL
          OR m.entry_b_id IS NULL
          OR m.entry_a_id = m.entry_b_id
          OR NOT EXISTS (
            SELECT 1
              FROM public.championship_entries AS entry_a
              JOIN public.championship_entries AS entry_b
                ON entry_b.id = m.entry_b_id
             WHERE entry_a.id = m.entry_a_id
               AND entry_a.championship_id = championship_row.id
               AND entry_b.championship_id = championship_row.id
          )
          OR winner_entry.championship_id <> championship_row.id
          OR winner_entry.status <> 'confirmed'
    ) INTO ready_to_advance;
  ELSE
    ready_to_advance := false;
  END IF;

  IF ready_to_advance THEN
    PERFORM public.advance_championship_elimination(championship_row.id, p_operator_user_id);
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

REVOKE ALL ON FUNCTION public.close_championship_match_voting(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_championship_match_voting(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.advance_championship_elimination(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_championship_elimination(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.resolve_championship_match_tie(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_championship_match_tie(uuid, uuid, text, uuid)
  TO service_role;
