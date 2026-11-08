-- Harden commercial reservations and venue limits after the account model is deployed.
-- Locking the parent account row serializes every commercial decision even when
-- optional per-account settings have not yet been materialized.
CREATE OR REPLACE FUNCTION public.reserve_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account uuid; v_period public.account_billing_periods%ROWTYPE; v_sub public.account_subscriptions%ROWTYPE;
  v_enabled boolean; v_global boolean; v_trial boolean; v_used integer; v_held integer; v_balance integer;
BEGIN
 SELECT account_id INTO v_account FROM public.performance_measurements WHERE performance_id=NEW.performance_id;
 IF v_account IS NULL THEN RETURN NEW; END IF;
 -- Account-scoped mutex shared with venue creation, settings changes and reservations.
 PERFORM 1 FROM public.accounts WHERE id=v_account FOR UPDATE;
 SELECT billing_enabled INTO v_global FROM public.commercial_settings WHERE id=true;
 SELECT billing_enabled INTO v_enabled FROM public.commercial_account_settings WHERE account_id=v_account;
 IF NOT coalesce(v_global,false) OR NOT coalesce(v_enabled,false) THEN
   INSERT INTO public.execution_reservations(performance_id,account_id,source)
   VALUES(NEW.performance_id,v_account,'unmetered') ON CONFLICT(performance_id) DO NOTHING;
   RETURN NEW;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.account_trials WHERE account_id=v_account AND status='active' AND starts_at<=now() AND ends_at>now()) INTO v_trial;
 IF v_trial THEN
   INSERT INTO public.execution_reservations(performance_id,account_id,source)
   VALUES(NEW.performance_id,v_account,'trial') ON CONFLICT(performance_id) DO NOTHING;
   RETURN NEW;
 END IF;
 SELECT * INTO v_sub FROM public.account_subscriptions WHERE account_id=v_account AND status='active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
   SELECT * INTO v_period FROM public.account_billing_periods WHERE subscription_id=v_sub.id AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
   IF FOUND THEN
     SELECT count(*) INTO v_used FROM public.account_usage_ledger WHERE billing_period_id=v_period.id AND entry_type='qualified_performance';
     SELECT count(*) INTO v_held FROM public.execution_reservations WHERE billing_period_id=v_period.id AND status='reserved' AND source='quota';
     IF v_used+v_held < v_period.included_executions THEN
       INSERT INTO public.execution_reservations(performance_id,account_id,billing_period_id,source)
       VALUES(NEW.performance_id,v_account,v_period.id,'quota') ON CONFLICT(performance_id) DO NOTHING;
       RETURN NEW;
     END IF;
   END IF;
 END IF;
 SELECT coalesce(sum(quantity),0) INTO v_balance FROM public.credit_wallet_ledger
 WHERE account_id=v_account AND (expires_at IS NULL OR expires_at>now());
 SELECT count(*) INTO v_held FROM public.execution_reservations WHERE account_id=v_account AND status='reserved' AND source='credit';
 IF v_balance-v_held>0 THEN
   INSERT INTO public.execution_reservations(performance_id,account_id,source)
   VALUES(NEW.performance_id,v_account,'credit') ON CONFLICT(performance_id) DO NOTHING;
   RETURN NEW;
 END IF;
 RAISE EXCEPTION 'commercial_quota_exhausted' USING ERRCODE='P0001';
END $$;

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
   v_limit := coalesce((v_plan->>'venue_limit')::integer,0);
 END IF;
 SELECT count(*) INTO v_count FROM public.venues WHERE account_id=NEW.account_id AND (TG_OP='INSERT' OR id<>NEW.id);
 IF v_count >= v_limit THEN RAISE EXCEPTION 'commercial_venue_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.reserve_commercial_execution(), public.enforce_commercial_venue_limit() FROM PUBLIC, anon, authenticated;

-- The webhook calls this transaction only after fetching an authoritative approved payment.
ALTER TABLE public.commercial_orders ADD COLUMN credit_expires_at timestamptz;
ALTER TABLE public.mercado_pago_events ADD COLUMN processing_error text;
CREATE OR REPLACE FUNCTION public.apply_commercial_payment(
 p_external_reference text, p_payment_id text, p_status text, p_paid_at timestamptz DEFAULT now()
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.commercial_orders%ROWTYPE; s public.account_subscriptions%ROWTYPE; v_start timestamptz; v_end timestamptz;
BEGIN
 SELECT * INTO o FROM public.commercial_orders WHERE external_reference=p_external_reference FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_order_not_found'; END IF;
 IF p_status <> 'approved' THEN
   UPDATE public.commercial_orders SET status=CASE WHEN p_status IN ('rejected','cancelled','refunded') THEN p_status ELSE status END,
    external_payment_id=coalesce(external_payment_id,p_payment_id),updated_at=now() WHERE id=o.id;
   RETURN;
 END IF;
 IF o.status='approved' THEN RETURN; END IF;
 IF o.status<>'pending' THEN RAISE EXCEPTION 'commercial_order_not_payable'; END IF;
 UPDATE public.commercial_orders SET status='approved',external_payment_id=p_payment_id,paid_at=p_paid_at,updated_at=now() WHERE id=o.id;
 IF o.kind='credits' THEN
   INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,order_id,idempotency_key,expires_at)
   VALUES(o.account_id,o.credits,'purchase','mercado_pago',o.id,'order:'||o.id::text,o.credit_expires_at)
   ON CONFLICT(idempotency_key) DO NOTHING;
   RETURN;
 END IF;
 SELECT * INTO s FROM public.account_subscriptions WHERE id=o.subscription_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_subscription_not_found'; END IF;
 v_start:=coalesce(s.current_period_end,p_paid_at); v_end:=v_start+interval '1 month';
 UPDATE public.account_subscriptions SET status='active',payment_status='approved',current_period_start=v_start,
  current_period_end=v_end,next_renewal_at=v_end,updated_at=now() WHERE id=s.id;
 INSERT INTO public.account_billing_periods(account_id,subscription_id,starts_at,ends_at,included_executions)
 VALUES(s.account_id,s.id,v_start,v_end,coalesce((s.plan_snapshot->>'included_executions')::integer,0))
 ON CONFLICT(subscription_id,starts_at) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.apply_commercial_payment(text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_commercial_payment(text,text,text,timestamptz) TO service_role;
