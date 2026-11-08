-- Separate paired TV leases from authenticated local player leases.
ALTER TABLE public.performance_measurements
  ADD COLUMN lease_kind text NOT NULL DEFAULT 'local' CHECK (lease_kind IN ('local','tv')),
  ADD COLUMN lease_device_id uuid REFERENCES public.venue_devices(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.acquire_performance_measurement(
  p_performance_id uuid, p_instance_id uuid, p_provider text,
  p_lease_kind text DEFAULT 'local', p_device_id uuid DEFAULT NULL
) RETURNS TABLE(epoch_id uuid, accumulated_ms integer, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.performances%ROWTYPE; s public.sessions%ROWTYPE; v_account_id uuid;
  m public.performance_measurements%ROWTYPE; new_epoch uuid; t timestamptz := clock_timestamp();
BEGIN
  IF p_lease_kind NOT IN ('local','tv') OR (p_lease_kind='tv' AND p_device_id IS NULL)
     OR (p_lease_kind='local' AND p_device_id IS NOT NULL) THEN RAISE EXCEPTION 'invalid_measurement_owner'; END IF;
  SELECT * INTO p FROM public.performances WHERE id=p_performance_id FOR UPDATE;
  IF NOT FOUND OR p.status<>'active' THEN RAISE EXCEPTION 'performance_not_active'; END IF;
  SELECT * INTO s FROM public.sessions WHERE id=p.session_id;
  IF NOT FOUND OR s.status<>'active' OR s.venue_id IS NULL THEN RAISE EXCEPTION 'session_not_active'; END IF;
  IF p_lease_kind='tv' AND NOT EXISTS (SELECT 1 FROM public.venue_devices d WHERE d.id=p_device_id AND d.venue_id=s.venue_id AND d.status='paired')
    THEN RAISE EXCEPTION 'invalid_tv_device'; END IF;
  SELECT account_id INTO v_account_id FROM public.venues WHERE id=s.venue_id;
  INSERT INTO public.performance_measurements(performance_id,session_id,venue_id,account_id,provider)
    VALUES(p.id,s.id,s.venue_id,v_account_id,p_provider) ON CONFLICT(performance_id) DO NOTHING;
  SELECT * INTO m FROM public.performance_measurements WHERE performance_id=p.id FOR UPDATE;
  IF m.status='finalized' THEN RAISE EXCEPTION 'measurement_finalized'; END IF;
  IF m.lease_expires_at>t THEN
    IF m.lease_kind='tv' AND p_lease_kind='local' THEN RAISE EXCEPTION 'measurement_tv_priority'; END IF;
    IF m.lease_kind='tv' AND p_lease_kind='tv' AND (m.lease_device_id<>p_device_id OR m.player_instance_id<>p_instance_id) THEN RAISE EXCEPTION 'measurement_tv_held'; END IF;
    IF m.lease_kind='local' AND p_lease_kind='local' AND m.player_instance_id<>p_instance_id THEN RAISE EXCEPTION 'measurement_lease_held'; END IF;
    IF m.lease_kind=p_lease_kind AND m.player_instance_id=p_instance_id AND coalesce(m.lease_device_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_device_id,'00000000-0000-0000-0000-000000000000'::uuid) THEN
      UPDATE public.performance_measurements SET lease_expires_at=t+interval '15 seconds',updated_at=t WHERE performance_id=p.id;
      RETURN QUERY SELECT m.player_epoch_id,m.accumulated_ms,t+interval '15 seconds'; RETURN;
    END IF;
  END IF;
  new_epoch:=gen_random_uuid();
  UPDATE public.performance_measurements SET player_instance_id=p_instance_id,player_epoch_id=new_epoch,
    lease_kind=p_lease_kind,lease_device_id=p_device_id,lease_expires_at=t+interval '15 seconds',
    last_state=NULL,last_received_at=NULL,last_position_seconds=NULL,last_sequence=-1,updated_at=t WHERE performance_id=p.id;
  RETURN QUERY SELECT new_epoch,m.accumulated_ms,t+interval '15 seconds';
END $$;
REVOKE ALL ON FUNCTION public.acquire_performance_measurement(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_performance_measurement(uuid,uuid,text,text,uuid) TO service_role;
