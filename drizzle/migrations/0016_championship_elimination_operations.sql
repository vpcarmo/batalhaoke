CREATE TABLE public.championship_match_wo_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE REFERENCES public.championship_matches(id) ON DELETE RESTRICT,
  withdrawn_entry_id uuid NOT NULL REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  winner_entry_id uuid NOT NULL REFERENCES public.championship_entries(id) ON DELETE RESTRICT,
  operator_user_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (withdrawn_entry_id <> winner_entry_id)
);
ALTER TABLE public.championship_match_wo_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.championship_match_wo_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.championship_match_wo_audit TO service_role;

CREATE OR REPLACE FUNCTION public.assert_championship_operator(
  p_championship_id uuid,
  p_operator_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  resolved_venue_id uuid;
BEGIN
  SELECT c.venue_id
    INTO resolved_venue_id
    FROM public.championships AS c
   WHERE c.id = p_championship_id;

  IF resolved_venue_id IS NULL OR p_operator_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.venue_operators AS vo
        WHERE vo.venue_id = resolved_venue_id
          AND vo.user_id = p_operator_user_id
          AND vo.role IN ('owner', 'operator')
     ) THEN
    RAISE EXCEPTION 'Operador não autorizado para este Campeonato.' USING ERRCODE = '42501';
  END IF;

  RETURN resolved_venue_id;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.guard_championship_match_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  votes_a bigint;
  votes_b bigint;
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

  IF new.winner_entry_id IS DISTINCT FROM old.winner_entry_id THEN
    IF new.status = 'completed' AND new.winner_entry_id IS NOT NULL
       AND new.voting_status = 'closed' THEN
      SELECT count(*) FILTER (WHERE v.chosen_entry_id = new.entry_a_id),
             count(*) FILTER (WHERE v.chosen_entry_id = new.entry_b_id)
        INTO votes_a, votes_b
        FROM public.championship_match_votes AS v
       WHERE v.match_id = new.id;

      IF (new.winner_entry_id = new.entry_a_id AND votes_a <= votes_b)
         OR (new.winner_entry_id = new.entry_b_id AND votes_b <= votes_a) THEN
        RAISE EXCEPTION 'O vencedor não corresponde à apuração da votação.';
      END IF;
    ELSIF new.status = 'wo' AND EXISTS (
      SELECT 1
        FROM public.championship_match_wo_audit AS wa
       WHERE wa.match_id = new.id
         AND wa.winner_entry_id = new.winner_entry_id
         AND wa.withdrawn_entry_id IN (new.entry_a_id, new.entry_b_id)
         AND wa.winner_entry_id IN (new.entry_a_id, new.entry_b_id)
    ) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'O vencedor só pode ser definido pela votação válida ou por WO auditado.';
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
CREATE TRIGGER t_championship_matches_lifecycle
  BEFORE UPDATE ON public.championship_matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_match_lifecycle();

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

  IF new.status = 'completed' AND old.status IS DISTINCT FROM 'completed'
     AND (old.status <> 'final' OR NOT EXISTS (
       SELECT 1
         FROM public.championship_matches AS m
        WHERE m.championship_id = new.id
          AND m.stage = 'final'
          AND m.match_number = 1
          AND m.status IN ('completed', 'wo')
          AND m.winner_entry_id IS NOT NULL
     )) THEN
    RAISE EXCEPTION 'O Campeonato só pode ser encerrado após uma decisão válida da final.';
  END IF;

  RETURN new;
END;
$function$;
CREATE TRIGGER t_championships_completion_guard
  BEFORE UPDATE OF status ON public.championships
  FOR EACH ROW EXECUTE FUNCTION public.guard_championship_completion();

