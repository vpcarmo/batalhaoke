-- Commercial lifecycle, operator audit history and idempotent recurring payments.
ALTER TABLE public.account_subscriptions
  ADD COLUMN IF NOT EXISTS pending_plan_version integer,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_id text,
  ADD COLUMN IF NOT EXISTS delinquent_since timestamptz,
  ADD COLUMN IF NOT EXISTS grace_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

CREATE TABLE public.commercial_trial_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  trial_id uuid REFERENCES public.account_trials(id) ON DELETE RESTRICT, operation text NOT NULL,
  starts_at timestamptz, ends_at timestamptz, reason text NOT NULL, actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commercial_trial_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_trial_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commercial_trial_history TO service_role;

CREATE TABLE public.commercial_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL, order_id uuid REFERENCES public.commercial_orders(id),
  subscription_id uuid REFERENCES public.account_subscriptions(id), outcome text NOT NULL, detail text,
  actor_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commercial_reconciliation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_reconciliation_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commercial_reconciliation_log TO service_role;

CREATE TABLE public.commercial_subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES public.account_subscriptions(id),
  provider_payment_id text NOT NULL UNIQUE, status text NOT NULL, amount_cents integer, paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commercial_subscription_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_subscription_payments FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.commercial_subscription_payments TO service_role;

