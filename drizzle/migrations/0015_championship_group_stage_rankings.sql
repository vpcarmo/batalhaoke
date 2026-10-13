CREATE TABLE public.championship_group_stage_tie_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  championship_id uuid NOT NULL REFERENCES public.championships(id) ON DELETE CASCADE,
  group_letter text CHECK (group_letter IS NULL OR group_letter IN ('A', 'B', 'C', 'D')),
  tied_entry_ids uuid[] NOT NULL,
  criteria_applied text[] NOT NULL CHECK (array_length(criteria_applied, 1) > 0),
  chosen_order uuid[] NOT NULL,
  operator_user_id uuid NOT NULL,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(tied_entry_ids) > 1),
  CHECK (cardinality(chosen_order) = cardinality(tied_entry_ids))
);
ALTER TABLE public.championship_group_stage_tie_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.championship_group_stage_tie_decisions FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON TABLE public.championship_group_stage_tie_decisions TO service_role;
CREATE POLICY championship_group_stage_tie_decisions_service_only
  ON public.championship_group_stage_tie_decisions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
CREATE INDEX championship_group_stage_tie_decisions_champ_idx
  ON public.championship_group_stage_tie_decisions(championship_id, group_letter);
CREATE TRIGGER t_championship_group_stage_tie_decisions
  BEFORE UPDATE ON public.championship_group_stage_tie_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

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

  IF p_tied_entry_ids IS NULL OR cardinality(p_tied_entry_ids) < 2 THEN
    RAISE EXCEPTION 'É necessário informar pelo menos dois participantes empatados.' USING ERRCODE = 'P0001';
  END IF;

  IF p_decision_order IS NULL OR cardinality(p_decision_order) <> cardinality(p_tied_entry_ids) THEN
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

  SELECT array_agg(DISTINCT item ORDER BY item)
    INTO tied_set
    FROM unnest(p_tied_entry_ids) AS item;

  SELECT array_agg(DISTINCT item ORDER BY item)
    INTO chosen_set
    FROM unnest(p_decision_order) AS item;

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
    p_tied_entry_ids,
    p_criteria_applied,
    p_decision_order,
    p_operator_user_id,
    p_rationale
  );

  RETURN jsonb_build_object(
    'championship_id', p_championship_id,
    'group_letter', p_group_letter,
    'tied_entry_ids', to_jsonb(p_tied_entry_ids),
    'criteria_applied', to_jsonb(p_criteria_applied),
    'chosen_order', to_jsonb(p_decision_order),
    'operator_user_id', p_operator_user_id,
    'rationale', p_rationale
  );
END $$;

