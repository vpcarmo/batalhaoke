-- Apply manually after 0033.
BEGIN;
ALTER TABLE public.commercial_settings ADD COLUMN trial_venue_limit integer NOT NULL DEFAULT 1 CHECK(trial_venue_limit>=1);
CREATE OR REPLACE FUNCTION public.enforce_commercial_venue_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_enabled boolean; v_global boolean; v_limit integer; v_count integer; v_plan jsonb;
BEGIN
 IF NEW.account_id IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.accounts WHERE id=NEW.account_id FOR UPDATE;
 SELECT billing_enabled INTO v_global FROM public.commercial_settings WHERE id=true;
 SELECT billing_enabled,venue_limit_override INTO v_enabled,v_limit FROM public.commercial_account_settings WHERE account_id=NEW.account_id;
 IF NOT coalesce(v_global,false) OR NOT coalesce(v_enabled,false) THEN RETURN NEW; END IF;
 IF v_limit IS NULL THEN
   SELECT s.plan_snapshot INTO v_plan FROM public.account_subscriptions s WHERE s.account_id=NEW.account_id AND s.status='active' ORDER BY s.created_at DESC LIMIT 1;
   IF v_plan IS NOT NULL THEN
     v_limit:=coalesce((v_plan->>'venue_limit')::integer,0);
   ELSIF EXISTS(SELECT 1 FROM public.account_trials WHERE account_id=NEW.account_id
     AND status='active' AND starts_at<=now() AND ends_at>now()) THEN
     SELECT trial_venue_limit INTO v_limit FROM public.commercial_settings WHERE id=true;
   ELSE
     v_limit:=0;
   END IF;
 END IF;
 SELECT count(*) INTO v_count FROM public.venues WHERE account_id=NEW.account_id AND (TG_OP='INSERT' OR id<>NEW.id);
 IF v_count >= v_limit THEN RAISE EXCEPTION 'commercial_venue_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;