CREATE OR REPLACE FUNCTION public.set_championship_match_performances(
  p_match_id uuid,
  p_performance_a_id uuid,
  p_performance_b_id uuid,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  session_row public.sessions%ROWTYPE;
  entry_a public.championship_entries%ROWTYPE;
  entry_b public.championship_entries%ROWTYPE;
  performance_a public.performances%ROWTYPE;
  performance_b public.performances%ROWTYPE;
BEGIN
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, p_operator_user_id);

  IF match_row.status <> 'scheduled' THEN
    RAISE EXCEPTION 'As apresentações só podem ser associadas antes do início do confronto.';
  END IF;
  IF p_performance_a_id IS NULL OR p_performance_b_id IS NULL OR p_performance_a_id = p_performance_b_id THEN
    RAISE EXCEPTION 'Informe duas apresentações distintas.';
  END IF;

  SELECT s.* INTO session_row
    FROM public.sessions AS s
   WHERE s.championship_id = match_row.championship_id
     AND s.session_type = 'championship'
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A sessão de palco do Campeonato não foi preparada.'; END IF;

  SELECT e.* INTO entry_a FROM public.championship_entries AS e WHERE e.id = match_row.entry_a_id FOR SHARE;
  SELECT e.* INTO entry_b FROM public.championship_entries AS e WHERE e.id = match_row.entry_b_id FOR SHARE;
  IF entry_a.id IS NULL OR entry_b.id IS NULL OR entry_a.participant_id IS NULL OR entry_b.participant_id IS NULL THEN
    RAISE EXCEPTION 'As inscrições A e B precisam estar associadas aos participantes do palco.';
  END IF;
  IF entry_a.status <> 'confirmed' OR entry_b.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Inscrições retiradas ou desqualificadas não podem receber novas apresentações.';
  END IF;

  SELECT p.* INTO performance_a FROM public.performances AS p WHERE p.id = p_performance_a_id FOR SHARE;
  SELECT p.* INTO performance_b FROM public.performances AS p WHERE p.id = p_performance_b_id FOR SHARE;
  IF performance_a.id IS NULL OR performance_b.id IS NULL
     OR performance_a.session_id <> session_row.id OR performance_b.session_id <> session_row.id
     OR performance_a.participant_id <> entry_a.participant_id
     OR performance_b.participant_id <> entry_b.participant_id
     OR performance_a.status <> 'queued' OR performance_b.status <> 'queued'
     OR performance_a.playback_source_id IS NULL OR performance_b.playback_source_id IS NULL THEN
    RAISE EXCEPTION 'As apresentações devem pertencer à sessão de palco, às inscrições correspondentes e estar na fila.';
  END IF;

  IF (match_row.performance_a_id IS NOT NULL AND match_row.performance_a_id <> p_performance_a_id)
     OR (match_row.performance_b_id IS NOT NULL AND match_row.performance_b_id <> p_performance_b_id) THEN
    RAISE EXCEPTION 'As apresentações deste confronto já foram definidas.';
  END IF;

  UPDATE public.championship_matches AS m
     SET performance_a_id = p_performance_a_id,
         performance_b_id = p_performance_b_id
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  RETURN pg_catalog.to_jsonb(match_row);
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.start_championship_presentation(
  p_match_id uuid,
  p_slot text,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  session_id uuid;
  performance_id uuid;
  performance_a_status text;
  performance_b_status text;
BEGIN
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, p_operator_user_id);
  IF match_row.status <> 'in_progress' OR p_slot NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'O confronto deve estar em andamento e a posição deve ser A ou B.';
  END IF;

  SELECT s.id INTO session_id
    FROM public.sessions AS s
   WHERE s.championship_id = match_row.championship_id
     AND s.session_type = 'championship'
     AND s.status = 'active'
   FOR SHARE;
  IF session_id IS NULL THEN RAISE EXCEPTION 'A sessão de palco ativa do Campeonato não foi encontrada.'; END IF;

  SELECT p.status INTO performance_a_status FROM public.performances AS p WHERE p.id = match_row.performance_a_id FOR UPDATE;
  SELECT p.status INTO performance_b_status FROM public.performances AS p WHERE p.id = match_row.performance_b_id FOR UPDATE;
  IF p_slot = 'a' THEN
    performance_id := match_row.performance_a_id;
    IF performance_a_status <> 'queued' OR performance_b_status <> 'queued' THEN
      RAISE EXCEPTION 'A apresentação A só pode iniciar antes da apresentação B.';
    END IF;
  ELSE
    performance_id := match_row.performance_b_id;
    IF performance_b_status <> 'queued' OR performance_a_status <> 'completed' THEN
      RAISE EXCEPTION 'A apresentação B só pode iniciar após a conclusão da apresentação A.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.performances AS p
     WHERE p.session_id = session_id AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Já existe uma apresentação ativa na sessão de palco.';
  END IF;

  UPDATE public.performances AS p
     SET status = 'active', started_at = clock_timestamp(), ended_at = NULL
   WHERE p.id = performance_id AND p.status = 'queued';
  IF NOT FOUND THEN RAISE EXCEPTION 'Não foi possível iniciar a apresentação.'; END IF;

  RETURN pg_catalog.jsonb_build_object('match_id', match_row.id, 'slot', p_slot, 'performance_id', performance_id, 'status', 'active');
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_championship_presentation(
  p_match_id uuid,
  p_slot text,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  performance_id uuid;
BEGIN
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, p_operator_user_id);
  IF match_row.status <> 'in_progress' OR p_slot NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'O confronto deve estar em andamento e a posição deve ser A ou B.';
  END IF;

  performance_id := CASE p_slot WHEN 'a' THEN match_row.performance_a_id ELSE match_row.performance_b_id END;
  IF performance_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.performances AS p WHERE p.id = performance_id AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'A apresentação informada não está em andamento.';
  END IF;

  IF p_slot = 'a' AND EXISTS (
    SELECT 1 FROM public.performances AS p WHERE p.id = match_row.performance_b_id AND p.status <> 'queued'
  ) THEN
    RAISE EXCEPTION 'A apresentação A deve ser concluída antes de iniciar B.';
  END IF;

  UPDATE public.performances AS p
     SET status = 'completed', ended_at = clock_timestamp()
   WHERE p.id = performance_id AND p.status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Não foi possível concluir a apresentação.'; END IF;

  RETURN pg_catalog.jsonb_build_object('match_id', match_row.id, 'slot', p_slot, 'performance_id', performance_id, 'status', 'completed');