CREATE OR REPLACE FUNCTION public.grant_commercial_credits(
 p_account_id uuid,p_quantity integer,p_reason text,p_actor uuid,p_idempotency_key text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid;
BEGIN
 IF p_quantity=0 OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'invalid_credit_adjustment'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=p_account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_account_not_found'; END IF;
 IF p_quantity<0 AND coalesce((SELECT sum(quantity) FROM public.credit_wallet_ledger WHERE account_id=p_account_id AND (expires_at IS NULL OR expires_at>now())),0)+p_quantity <
   (SELECT count(*) FROM public.execution_reservations WHERE account_id=p_account_id AND source='credit' AND status='reserved') THEN
  RAISE EXCEPTION 'credit_adjustment_exceeds_available_balance';
 END IF;
 INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,idempotency_key,reason,created_by)
 VALUES(p_account_id,p_quantity,CASE WHEN p_quantity>0 THEN 'grant' ELSE 'adjustment' END,'superadmin',p_idempotency_key,p_reason,p_actor)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN SELECT id INTO v_id FROM public.credit_wallet_ledger WHERE idempotency_key=p_idempotency_key; END IF;
 INSERT INTO public.commercial_audit_log(actor_user_id,account_id,operation,reason,after_state)
 VALUES(p_actor,p_account_id,'wallet_adjustment',p_reason,jsonb_build_object('quantity',p_quantity,'ledger_id',v_id));
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.grant_commercial_credits(uuid,integer,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grant_commercial_credits(uuid,integer,text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.grant_commercial_trial(p_account_id uuid,p_days integer,p_reason text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_trial uuid; v_now timestamptz:=now();
BEGIN
 IF p_days NOT BETWEEN 1 AND 365 OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'invalid_trial'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=p_account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_account_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_trials WHERE account_id=p_account_id) THEN RAISE EXCEPTION 'trial_already_used'; END IF;
 INSERT INTO public.account_trials(account_id,starts_at,ends_at,status,granted_by,reason)
 VALUES(p_account_id,v_now,v_now+make_interval(days=>p_days),'active',p_actor,p_reason) RETURNING id INTO v_trial;
 INSERT INTO public.commercial_trial_history(account_id,trial_id,operation,starts_at,ends_at,reason,actor_user_id)
 VALUES(p_account_id,v_trial,'granted',v_now,v_now+make_interval(days=>p_days),p_reason,p_actor);
 INSERT INTO public.commercial_audit_log(actor_user_id,account_id,operation,reason,after_state)
 VALUES(p_actor,p_account_id,'trial_granted',p_reason,jsonb_build_object('trial_id',v_trial,'days',p_days));
 RETURN v_trial;
END $$;
REVOKE ALL ON FUNCTION public.grant_commercial_trial(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.grant_commercial_trial(uuid,integer,text,uuid) TO service_role;

-- Repeated Mercado Pago notifications cannot create duplicate periods or activate twice.
DROP FUNCTION IF EXISTS public.apply_commercial_payment(text,text,text,timestamptz);
CREATE OR REPLACE FUNCTION public.apply_commercial_payment(
 p_external_reference text,p_payment_id text,p_status text,p_paid_at timestamptz DEFAULT now(),p_amount_cents integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.commercial_orders%ROWTYPE; s public.account_subscriptions%ROWTYPE; v_start timestamptz; v_end timestamptz; v_grace_days integer;
 v_plan jsonb; v_result_id uuid;
BEGIN
 SELECT * INTO o FROM public.commercial_orders WHERE external_reference=p_external_reference FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_order_not_found'; END IF;
 IF p_status<>'approved' THEN
  IF o.status='approved' AND o.kind='subscription' THEN
   SELECT * INTO s FROM public.account_subscriptions WHERE id=o.subscription_id FOR UPDATE;
   IF FOUND THEN
    INSERT INTO public.commercial_subscription_payments(subscription_id,provider_payment_id,status,amount_cents,paid_at)
    VALUES(s.id,p_payment_id,p_status,o.amount_cents,p_paid_at) ON CONFLICT(provider_payment_id) DO UPDATE SET status=EXCLUDED.status,paid_at=EXCLUDED.paid_at
     WHERE public.commercial_subscription_payments.status<>'approved' RETURNING id INTO v_result_id;
    IF v_result_id IS NOT NULL THEN
     SELECT delinquency_grace_days INTO v_grace_days FROM public.commercial_settings WHERE id=true;
     UPDATE public.account_subscriptions SET status=CASE WHEN p_status='charged_back' THEN 'suspended' ELSE 'past_due' END,payment_status=p_status,
      delinquent_since=coalesce(delinquent_since,now()),grace_ends_at=coalesce(grace_ends_at,now()+make_interval(days=>coalesce(v_grace_days,0))),
      suspended_at=CASE WHEN p_status='charged_back' THEN coalesce(suspended_at,now()) ELSE suspended_at END,updated_at=now()
      WHERE id=s.id AND status IN ('active','past_due');
    END IF;
   END IF;
   RETURN;
  END IF;
  UPDATE public.commercial_orders SET status=CASE WHEN p_status IN ('rejected','cancelled','refunded') THEN p_status ELSE status END,
   external_payment_id=coalesce(external_payment_id,p_payment_id),updated_at=now() WHERE id=o.id;
  IF o.subscription_id IS NOT NULL AND p_status IN ('rejected','cancelled') THEN
   SELECT delinquency_grace_days INTO v_grace_days FROM public.commercial_settings WHERE id=true;
   UPDATE public.account_subscriptions SET status='past_due',payment_status=p_status,
    delinquent_since=coalesce(delinquent_since,now()),grace_ends_at=coalesce(grace_ends_at,now()+make_interval(days=>coalesce(v_grace_days,0))),updated_at=now()
    WHERE id=o.subscription_id AND status IN ('active','pending_payment','past_due');
  END IF;
  RETURN;
 END IF;
 IF o.status='approved' AND o.kind='subscription' THEN
  SELECT * INTO s FROM public.account_subscriptions WHERE id=o.subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commercial_subscription_not_found'; END IF;
  IF s.last_payment_id=p_payment_id THEN RETURN; END IF;
  IF p_status<>'approved' THEN RETURN; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents<>coalesce((s.plan_snapshot->>'monthly_price_cents')::integer,o.amount_cents) THEN RAISE EXCEPTION 'commercial_payment_amount_mismatch'; END IF;
  INSERT INTO public.commercial_subscription_payments(subscription_id,provider_payment_id,status,amount_cents,paid_at)
  VALUES(s.id,p_payment_id,p_status,p_amount_cents,p_paid_at)
  ON CONFLICT(provider_payment_id) DO UPDATE SET status=EXCLUDED.status,amount_cents=EXCLUDED.amount_cents,paid_at=EXCLUDED.paid_at
   WHERE public.commercial_subscription_payments.status<>'approved';
  IF NOT FOUND THEN RETURN; END IF;
  v_start:=CASE WHEN s.current_period_end IS NOT NULL AND s.current_period_end>p_paid_at THEN s.current_period_end ELSE p_paid_at END;
  v_end:=v_start+interval '1 month';
  IF s.pending_plan_id IS NOT NULL THEN
   SELECT snapshot INTO v_plan FROM public.commercial_plan_versions WHERE plan_id=s.pending_plan_id AND version=s.pending_plan_version;
   IF v_plan IS NOT NULL THEN UPDATE public.account_subscriptions SET plan_id=s.pending_plan_id,plan_version=s.pending_plan_version,plan_snapshot=v_plan,pending_plan_id=NULL,pending_plan_version=NULL WHERE id=s.id; s.plan_snapshot:=v_plan; END IF;
  END IF;
  UPDATE public.account_subscriptions SET status='active',payment_status='approved',last_payment_id=p_payment_id,delinquent_since=NULL,grace_ends_at=NULL,suspended_at=NULL,current_period_start=v_start,current_period_end=v_end,next_renewal_at=v_end,updated_at=now() WHERE id=s.id;
  INSERT INTO public.account_billing_periods(account_id,subscription_id,starts_at,ends_at,included_executions) VALUES(s.account_id,s.id,v_start,v_end,coalesce((s.plan_snapshot->>'included_executions')::integer,0)) ON CONFLICT(subscription_id,starts_at) DO NOTHING;
  RETURN;
 END IF;
 IF o.status='approved' THEN RETURN; END IF;
 IF o.status<>'pending' THEN RAISE EXCEPTION 'commercial_order_not_payable'; END IF;
 IF p_amount_cents IS NULL OR p_amount_cents<>o.amount_cents THEN RAISE EXCEPTION 'commercial_payment_amount_mismatch'; END IF;
 UPDATE public.commercial_orders SET status='approved',external_payment_id=p_payment_id,paid_at=p_paid_at,updated_at=now() WHERE id=o.id;
 IF o.kind='credits' THEN
  INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,order_id,idempotency_key,expires_at)
  VALUES(o.account_id,o.credits,'purchase','mercado_pago',o.id,'order:'||o.id::text,o.credit_expires_at) ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN;
 END IF;
 SELECT * INTO s FROM public.account_subscriptions WHERE id=o.subscription_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'commercial_subscription_not_found'; END IF;
 IF s.last_payment_id=p_payment_id THEN RETURN; END IF;
 v_start:=CASE WHEN s.current_period_end IS NOT NULL AND s.current_period_end>p_paid_at THEN s.current_period_end ELSE p_paid_at END;
 v_end:=v_start+interval '1 month';
 UPDATE public.account_subscriptions SET status='active',payment_status='approved',last_payment_id=p_payment_id,
  delinquent_since=NULL,grace_ends_at=NULL,suspended_at=NULL,current_period_start=v_start,current_period_end=v_end,next_renewal_at=v_end,updated_at=now() WHERE id=s.id;
 INSERT INTO public.account_billing_periods(account_id,subscription_id,starts_at,ends_at,included_executions)
 VALUES(s.account_id,s.id,v_start,v_end,coalesce((s.plan_snapshot->>'included_executions')::integer,0)) ON CONFLICT(subscription_id,starts_at) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.apply_commercial_payment(text,text,text,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_commercial_payment(text,text,text,timestamptz,integer) TO service_role;