CREATE OR REPLACE FUNCTION public.finalize_group_stage_and_generate_quarters(
  p_championship_id uuid,
  p_operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  championship_row public.championships%ROWTYPE;
  stage_session_id uuid;
  unresolved_group_ties boolean;
  unresolved_third_ties boolean;
BEGIN
  SELECT *
    INTO championship_row
    FROM public.championships
   WHERE id = p_championship_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campeonato não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF championship_row.status <> 'group_stage' THEN
    RAISE EXCEPTION 'A classificação da fase de grupos só pode ser finalizada no estado group_stage.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format = 8 THEN
    RAISE EXCEPTION 'O formato 8 não possui fase de grupos.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format NOT IN (12, 16) THEN
    RAISE EXCEPTION 'Formato de Campeonato inválido.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.championship_matches AS m
     WHERE m.championship_id = p_championship_id
       AND m.stage = 'quarter_final'
  ) THEN
    RAISE EXCEPTION 'As quartas de final deste Campeonato já foram geradas.' USING ERRCODE = 'P0001';
  END IF;

  SELECT s.id
    INTO stage_session_id
    FROM public.sessions AS s
   WHERE s.championship_id = p_championship_id
     AND s.session_type = 'championship'
   LIMIT 1;

  IF stage_session_id IS NULL THEN
    RAISE EXCEPTION 'A sessão de palco do Campeonato não foi preparada.' USING ERRCODE = 'P0001';
  END IF;

  WITH stage_entries AS (
    SELECT
      e.id AS entry_id,
      e.group_letter,
      e.seed_number,
      COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) AS likes,
      COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) AS dislikes,
      CASE
        WHEN COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) = 0 THEN 0
        ELSE (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END)::numeric / (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END))) * 100
      END AS approval
    FROM public.championship_entries AS e
    LEFT JOIN public.participants AS p
      ON p.id = e.participant_id
    LEFT JOIN public.performances AS pr
      ON pr.participant_id = p.id
     AND pr.session_id = stage_session_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.championship_matches AS cm
        WHERE cm.championship_id = p_championship_id
          AND (cm.performance_a_id = pr.id OR cm.performance_b_id = pr.id)
     )
    LEFT JOIN public.votes AS v
      ON v.performance_id = pr.id
   WHERE e.championship_id = p_championship_id
     AND e.status = 'confirmed'
   GROUP BY e.id, e.group_letter, e.seed_number
  ),
  group_ties AS (
    SELECT
      se.group_letter,
      array_agg(se.entry_id ORDER BY se.entry_id) AS tied_entry_ids
    FROM stage_entries AS se
    GROUP BY se.group_letter, se.approval, se.likes, se.dislikes
    HAVING count(*) > 1
  )
  SELECT EXISTS (
    SELECT 1
      FROM group_ties AS gt
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.championship_group_stage_tie_decisions AS d
        WHERE d.championship_id = p_championship_id
          AND d.group_letter IS NOT DISTINCT FROM gt.group_letter
          AND d.tied_entry_ids = gt.tied_entry_ids
     )
  )
    INTO unresolved_group_ties;

  IF unresolved_group_ties THEN
    RAISE EXCEPTION 'Todos os empates da fase de grupos exigem uma decisão manual do operador.' USING ERRCODE = 'P0001';
  END IF;

  IF championship_row.format = 12 THEN
    WITH stage_entries AS (
      SELECT
        e.id AS entry_id,
        e.group_letter,
        e.seed_number,
        COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) AS likes,
        COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) AS dislikes,
        CASE
          WHEN COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) = 0 THEN 0
          ELSE (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END)::numeric / (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END))) * 100
        END AS approval
      FROM public.championship_entries AS e
      LEFT JOIN public.participants AS p
        ON p.id = e.participant_id
      LEFT JOIN public.performances AS pr
        ON pr.participant_id = p.id
       AND pr.session_id = stage_session_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.championship_matches AS cm
          WHERE cm.championship_id = p_championship_id
            AND (cm.performance_a_id = pr.id OR cm.performance_b_id = pr.id)
       )
      LEFT JOIN public.votes AS v
        ON v.performance_id = pr.id
     WHERE e.championship_id = p_championship_id
       AND e.status = 'confirmed'
     GROUP BY e.id, e.group_letter, e.seed_number
    ),
    group_ties AS (
      SELECT
        se.group_letter,
        se.approval,
        se.likes,
        se.dislikes,
        array_agg(se.entry_id ORDER BY se.entry_id) AS tied_entry_ids
      FROM stage_entries AS se
      GROUP BY se.group_letter, se.approval, se.likes, se.dislikes
      HAVING count(*) > 1
    ),
    ranked_entries AS (
      SELECT
        se.entry_id,
        se.group_letter,
        se.likes,
        se.dislikes,
        se.approval,
        (
          SELECT array_position(d.chosen_order, se.entry_id)
            FROM public.championship_group_stage_tie_decisions AS d
           WHERE d.championship_id = p_championship_id
             AND d.group_letter IS NOT DISTINCT FROM se.group_letter
             AND d.tied_entry_ids = gt.tied_entry_ids
           LIMIT 1
        ) AS manual_order_rank
      FROM stage_entries AS se
      LEFT JOIN group_ties AS gt
        ON gt.group_letter = se.group_letter
       AND gt.tied_entry_ids @> ARRAY[se.entry_id]
    ),
    group_rankings AS (
      SELECT
        re.entry_id,
        re.group_letter,
        re.likes,
        re.dislikes,
        re.approval,
        ROW_NUMBER() OVER (
          PARTITION BY re.group_letter
          ORDER BY re.approval DESC, re.likes DESC, re.dislikes ASC, re.manual_order_rank ASC NULLS LAST
        ) AS group_position
      FROM ranked_entries AS re
    ),
    third_ties AS (
      SELECT array_agg(tp.entry_id ORDER BY tp.entry_id) AS tied_entry_ids
        FROM (
          SELECT *
            FROM group_rankings
           WHERE group_position = 3
        ) AS tp
       GROUP BY tp.approval, tp.likes, tp.dislikes
      HAVING count(*) > 1
    )
    SELECT EXISTS (
      SELECT 1
        FROM third_ties AS tt
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.championship_group_stage_tie_decisions AS d
          WHERE d.championship_id = p_championship_id
            AND d.group_letter IS NULL
            AND d.tied_entry_ids = tt.tied_entry_ids
       )
    )
      INTO unresolved_third_ties;

    IF unresolved_third_ties THEN
      RAISE EXCEPTION 'Os terceiros classificados empatados precisam de uma decisão manual do operador.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.championships
     SET status = 'group_stage_completed'
   WHERE id = p_championship_id;

  IF championship_row.format = 12 THEN
    WITH stage_entries AS (
      SELECT
        e.id AS entry_id,
        e.group_letter,
        e.seed_number,
        COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) AS likes,
        COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) AS dislikes,
        CASE
          WHEN COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) = 0 THEN 0
          ELSE (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END)::numeric / (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END))) * 100
        END AS approval
      FROM public.championship_entries AS e
      LEFT JOIN public.participants AS p
        ON p.id = e.participant_id
      LEFT JOIN public.performances AS pr
        ON pr.participant_id = p.id
       AND pr.session_id = stage_session_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.championship_matches AS cm
          WHERE cm.championship_id = p_championship_id
            AND (cm.performance_a_id = pr.id OR cm.performance_b_id = pr.id)
       )
      LEFT JOIN public.votes AS v
        ON v.performance_id = pr.id
     WHERE e.championship_id = p_championship_id
       AND e.status = 'confirmed'
     GROUP BY e.id, e.group_letter, e.seed_number
    ),
    group_ties AS (
      SELECT
        se.group_letter,
        se.approval,
        se.likes,
        se.dislikes,
        array_agg(se.entry_id ORDER BY se.entry_id) AS tied_entry_ids
      FROM stage_entries AS se
      GROUP BY se.group_letter, se.approval, se.likes, se.dislikes
      HAVING count(*) > 1
    ),
    ranked_entries AS (
      SELECT
        se.entry_id,
        se.group_letter,
        se.likes,
        se.dislikes,
        se.approval,
        (
          SELECT array_position(d.chosen_order, se.entry_id)
            FROM public.championship_group_stage_tie_decisions AS d
           WHERE d.championship_id = p_championship_id
             AND d.group_letter IS NOT DISTINCT FROM se.group_letter
             AND d.tied_entry_ids = gt.tied_entry_ids
           LIMIT 1
        ) AS manual_order_rank
      FROM stage_entries AS se
      LEFT JOIN group_ties AS gt
        ON gt.group_letter = se.group_letter
       AND gt.tied_entry_ids @> ARRAY[se.entry_id]
    ),
    group_rankings AS (
      SELECT
        re.entry_id,
        re.group_letter,
        re.likes,
        re.dislikes,
        re.approval,
        ROW_NUMBER() OVER (
          PARTITION BY re.group_letter
          ORDER BY re.approval DESC, re.likes DESC, re.dislikes ASC, re.manual_order_rank ASC NULLS LAST
        ) AS group_position
      FROM ranked_entries AS re
    ),
    third_candidates AS (
      SELECT
        gr.entry_id,
        gr.group_letter,
        gr.likes,
        gr.dislikes,
        gr.approval,
        COALESCE(
          (
            SELECT array_position(d.chosen_order, gr.entry_id)
              FROM public.championship_group_stage_tie_decisions AS d
             WHERE d.championship_id = p_championship_id
               AND d.group_letter IS NULL
               AND d.tied_entry_ids = tt.tied_entry_ids
             LIMIT 1
          ),
          2147483647
        ) AS manual_order_rank
      FROM group_rankings AS gr
      LEFT JOIN (
        SELECT approval, likes, dislikes, array_agg(entry_id ORDER BY entry_id) AS tied_entry_ids
          FROM group_rankings
         WHERE group_position = 3
         GROUP BY approval, likes, dislikes
        HAVING count(*) > 1
      ) AS tt
        ON tt.approval = gr.approval
       AND tt.likes = gr.likes
       AND tt.dislikes = gr.dislikes
     WHERE gr.group_position = 3
    ),
    third_places AS (
      SELECT entry_id
        FROM third_candidates
       ORDER BY approval DESC, likes DESC, dislikes ASC, manual_order_rank ASC
       LIMIT 2
    )
    INSERT INTO public.championship_matches (championship_id, stage, match_number, entry_a_id, entry_b_id)
    SELECT p_championship_id, 'quarter_final', match_number, entry_a_id, entry_b_id
      FROM (
        SELECT 1 AS match_number,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'A' AND group_position = 1) AS entry_a_id,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'B' AND group_position = 2) AS entry_b_id
        UNION ALL
        SELECT 2,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'B' AND group_position = 1),
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'A' AND group_position = 2)
        UNION ALL
        SELECT 3,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'C' AND group_position = 1),
               (SELECT entry_id FROM third_places OFFSET 1 LIMIT 1)
        UNION ALL
        SELECT 4,
               (SELECT entry_id FROM third_places LIMIT 1),
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'C' AND group_position = 2)
      ) AS slot_values;
  END IF;

  IF championship_row.format = 16 THEN
    WITH stage_entries AS (
      SELECT
        e.id AS entry_id,
        e.group_letter,
        e.seed_number,
        COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) AS likes,
        COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) AS dislikes,
        CASE
          WHEN COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END) = 0 THEN 0
          ELSE (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END)::numeric / (COUNT(CASE WHEN v.vote_type = 'like' THEN 1 END) + COUNT(CASE WHEN v.vote_type = 'dislike' THEN 1 END))) * 100
        END AS approval
      FROM public.championship_entries AS e
      LEFT JOIN public.participants AS p
        ON p.id = e.participant_id
      LEFT JOIN public.performances AS pr
        ON pr.participant_id = p.id
       AND pr.session_id = stage_session_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.championship_matches AS cm
          WHERE cm.championship_id = p_championship_id
            AND (cm.performance_a_id = pr.id OR cm.performance_b_id = pr.id)
       )
      LEFT JOIN public.votes AS v
        ON v.performance_id = pr.id
     WHERE e.championship_id = p_championship_id
       AND e.status = 'confirmed'
     GROUP BY e.id, e.group_letter, e.seed_number
    ),
    group_ties AS (
      SELECT
        se.group_letter,
        se.approval,
        se.likes,
        se.dislikes,
        array_agg(se.entry_id ORDER BY se.entry_id) AS tied_entry_ids
      FROM stage_entries AS se
      GROUP BY se.group_letter, se.approval, se.likes, se.dislikes
      HAVING count(*) > 1
    ),
    ranked_entries AS (
      SELECT
        se.entry_id,
        se.group_letter,
        se.likes,
        se.dislikes,
        se.approval,
        (
          SELECT array_position(d.chosen_order, se.entry_id)
            FROM public.championship_group_stage_tie_decisions AS d
           WHERE d.championship_id = p_championship_id
             AND d.group_letter IS NOT DISTINCT FROM se.group_letter
             AND d.tied_entry_ids = gt.tied_entry_ids
           LIMIT 1
        ) AS manual_order_rank
      FROM stage_entries AS se
      LEFT JOIN group_ties AS gt
        ON gt.group_letter = se.group_letter
       AND gt.tied_entry_ids @> ARRAY[se.entry_id]
    ),
    group_rankings AS (
      SELECT
        re.entry_id,
        re.group_letter,
        ROW_NUMBER() OVER (
          PARTITION BY re.group_letter
          ORDER BY re.approval DESC, re.likes DESC, re.dislikes ASC, re.manual_order_rank ASC NULLS LAST
        ) AS group_position
      FROM ranked_entries AS re
    )
    INSERT INTO public.championship_matches (championship_id, stage, match_number, entry_a_id, entry_b_id)
    SELECT p_championship_id, 'quarter_final', match_number, entry_a_id, entry_b_id
      FROM (
        SELECT 1 AS match_number,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'A' AND group_position = 1) AS entry_a_id,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'B' AND group_position = 2) AS entry_b_id
        UNION ALL
        SELECT 2,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'B' AND group_position = 1),
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'A' AND group_position = 2)
        UNION ALL
        SELECT 3,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'C' AND group_position = 1),
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'D' AND group_position = 2)
        UNION ALL
        SELECT 4,
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'D' AND group_position = 1),
               (SELECT entry_id FROM group_rankings WHERE group_letter = 'C' AND group_position = 2)
      ) AS slot_values;
  END IF;

  UPDATE public.championships
     SET status = 'quarter_finals'
   WHERE id = p_championship_id;

  RETURN jsonb_build_object(
    'championship_id', p_championship_id,
    'status', 'quarter_finals',
    'format', championship_row.format,
    'quarter_final_matches', 4
  );
END $$;

REVOKE ALL ON FUNCTION public.record_group_stage_tie_break(uuid, text, uuid[], text[], uuid[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_group_stage_tie_break(uuid, text, uuid[], text[], uuid[], text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_group_stage_and_generate_quarters(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_group_stage_and_generate_quarters(uuid, uuid) TO service_role;