REVOKE ALL ON FUNCTION public.enforce_commercial_venue_limit() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.confirm_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.execution_reservations%ROWTYPE; v_usage uuid; v_lot public.credit_wallet_ledger%ROWTYPE; v_balance integer;
BEGIN
 IF NEW.entry_type<>'qualified_performance' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.execution_reservations WHERE performance_id=NEW.performance_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF r.status='consumed' THEN RETURN NEW; END IF;
 IF r.status='released' THEN RAISE EXCEPTION 'commercial_reservation_released'; END IF;
 NEW.billing_period_id:=r.billing_period_id;
 IF r.source='credit' THEN
  PERFORM 1 FROM public.accounts WHERE id=r.account_id FOR UPDATE;
  SELECT id INTO v_usage FROM public.credit_wallet_ledger WHERE idempotency_key='usage:'||NEW.performance_id::text;
  IF v_usage IS NULL OR NOT EXISTS(SELECT 1 FROM public.commercial_credit_allocations WHERE usage_entry_id=v_usage) THEN
   IF v_usage IS NULL THEN
    SELECT coalesce(sum(quantity),0) INTO v_balance FROM public.credit_wallet_ledger
     WHERE account_id=r.account_id AND (expires_at IS NULL OR expires_at>now());
    IF v_balance<=0 THEN RAISE EXCEPTION 'commercial_quota_exhausted'; END IF;
   END IF;
   SELECT p.* INTO v_lot FROM public.credit_wallet_ledger p
    WHERE p.account_id=r.account_id AND p.entry_type IN ('purchase','grant') AND p.quantity>0
     AND (p.expires_at IS NULL OR p.expires_at>now())
     AND p.quantity>coalesce((SELECT sum(a.quantity) FROM public.commercial_credit_allocations a WHERE a.purchase_entry_id=p.id),0)
       +coalesce((SELECT -sum(ref.quantity) FROM public.credit_wallet_ledger ref WHERE ref.order_id=p.order_id AND ref.entry_type='refund'),0)
    ORDER BY p.created_at,p.id LIMIT 1 FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'commercial_credit_lot_unavailable'; END IF;
   IF v_usage IS NULL THEN
    -- Expiration of the debit follows its lot, preventing an artificial negative balance after expiry.
    INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,performance_id,idempotency_key,expires_at)
     VALUES(r.account_id,-1,'usage','qualified_performance',NEW.performance_id,'usage:'||NEW.performance_id::text,v_lot.expires_at)
     RETURNING id INTO v_usage;
   END IF;
   INSERT INTO public.commercial_credit_allocations(purchase_entry_id,usage_entry_id,quantity)
    VALUES(v_lot.id,v_usage,1) ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 UPDATE public.execution_reservations SET status='consumed',resolved_at=now() WHERE performance_id=NEW.performance_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.confirm_commercial_execution() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.authorize_commercial_playback(p_performance_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_global boolean; v_enabled boolean; v_account uuid;
BEGIN
 SELECT v.account_id INTO v_account FROM public.performances p JOIN public.sessions s ON s.id=p.session_id
 JOIN public.venues v ON v.id=s.venue_id WHERE p.id=p_performance_id AND p.status='active' AND s.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'performance_not_active'; END IF;
 SELECT billing_enabled INTO v_global FROM public.commercial_settings WHERE id=true;
 IF v_global IS NULL THEN RAISE EXCEPTION 'commercial_settings_unavailable'; END IF;
 IF v_global=false OR v_account IS NULL THEN RETURN false; END IF;
 SELECT billing_enabled INTO v_enabled FROM public.commercial_account_settings WHERE account_id=v_account;
 IF v_enabled=false THEN RETURN false; END IF;
 IF v_enabled IS NULL THEN RAISE EXCEPTION 'commercial_settings_unavailable'; END IF;
 -- Also covers presentations already active when 0034 is installed.
 INSERT INTO public.performance_measurements(performance_id,session_id,venue_id,account_id,provider)
 SELECT p.id,s.id,s.venue_id,v_account,coalesce(ps.provider,'unknown')
 FROM public.performances p JOIN public.sessions s ON s.id=p.session_id
 LEFT JOIN public.playback_sources ps ON ps.id=p.playback_source_id
 WHERE p.id=p_performance_id ON CONFLICT(performance_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.execution_reservations WHERE performance_id=p_performance_id
 AND account_id=v_account AND source<>'unmetered' AND status IN ('reserved','consumed')) THEN
 RAISE EXCEPTION 'commercial_authorization_required'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.authorize_commercial_playback(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_commercial_playback(uuid) TO service_role;

-- Reserve in the activation transaction, including dispute flows and direct SQL updates.
CREATE OR REPLACE FUNCTION public.authorize_commercial_performance_start()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.sessions%ROWTYPE; v_account uuid; v_provider text;
BEGIN
 IF NEW.status<>'active' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='active' THEN RETURN NEW; END IF;
 SELECT * INTO s FROM public.sessions WHERE id=NEW.session_id;
 IF s.venue_id IS NULL THEN RETURN NEW; END IF;
 SELECT account_id INTO v_account FROM public.venues WHERE id=s.venue_id;
 SELECT provider INTO v_provider FROM public.playback_sources WHERE id=NEW.playback_source_id;
 INSERT INTO public.performance_measurements(performance_id,session_id,venue_id,account_id,provider)
 VALUES(NEW.id,s.id,s.venue_id,v_account,coalesce(v_provider,'unknown')) ON CONFLICT DO NOTHING;
 IF v_account IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.execution_reservations WHERE performance_id=NEW.id AND status IN ('reserved','consumed')) THEN
 RAISE EXCEPTION 'commercial_authorization_required'; END IF;
 PERFORM public.authorize_commercial_playback(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER performance_commercial_start AFTER INSERT OR UPDATE OF status ON public.performances
FOR EACH ROW EXECUTE FUNCTION public.authorize_commercial_performance_start();
REVOKE ALL ON FUNCTION public.authorize_commercial_performance_start() FROM PUBLIC,anon,authenticated;

CREATE TABLE public.commercial_cron_lock (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), token uuid NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE public.commercial_cron_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_cron_lock FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.commercial_cron_lock TO service_role;
CREATE FUNCTION public.acquire_commercial_cron_lock(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_token IS NULL THEN RAISE EXCEPTION 'invalid_lock_token'; END IF;
 INSERT INTO public.commercial_cron_lock(id,token,expires_at) VALUES(true,p_token,clock_timestamp()+interval '2 minutes')
 ON CONFLICT(id) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at
 WHERE public.commercial_cron_lock.expires_at<=clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.renew_commercial_cron_lock(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.commercial_cron_lock SET expires_at=clock_timestamp()+interval '2 minutes'
 WHERE id=true AND token=p_token AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION public.release_commercial_cron_lock(p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM public.commercial_cron_lock WHERE id=true AND token=p_token;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.acquire_commercial_cron_lock(uuid),public.renew_commercial_cron_lock(uuid),public.release_commercial_cron_lock(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_commercial_cron_lock(uuid),public.renew_commercial_cron_lock(uuid),public.release_commercial_cron_lock(uuid) TO service_role;

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
  IF m.account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.execution_reservations WHERE performance_id=p.id AND status IN ('reserved','consumed')) THEN RAISE EXCEPTION 'commercial_authorization_required'; END IF;
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

-- Fence the final lifecycle transaction against expired or superseded workers.
CREATE FUNCTION public.run_locked_commercial_lifecycle(p_token uuid,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.commercial_cron_lock WHERE id=true AND token=p_token AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_cron_lock_lost'; END IF;
 RETURN public.process_commercial_lifecycle(p_limit);
END $$;
REVOKE ALL ON FUNCTION public.run_locked_commercial_lifecycle(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_locked_commercial_lifecycle(uuid,integer) TO service_role;

-- Each write is fenced within the same transaction as the ownership check.
CREATE FUNCTION public.apply_locked_commercial_payment(
 p_token uuid,p_external_reference text,p_payment_id text,p_status text,p_paid_at timestamptz,p_amount_cents integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.commercial_cron_lock WHERE id=true AND token=p_token AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_cron_lock_lost'; END IF;
 PERFORM public.apply_commercial_payment(p_external_reference,p_payment_id,p_status,p_paid_at,p_amount_cents);
END $$;
CREATE FUNCTION public.write_locked_commercial_verification(p_token uuid,p_subscription_id uuid,p_remote_status text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM 1 FROM public.commercial_cron_lock WHERE id=true AND token=p_token AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_cron_lock_lost'; END IF;
 IF p_remote_status IS NULL THEN
 DELETE FROM public.commercial_lifecycle_verifications WHERE subscription_id=p_subscription_id;
 ELSE
 INSERT INTO public.commercial_lifecycle_verifications(subscription_id,remote_status,checked_at)
 VALUES(p_subscription_id,p_remote_status,clock_timestamp()) ON CONFLICT(subscription_id)
 DO UPDATE SET remote_status=EXCLUDED.remote_status,checked_at=EXCLUDED.checked_at;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.apply_locked_commercial_payment(uuid,text,text,text,timestamptz,integer),public.write_locked_commercial_verification(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_locked_commercial_payment(uuid,text,text,text,timestamptz,integer),public.write_locked_commercial_verification(uuid,uuid,text) TO service_role;

COMMIT;