END;
$function$;

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
  match_row public.championship_matches%ROWTYPE;
BEGIN
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, p_operator_user_id);
  IF match_row.status <> 'in_progress' OR match_row.voting_status <> 'idle' THEN
    RAISE EXCEPTION 'A votação só pode ser aberta uma vez em um confronto em andamento.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.performances AS pa
      JOIN public.performances AS pb ON pb.id = match_row.performance_b_id
     WHERE pa.id = match_row.performance_a_id
       AND pa.status = 'completed'
       AND pb.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'A votação só pode abrir após a conclusão das apresentações A e B.';
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(match_row.championship_id, p_operator_user_id);

  IF match_row.voting_status = 'closed' THEN
    SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
           count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id)
      INTO votes_a, votes_b
      FROM public.championship_match_votes AS v
     WHERE v.match_id = match_row.id;
    winner_id := match_row.winner_entry_id;
    result_name := CASE
      WHEN winner_id IS NOT NULL THEN 'winner'
      WHEN votes_a + votes_b = 0 THEN 'no_votes'
      ELSE 'tie'
    END;
    RETURN pg_catalog.jsonb_build_object(
      'match_id', match_row.id, 'voting_status', 'closed',
      'votes_a', votes_a, 'votes_b', votes_b,
      'result', result_name, 'winner_entry_id', winner_id
    );
  END IF;

  IF match_row.status <> 'in_progress' OR match_row.voting_status <> 'open' THEN
    RAISE EXCEPTION 'Não há votação aberta para encerrar.';
  END IF;
  IF match_row.voting_ends_at IS NULL OR match_row.voting_ends_at > clock_timestamp() THEN
    RAISE EXCEPTION 'A votação só pode ser encerrada após os 30 segundos.';
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
    SELECT 1 FROM public.championship_entries AS e
     WHERE e.id = winner_id AND e.status = 'confirmed'
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
    'match_id', match_row.id, 'voting_status', match_row.voting_status,
    'votes_a', votes_a, 'votes_b', votes_b,
    'result', result_name, 'winner_entry_id', winner_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_championship_match_score(
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
  resolved_venue_id uuid;
  votes_a bigint;
  votes_b bigint;
  result_name text;
BEGIN
  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;
  resolved_venue_id := public.assert_championship_operator(match_row.championship_id, p_operator_user_id);

  SELECT count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_a_id),
         count(*) FILTER (WHERE v.chosen_entry_id = match_row.entry_b_id)
    INTO votes_a, votes_b
    FROM public.championship_match_votes AS v
   WHERE v.match_id = match_row.id;

  result_name := CASE
    WHEN match_row.winner_entry_id IS NOT NULL THEN 'winner'
    WHEN match_row.voting_status <> 'closed' THEN 'pending'
    WHEN votes_a + votes_b = 0 THEN 'no_votes'
    ELSE 'tie'
  END;

  RETURN pg_catalog.jsonb_build_object(
    'match_id', match_row.id,
    'stage', match_row.stage,
    'match_number', match_row.match_number,
    'entry_a_id', match_row.entry_a_id,
    'entry_b_id', match_row.entry_b_id,
    'winner_entry_id', match_row.winner_entry_id,
    'status', match_row.status,
    'voting_status', match_row.voting_status,
    'voting_ends_at', match_row.voting_ends_at,
    'votes_a', votes_a,
    'votes_b', votes_b,
    'result', result_name,
    'is_final', match_row.status IN ('completed', 'wo'),
    'venue_id', resolved_venue_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cast_championship_match_vote(
  p_match_id uuid,
  p_chosen_entry_id uuid,
  p_voter_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  match_row public.championship_matches%ROWTYPE;
  session_id uuid;
  voter_id uuid;
  vote_id uuid;
BEGIN
  IF p_voter_token_hash IS NULL OR p_voter_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Token de votante inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT m.* INTO match_row
    FROM public.championship_matches AS m
   WHERE m.id = p_match_id
   FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confronto não encontrado.' USING ERRCODE = 'P0002'; END IF;

  SELECT s.id INTO session_id
    FROM public.sessions AS s
   WHERE s.championship_id = match_row.championship_id
     AND s.session_type = 'championship'
     AND s.status = 'active';
  IF session_id IS NULL THEN RAISE EXCEPTION 'A sessão de palco ativa do Campeonato não foi encontrada.'; END IF;

  IF match_row.status <> 'in_progress'
     OR match_row.voting_status <> 'open'
     OR match_row.voting_ends_at IS NULL
     OR match_row.voting_ends_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'A votação deste confronto está encerrada.';
  END IF;
  IF p_chosen_entry_id IS DISTINCT FROM match_row.entry_a_id
     AND p_chosen_entry_id IS DISTINCT FROM match_row.entry_b_id THEN
    RAISE EXCEPTION 'Escolha somente uma das inscrições deste confronto.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.championship_entries AS e
     WHERE e.id = p_chosen_entry_id AND e.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'A inscrição escolhida não está elegível para votação.';
  END IF;

  INSERT INTO public.voter_sessions (session_id, voter_token_hash, last_seen_at)
  VALUES (session_id, p_voter_token_hash, clock_timestamp())
  ON CONFLICT (session_id, voter_token_hash)
  DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
  RETURNING id INTO voter_id;

  INSERT INTO public.championship_match_votes (match_id, voter_session_id, chosen_entry_id)
  VALUES (match_row.id, voter_id, p_chosen_entry_id)
  ON CONFLICT (match_id, voter_session_id) DO NOTHING
  RETURNING id INTO vote_id;

  IF vote_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result', 'already_voted', 'match_id', match_row.id);
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok', 'match_id', match_row.id);
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
  existing_count integer;
BEGIN
  SELECT c.* INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  IF championship_row.status = 'quarter_finals' THEN
    IF (
      SELECT count(*) FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'quarter_final'
         AND m.status IN ('completed', 'wo') AND m.winner_entry_id IS NOT NULL
    ) <> 4 THEN
      RAISE EXCEPTION 'Todos os quatro confrontos das quartas precisam de um resultado válido.';
    END IF;

    INSERT INTO public.championship_matches (championship_id, stage, match_number, entry_a_id, entry_b_id)
    SELECT championship_row.id, 'semi_final', pair.match_number, pair.entry_a_id, pair.entry_b_id
      FROM (
        SELECT 1 AS match_number,
               (SELECT m.winner_entry_id FROM public.championship_matches AS m WHERE m.championship_id = championship_row.id AND m.stage = 'quarter_final' AND m.match_number = 1) AS entry_a_id,
               (SELECT m.winner_entry_id FROM public.championship_matches AS m WHERE m.championship_id = championship_row.id AND m.stage = 'quarter_final' AND m.match_number = 2) AS entry_b_id
        UNION ALL
        SELECT 2,
               (SELECT m.winner_entry_id FROM public.championship_matches AS m WHERE m.championship_id = championship_row.id AND m.stage = 'quarter_final' AND m.match_number = 3),
               (SELECT m.winner_entry_id FROM public.championship_matches AS m WHERE m.championship_id = championship_row.id AND m.stage = 'quarter_final' AND m.match_number = 4)
      ) AS pair
    ON CONFLICT (championship_id, stage, match_number) DO NOTHING;

    SELECT count(*) INTO existing_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final';
    IF existing_count <> 2 OR EXISTS (
      SELECT 1
        FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final'
         AND (
           m.entry_a_id IS NULL OR m.entry_b_id IS NULL OR m.entry_a_id = m.entry_b_id
           OR (m.match_number = 1 AND (
             m.entry_a_id IS DISTINCT FROM (SELECT q.winner_entry_id FROM public.championship_matches AS q WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 1)
             OR m.entry_b_id IS DISTINCT FROM (SELECT q.winner_entry_id FROM public.championship_matches AS q WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 2)
           ))
           OR (m.match_number = 2 AND (
             m.entry_a_id IS DISTINCT FROM (SELECT q.winner_entry_id FROM public.championship_matches AS q WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 3)
             OR m.entry_b_id IS DISTINCT FROM (SELECT q.winner_entry_id FROM public.championship_matches AS q WHERE q.championship_id = championship_row.id AND q.stage = 'quarter_final' AND q.match_number = 4)
           ))
         )
    ) THEN
      RAISE EXCEPTION 'O chaveamento das semifinais não corresponde aos vencedores das quartas.';
    END IF;

    UPDATE public.championships AS c SET status = 'semi_finals' WHERE c.id = championship_row.id;
    RETURN pg_catalog.jsonb_build_object('championship_id', championship_row.id, 'status', 'semi_finals', 'matches_generated', 2);
  END IF;

  IF championship_row.status = 'semi_finals' THEN
    SELECT count(*) INTO existing_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final';
    IF existing_count <> 2 THEN
      RAISE EXCEPTION 'O chaveamento das semifinais está incompleto.';
    END IF;

    IF (
      SELECT count(*) FROM public.championship_matches AS m
       WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final'
         AND m.status IN ('completed', 'wo') AND m.winner_entry_id IS NOT NULL
    ) <> 2 THEN
      RETURN pg_catalog.jsonb_build_object(
        'championship_id', championship_row.id,
        'status', 'semi_finals',
        'matches_generated', 0
      );
    END IF;

    INSERT INTO public.championship_matches (championship_id, stage, match_number, entry_a_id, entry_b_id)
    SELECT championship_row.id, 'final', 1,
           (SELECT m.winner_entry_id FROM public.championship_matches AS m WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final' AND m.match_number = 1),
           (SELECT m.winner_entry_id FROM public.championship_matches AS m WHERE m.championship_id = championship_row.id AND m.stage = 'semi_final' AND m.match_number = 2)
    ON CONFLICT (championship_id, stage, match_number) DO NOTHING;

    SELECT count(*) INTO existing_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id AND m.stage = 'final'
       AND m.match_number = 1
       AND m.entry_a_id = (SELECT s.winner_entry_id FROM public.championship_matches AS s WHERE s.championship_id = championship_row.id AND s.stage = 'semi_final' AND s.match_number = 1)
       AND m.entry_b_id = (SELECT s.winner_entry_id FROM public.championship_matches AS s WHERE s.championship_id = championship_row.id AND s.stage = 'semi_final' AND s.match_number = 2);
    IF existing_count <> 1 THEN
      RAISE EXCEPTION 'O chaveamento da final não corresponde às vencedoras das semifinais.';
    END IF;

    UPDATE public.championships AS c SET status = 'final' WHERE c.id = championship_row.id;
    RETURN pg_catalog.jsonb_build_object('championship_id', championship_row.id, 'status', 'final', 'matches_generated', 1);
  END IF;

  IF championship_row.status = 'final' THEN
    SELECT count(*) INTO existing_count
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id AND m.stage = 'final' AND m.match_number = 1;
    IF existing_count = 1 THEN
      RETURN pg_catalog.jsonb_build_object('championship_id', championship_row.id, 'status', 'final', 'matches_generated', 0);
    END IF;
  END IF;

  RAISE EXCEPTION 'O Campeonato não está pronto para avançar para a próxima fase.';
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
  winner_id uuid;
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

  IF match_row.status NOT IN ('scheduled', 'in_progress') OR match_row.winner_entry_id IS NOT NULL THEN
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
    SELECT e.* INTO withdrawn_entry FROM public.championship_entries AS e WHERE e.id = match_row.entry_a_id FOR UPDATE;
    SELECT e.* INTO opposing_entry FROM public.championship_entries AS e WHERE e.id = match_row.entry_b_id FOR UPDATE;
    winner_id := match_row.entry_b_id;
  ELSIF p_withdrawn_entry_id = match_row.entry_b_id THEN
    SELECT e.* INTO withdrawn_entry FROM public.championship_entries AS e WHERE e.id = match_row.entry_b_id FOR UPDATE;
    SELECT e.* INTO opposing_entry FROM public.championship_entries AS e WHERE e.id = match_row.entry_a_id FOR UPDATE;
    winner_id := match_row.entry_a_id;
  ELSE
    RAISE EXCEPTION 'A inscrição desistente precisa pertencer a este confronto.';
  END IF;

  IF withdrawn_entry.id IS NULL OR opposing_entry.id IS NULL
     OR withdrawn_entry.status NOT IN ('confirmed', 'withdrawn', 'disqualified')
     OR opposing_entry.status <> 'confirmed' THEN
    RAISE EXCEPTION 'A inscrição adversária não está elegível para receber o WO.';
  END IF;

  IF match_row.status = 'scheduled' AND EXISTS (
    SELECT 1 FROM public.performances AS p
     WHERE p.id IN (match_row.performance_a_id, match_row.performance_b_id)
       AND p.status NOT IN ('queued')
  ) THEN
    RAISE EXCEPTION 'O confronto já possui apresentação iniciada; registre a desistência como WO durante o confronto.';
  END IF;

  UPDATE public.championship_entries AS e
     SET status = 'withdrawn'
   WHERE e.id = withdrawn_entry.id AND e.status = 'confirmed';

  UPDATE public.performances AS p
     SET status = 'completed', ended_at = clock_timestamp()
   WHERE p.id IN (match_row.performance_a_id, match_row.performance_b_id)
     AND p.status = 'active';

  INSERT INTO public.championship_match_wo_audit (
    match_id, withdrawn_entry_id, winner_entry_id, operator_user_id, reason
  ) VALUES (
    match_row.id, withdrawn_entry.id, winner_id, p_operator_user_id, btrim(p_reason)
  );

  UPDATE public.championship_matches AS m
     SET status = 'wo',
         voting_status = 'closed',
         winner_entry_id = winner_id
   WHERE m.id = match_row.id
   RETURNING m.* INTO match_row;

  IF championship_row.status = 'drawn' THEN
    UPDATE public.championships AS c SET status = 'quarter_finals' WHERE c.id = championship_row.id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'match_id', match_row.id,
    'status', match_row.status,
    'withdrawn_entry_id', withdrawn_entry.id,
    'winner_entry_id', winner_id,
    'operator_user_id', p_operator_user_id
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
  SELECT c.* INTO championship_row
    FROM public.championships AS c
   WHERE c.id = p_championship_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.assert_championship_operator(championship_row.id, p_operator_user_id);

  IF championship_row.status = 'completed' THEN
    SELECT m.* INTO final_match
      FROM public.championship_matches AS m
     WHERE m.championship_id = championship_row.id
       AND m.stage = 'final' AND m.match_number = 1;
    RETURN pg_catalog.jsonb_build_object(
      'championship_id', championship_row.id,
      'status', 'completed',
      'winner_entry_id', final_match.winner_entry_id
    );
  END IF;
  IF championship_row.status <> 'final' THEN
    RAISE EXCEPTION 'O Campeonato só pode ser encerrado após a final.';
  END IF;

  SELECT m.* INTO final_match
    FROM public.championship_matches AS m
   WHERE m.championship_id = championship_row.id
     AND m.stage = 'final' AND m.match_number = 1
   FOR UPDATE;
  IF NOT FOUND OR final_match.status NOT IN ('completed', 'wo') OR final_match.winner_entry_id IS NULL THEN
    RAISE EXCEPTION 'A final ainda não possui um resultado válido.';
  END IF;

  UPDATE public.championships AS c SET status = 'completed' WHERE c.id = championship_row.id
  RETURNING c.* INTO championship_row;

  RETURN pg_catalog.jsonb_build_object(
    'championship_id', championship_row.id,
    'status', championship_row.status,
    'winner_entry_id', final_match.winner_entry_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_championship_operator(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_championship_entry_participant(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_championship_entry_participant(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.guard_championship_match_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_championship_completion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_championship_match_performances(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_championship_match(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_championship_presentation(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_championship_presentation(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_championship_match_voting(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_championship_match_voting(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_championship_match_score(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cast_championship_match_vote(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_championship_elimination(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_championship_match_wo(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_championship(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.assert_championship_operator(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_championship_match_performances(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_championship_match(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_championship_presentation(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_championship_presentation(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_championship_match_voting(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_championship_match_voting(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_championship_match_score(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cast_championship_match_vote(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_championship_elimination(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_championship_match_wo(uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_championship(uuid, uuid) TO service_role;
