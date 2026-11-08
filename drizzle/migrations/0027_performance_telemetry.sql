CREATE TABLE public.performance_measurements (
  performance_id uuid PRIMARY KEY REFERENCES public.performances(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE RESTRICT,
  venue_id uuid REFERENCES public.venues(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'measuring' CHECK (status IN ('measuring','qualified','finalized')),
  accumulated_ms integer NOT NULL DEFAULT 0 CHECK (accumulated_ms >= 0),
  last_state text CHECK (last_state IN ('unstarted','playing','paused','buffering','ended','error')),
  last_received_at timestamptz,
  last_position_seconds double precision CHECK (last_position_seconds IS NULL OR last_position_seconds >= 0),
  last_sequence bigint NOT NULL DEFAULT -1,
  player_instance_id uuid,
  player_epoch_id uuid,
  lease_expires_at timestamptz,
  qualified_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.account_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE RESTRICT,
  performance_id uuid NOT NULL REFERENCES public.performances(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('qualified_performance','adjustment','reversal','other')),
  execution_quantity integer NOT NULL CHECK (execution_quantity <> 0),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL UNIQUE,
  rule_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_usage_one_qualification_per_performance
  ON public.account_usage_ledger(performance_id) WHERE entry_type = 'qualified_performance';
CREATE INDEX account_usage_account_date_idx ON public.account_usage_ledger(account_id, consumed_at DESC);

ALTER TABLE public.performance_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_usage_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.performance_measurements, public.account_usage_ledger FROM anon, authenticated;
GRANT ALL ON public.performance_measurements, public.account_usage_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_performance_measurement(
  p_performance_id uuid, p_instance_id uuid, p_provider text
) RETURNS TABLE(epoch_id uuid, accumulated_ms integer, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.performances%ROWTYPE; s public.sessions%ROWTYPE; v_account_id uuid;
  m public.performance_measurements%ROWTYPE; new_epoch uuid;
BEGIN
  SELECT * INTO p FROM public.performances WHERE id = p_performance_id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'active' THEN RAISE EXCEPTION 'performance_not_active'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id = p.session_id;
  IF NOT FOUND OR s.status <> 'active' OR s.venue_id IS NULL THEN RAISE EXCEPTION 'session_not_active'; END IF;
  SELECT account_id INTO v_account_id FROM public.venues WHERE id = s.venue_id;
  INSERT INTO public.performance_measurements(performance_id,session_id,venue_id,account_id,provider)
    VALUES(p.id,s.id,s.venue_id,v_account_id,p_provider) ON CONFLICT(performance_id) DO NOTHING;
  SELECT * INTO m FROM public.performance_measurements WHERE performance_id=p.id FOR UPDATE;
  IF m.status='finalized' THEN RAISE EXCEPTION 'measurement_finalized'; END IF;
  IF m.lease_expires_at > now() AND m.player_instance_id <> p_instance_id THEN RAISE EXCEPTION 'measurement_lease_held'; END IF;
  new_epoch := gen_random_uuid();
  UPDATE public.performance_measurements SET player_instance_id=p_instance_id, player_epoch_id=new_epoch,
    lease_expires_at=now()+interval '15 seconds', last_state=NULL, last_received_at=NULL,
    last_position_seconds=NULL, updated_at=now() WHERE performance_id=p.id;
  RETURN QUERY SELECT new_epoch,m.accumulated_ms,now()+interval '15 seconds';
END $$;

CREATE OR REPLACE FUNCTION public.record_performance_heartbeat(
  p_performance_id uuid,p_instance_id uuid,p_epoch_id uuid,p_sequence bigint,p_state text,p_position_seconds double precision
) RETURNS TABLE(accepted boolean, accumulated_ms integer, qualified boolean, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.performance_measurements%ROWTYPE; p public.performances%ROWTYPE; s public.sessions%ROWTYPE;
  t timestamptz := clock_timestamp(); delta_ms integer := 0; why text := NULL;
BEGIN
  IF p_state NOT IN ('unstarted','playing','paused','buffering','ended','error') OR p_position_seconds IS NULL OR p_position_seconds < 0 THEN
    RAISE EXCEPTION 'invalid_heartbeat';
  END IF;
  SELECT * INTO m FROM public.performance_measurements WHERE performance_id=p_performance_id FOR UPDATE;
  IF NOT FOUND OR m.status='finalized' OR m.player_instance_id<>p_instance_id OR m.player_epoch_id<>p_epoch_id OR m.lease_expires_at<=t THEN
    RAISE EXCEPTION 'invalid_measurement_lease';
  END IF;
  IF p_sequence=m.last_sequence THEN RETURN QUERY SELECT false,m.accumulated_ms,m.status='qualified','duplicate'::text; RETURN; END IF;
  IF p_sequence<m.last_sequence THEN RETURN QUERY SELECT false,m.accumulated_ms,m.status='qualified','out_of_order'::text; RETURN; END IF;
  SELECT * INTO p FROM public.performances WHERE id=p_performance_id;
  SELECT * INTO s FROM public.sessions WHERE id=p.session_id;
  IF p.status<>'active' OR s.status<>'active' THEN RAISE EXCEPTION 'performance_not_active'; END IF;
  IF m.last_state='playing' AND p_state='playing' AND m.last_received_at IS NOT NULL THEN
    IF t-m.last_received_at > interval '7 seconds' THEN why:='gap';
    ELSIF p_position_seconds-m.last_position_seconds < 0
      OR abs((p_position_seconds-m.last_position_seconds)-extract(epoch from (t-m.last_received_at))) > 2 THEN why:='seek';
    ELSE delta_ms:=floor(extract(epoch from (t-m.last_received_at))*1000)::integer; END IF;
  END IF;
  UPDATE public.performance_measurements SET accumulated_ms=accumulated_ms+delta_ms,
    status=CASE WHEN accumulated_ms+delta_ms>=30000 THEN 'qualified' ELSE status END,
    qualified_at=CASE WHEN accumulated_ms<30000 AND accumulated_ms+delta_ms>=30000 THEN t ELSE qualified_at END,
    last_state=p_state,last_received_at=t,last_position_seconds=p_position_seconds,last_sequence=p_sequence,
    lease_expires_at=t+interval '15 seconds',updated_at=t WHERE performance_id=p_performance_id RETURNING * INTO m;
  IF m.status='qualified' AND m.account_id IS NOT NULL THEN
    INSERT INTO public.account_usage_ledger(account_id,venue_id,session_id,performance_id,entry_type,execution_quantity,idempotency_key,rule_metadata,consumed_at)
    VALUES(m.account_id,m.venue_id,m.session_id,m.performance_id,'qualified_performance',1,'performance:'||m.performance_id::text,
      jsonb_build_object('threshold_ms',30000,'max_interval_ms',7000,'source','confirmed_playback_heartbeats'),m.qualified_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN QUERY SELECT true,m.accumulated_ms,m.status='qualified',why;
END $$;

CREATE OR REPLACE FUNCTION public.finalize_performance_measurement(p_performance_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
 UPDATE public.performance_measurements SET status='finalized',finalized_at=coalesce(finalized_at,now()),
 last_state='ended',lease_expires_at=NULL,updated_at=now() WHERE performance_id=p_performance_id AND status<>'finalized';
$$;
REVOKE ALL ON FUNCTION public.acquire_performance_measurement(uuid,uuid,text), public.record_performance_heartbeat(uuid,uuid,uuid,bigint,text,double precision), public.finalize_performance_measurement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_performance_measurement(uuid,uuid,text), public.record_performance_heartbeat(uuid,uuid,uuid,bigint,text,double precision), public.finalize_performance_measurement(uuid) TO service_role;
