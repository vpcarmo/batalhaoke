-- Operational completion: bounded lifecycle jobs, audited trials, event retries,
-- and append-only financial reversals. Apply after 0032.
ALTER TABLE public.account_trials
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.account_subscriptions
  ADD COLUMN IF NOT EXISTS delinquent_since timestamptz,
  ADD COLUMN IF NOT EXISTS grace_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.mercado_pago_events
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS reprocess_requested_by uuid,
  ADD COLUMN IF NOT EXISTS reprocess_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS reprocessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE public.mercado_pago_events DROP CONSTRAINT IF EXISTS mercado_pago_events_status_check;
ALTER TABLE public.mercado_pago_events ADD CONSTRAINT mercado_pago_events_status_check CHECK (status IN ('received','validated','processing','processed','failed','ignored','reprocess_requested','reprocessed'));
ALTER TABLE public.commercial_trial_history ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.commercial_subscription_payments
  ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  ADD COLUMN IF NOT EXISTS disputed boolean NOT NULL DEFAULT false;

CREATE TABLE public.commercial_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  selected integer NOT NULL DEFAULT 0, succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0, outcomes jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE public.commercial_payment_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id text NOT NULL,
  adjustment_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('refund','chargeback','cancellation')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0), currency text NOT NULL DEFAULT 'BRL',
  status text NOT NULL, account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.commercial_orders(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES public.account_subscriptions(id) ON DELETE RESTRICT,
  unrecovered_cents integer NOT NULL DEFAULT 0 CHECK (unrecovered_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(payment_id,adjustment_id,kind)
);
CREATE TABLE public.commercial_credit_allocations (
 purchase_entry_id uuid NOT NULL REFERENCES public.credit_wallet_ledger(id) ON DELETE RESTRICT,
 usage_entry_id uuid NOT NULL REFERENCES public.credit_wallet_ledger(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>0), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(purchase_entry_id,usage_entry_id)
);
CREATE TABLE public.commercial_chargeback_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  payment_id text NOT NULL, adjustment_id text NOT NULL, original_cents integer NOT NULL CHECK(original_cents>=0),
  unrecovered_cents integer NOT NULL CHECK(unrecovered_cents>=0), settled_cents integer NOT NULL DEFAULT 0 CHECK(settled_cents>=0),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled')), created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz, UNIQUE(payment_id,adjustment_id)
);
CREATE TABLE public.commercial_account_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES public.commercial_job_runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT, outcome text NOT NULL, detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commercial_provider_resource_locks (
 resource_key text PRIMARY KEY, event_id uuid REFERENCES public.mercado_pago_events(id) ON DELETE CASCADE,
 acquired_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commercial_lifecycle_verifications (
 subscription_id uuid PRIMARY KEY REFERENCES public.account_subscriptions(id) ON DELETE CASCADE,
 remote_status text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mercado_pago_event_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES public.mercado_pago_events(id) ON DELETE CASCADE,
 attempt integer NOT NULL, initiated_by uuid, status text NOT NULL CHECK(status IN ('processing','processed','failed')),
 result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(event_id,attempt)
);
UPDATE public.mercado_pago_events e SET account_id=o.account_id
 FROM public.commercial_orders o WHERE e.account_id IS NULL AND o.external_payment_id=e.resource_id;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['commercial_job_runs','commercial_payment_adjustments','commercial_chargeback_debts','commercial_account_jobs','commercial_provider_resource_locks','commercial_lifecycle_verifications','mercado_pago_event_attempts','commercial_credit_allocations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.execution_reservations%ROWTYPE; v_usage uuid; v_lot record;
BEGIN
 IF NEW.entry_type<>'qualified_performance' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.execution_reservations WHERE performance_id=NEW.performance_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF r.status='consumed' THEN RETURN NEW; END IF;
 IF r.status='released' THEN RAISE EXCEPTION 'commercial_reservation_released'; END IF;
 NEW.billing_period_id:=r.billing_period_id;
 IF r.source='credit' THEN
  PERFORM 1 FROM public.accounts WHERE id=r.account_id FOR UPDATE;
  INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,performance_id,idempotency_key)
   VALUES(r.account_id,-1,'usage','qualified_performance',NEW.performance_id,'usage:'||NEW.performance_id::text)
   ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO v_usage;
  IF v_usage IS NOT NULL THEN
   FOR v_lot IN SELECT p.id,p.order_id,p.quantity FROM public.credit_wallet_ledger p
    WHERE p.account_id=r.account_id AND p.entry_type='purchase' AND (p.expires_at IS NULL OR p.expires_at>now())
      AND p.quantity>coalesce((SELECT sum(a.quantity) FROM public.commercial_credit_allocations a WHERE a.purchase_entry_id=p.id),0)
        +coalesce((SELECT -sum(ref.quantity) FROM public.credit_wallet_ledger ref WHERE ref.order_id=p.order_id AND ref.entry_type='refund'),0)
    ORDER BY p.created_at,p.id FOR UPDATE LOOP
     INSERT INTO public.commercial_credit_allocations(purchase_entry_id,usage_entry_id,quantity) VALUES(v_lot.id,v_usage,1);
     EXIT;
   END LOOP;
  END IF;
 END IF;
 UPDATE public.execution_reservations SET status='consumed',resolved_at=now() WHERE performance_id=NEW.performance_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.confirm_commercial_execution() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.process_commercial_lifecycle(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_run uuid; v_trial record; v_sub record; v_selected integer:=0; v_ok integer:=0; v_failed integer:=0;
BEGIN
 IF p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_batch_limit'; END IF;
 INSERT INTO public.commercial_job_runs(job) VALUES('lifecycle') RETURNING id INTO v_run;
 FOR v_trial IN SELECT id,account_id FROM public.account_trials WHERE status='active' AND ends_at<=now()
   ORDER BY ends_at LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  v_selected:=v_selected+1;
  BEGIN
   UPDATE public.account_trials SET status='expired',expired_at=now(),updated_at=now()
    WHERE id=v_trial.id AND status='active' AND ends_at<=now();
   IF FOUND THEN
    INSERT INTO public.commercial_trial_history(account_id,trial_id,operation,ends_at,reason,actor_user_id)
     VALUES(v_trial.account_id,v_trial.id,'expired',now(),'Expiração automática pelo horário do banco',(SELECT granted_by FROM public.account_trials WHERE id=v_trial.id));
    INSERT INTO public.commercial_audit_log(account_id,operation,reason,after_state)
     VALUES(v_trial.account_id,'trial_expired','Expiração automática',jsonb_build_object('trial_id',v_trial.id,'expired_at',now()));
   END IF;
   INSERT INTO public.commercial_account_jobs(run_id,account_id,outcome) VALUES(v_run,v_trial.account_id,'trial_expired'); v_ok:=v_ok+1;
  EXCEPTION WHEN OTHERS THEN
   INSERT INTO public.commercial_account_jobs(run_id,account_id,outcome,detail) VALUES(v_run,v_trial.account_id,'failed',left(SQLERRM,500)); v_failed:=v_failed+1;
  END;
 END LOOP;
 FOR v_sub IN SELECT id,account_id FROM public.account_subscriptions WHERE status='past_due' AND grace_ends_at<=now()
   ORDER BY grace_ends_at LIMIT greatest(0,p_limit-v_selected) FOR UPDATE SKIP LOCKED LOOP
  v_selected:=v_selected+1;
  BEGIN
   -- Do not suspend based on an unverified notification; only an authoritative approved payment clears this state.
   IF NOT EXISTS(SELECT 1 FROM public.commercial_subscription_payments WHERE subscription_id=v_sub.id AND status='approved'
      AND created_at >= (SELECT coalesce(delinquent_since,'-infinity'::timestamptz) FROM public.account_subscriptions WHERE id=v_sub.id))
      AND (NOT EXISTS(SELECT 1 FROM public.account_subscriptions WHERE id=v_sub.id AND external_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM public.commercial_lifecycle_verifications WHERE subscription_id=v_sub.id AND checked_at>now()-interval '15 minutes' AND remote_status IN ('rejected','cancelled','refunded','not_approved'))) THEN
    UPDATE public.account_subscriptions SET status='suspended',suspended_at=now(),updated_at=now()
      WHERE id=v_sub.id AND status='past_due' AND grace_ends_at<=now();
    IF FOUND THEN INSERT INTO public.commercial_audit_log(account_id,operation,reason,after_state)
      VALUES(v_sub.account_id,'subscription_suspended','Prazo de tolerância vencido',jsonb_build_object('subscription_id',v_sub.id,'suspended_at',now())); END IF;
   END IF;
   INSERT INTO public.commercial_account_jobs(run_id,account_id,outcome) VALUES(v_run,v_sub.account_id,CASE WHEN EXISTS(SELECT 1 FROM public.account_subscriptions WHERE id=v_sub.id AND status='suspended') THEN 'subscription_suspended' ELSE 'delinquency_deferred_or_cleared' END); v_ok:=v_ok+1;
  EXCEPTION WHEN OTHERS THEN
   INSERT INTO public.commercial_account_jobs(run_id,account_id,outcome,detail) VALUES(v_run,v_sub.account_id,'failed',left(SQLERRM,500)); v_failed:=v_failed+1;
  END;
 END LOOP;
 UPDATE public.commercial_job_runs SET finished_at=now(),selected=v_selected,succeeded=v_ok,failed=v_failed WHERE id=v_run;
 RETURN jsonb_build_object('run_id',v_run,'selected',v_selected,'succeeded',v_ok,'failed',v_failed);
END $$;
REVOKE ALL ON FUNCTION public.process_commercial_lifecycle(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_commercial_lifecycle(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.manage_commercial_trial(p_account_id uuid,p_operation text,p_ends_at timestamptz,p_reason text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.account_trials%ROWTYPE; v_old jsonb; v_new jsonb;
BEGIN
 IF p_operation NOT IN ('adjusted','extended','revoked') OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'invalid_trial_operation'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=p_account_id FOR UPDATE;
 SELECT * INTO t FROM public.account_trials WHERE account_id=p_account_id FOR UPDATE;
 IF NOT FOUND OR t.status<>'active' THEN RAISE EXCEPTION 'trial_not_active'; END IF;
 v_old:=to_jsonb(t);
 IF p_operation='revoked' THEN
  UPDATE public.account_trials SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=t.id RETURNING * INTO t;
 ELSE
  IF p_ends_at IS NULL OR p_ends_at<=t.starts_at OR p_ends_at<=now() THEN RAISE EXCEPTION 'invalid_trial_end'; END IF;
  UPDATE public.account_trials SET ends_at=p_ends_at,updated_at=now() WHERE id=t.id RETURNING * INTO t;
 END IF;
 v_new:=to_jsonb(t);
 INSERT INTO public.commercial_trial_history(account_id,trial_id,operation,starts_at,ends_at,reason,actor_user_id)
 VALUES(p_account_id,t.id,p_operation,t.starts_at,t.ends_at,p_reason,p_actor);
 INSERT INTO public.commercial_audit_log(actor_user_id,account_id,operation,reason,before_state,after_state)
 VALUES(p_actor,p_account_id,'trial_'||p_operation,p_reason,v_old,v_new);
 RETURN t.id;
END $$;
REVOKE ALL ON FUNCTION public.manage_commercial_trial(uuid,text,timestamptz,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_commercial_trial(uuid,text,timestamptz,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_commercial_reversal(p_payment_id text,p_adjustment_id text,p_kind text,p_amount_cents integer,p_currency text,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.commercial_orders%ROWTYPE; s public.account_subscriptions%ROWTYPE; v_sub_payment public.commercial_subscription_payments%ROWTYPE; old_amount integer; take_credits integer; available integer; used integer; v_debt integer:=0; v_original_amount integer;
BEGIN
 IF p_kind NOT IN ('refund','chargeback','cancellation') OR p_amount_cents<0 OR p_currency<>'BRL' THEN RAISE EXCEPTION 'invalid_reversal'; END IF;
 SELECT * INTO o FROM public.commercial_orders WHERE external_payment_id=p_payment_id FOR UPDATE;
 IF NOT FOUND THEN
  SELECT * INTO v_sub_payment FROM public.commercial_subscription_payments WHERE provider_payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commercial_order_not_found'; END IF;
  SELECT * INTO s FROM public.account_subscriptions WHERE id=v_sub_payment.subscription_id FOR UPDATE;
  SELECT * INTO o FROM public.commercial_orders WHERE subscription_id=s.id AND kind='subscription' ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'commercial_subscription_order_not_found'; END IF;
  v_original_amount:=coalesce(v_sub_payment.amount_cents,o.amount_cents);
 ELSE
  v_original_amount:=o.amount_cents;
 END IF;
 PERFORM 1 FROM public.accounts WHERE id=o.account_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.commercial_payment_adjustments WHERE payment_id=p_payment_id AND adjustment_id=p_adjustment_id AND kind=p_kind) THEN
  RETURN jsonb_build_object('duplicate',true);
 END IF;
 SELECT coalesce(sum(amount_cents),0) INTO old_amount FROM public.commercial_payment_adjustments
  WHERE payment_id=p_payment_id AND kind IN ('refund','chargeback');
 IF old_amount+p_amount_cents>v_original_amount THEN RAISE EXCEPTION 'reversal_exceeds_payment'; END IF;
 IF o.kind='credits' THEN
  -- Deterministic cumulative proportional reversal, rounding down; final full reversal captures all remaining credits.
  take_credits:=CASE WHEN old_amount+p_amount_cents=v_original_amount THEN o.credits
    ELSE floor(o.credits::numeric*(old_amount+p_amount_cents)/v_original_amount)::integer END;
  SELECT coalesce(sum(a.quantity),0) INTO used FROM public.commercial_credit_allocations a
   JOIN public.credit_wallet_ledger p ON p.id=a.purchase_entry_id WHERE p.order_id=o.id;
  take_credits:=greatest(0,take_credits-used);
  SELECT greatest(0,least(take_credits,o.credits-used-coalesce(-sum(quantity),0))) INTO available
    FROM public.credit_wallet_ledger WHERE order_id=o.id AND entry_type='refund';
  IF coalesce(available,0)>0 THEN
   INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,order_id,idempotency_key,reason)
    VALUES(o.account_id,-available,'refund',p_kind,o.id,'reversal:'||p_payment_id||':'||p_adjustment_id,'Compensação confirmada no Mercado Pago');
  END IF;
  v_debt:=greatest(0,take_credits-coalesce(available,0));
  IF v_debt>0 THEN
   INSERT INTO public.commercial_chargeback_debts(account_id,payment_id,adjustment_id,original_cents,unrecovered_cents)
    VALUES(o.account_id,p_payment_id,p_adjustment_id,round(v_original_amount::numeric*v_debt/o.credits),round(v_original_amount::numeric*v_debt/o.credits));
  END IF;
 ELSE
  SELECT * INTO s FROM public.account_subscriptions WHERE id=o.subscription_id FOR UPDATE;
  IF FOUND AND (p_kind='chargeback' OR old_amount+p_amount_cents=v_original_amount) THEN
   UPDATE public.account_subscriptions SET status=CASE WHEN p_kind='chargeback' THEN 'suspended' ELSE 'past_due' END,
    payment_status=p_kind, suspended_at=CASE WHEN p_kind='chargeback' THEN now() ELSE suspended_at END,updated_at=now() WHERE id=s.id;
  END IF;
 END IF;
 INSERT INTO public.commercial_payment_adjustments(payment_id,adjustment_id,kind,amount_cents,currency,status,account_id,order_id,subscription_id,unrecovered_cents)
 VALUES(p_payment_id,p_adjustment_id,p_kind,p_amount_cents,p_currency,p_status,o.account_id,o.id,o.subscription_id,v_debt);
 INSERT INTO public.commercial_audit_log(account_id,operation,reason,after_state)
 VALUES(o.account_id,'payment_'||p_kind,'Ajuste confirmado pelo Mercado Pago',jsonb_build_object('payment_id',p_payment_id,'adjustment_id',p_adjustment_id,'amount_cents',p_amount_cents,'unrecovered_credits',v_debt));
 RETURN jsonb_build_object('duplicate',false,'unrecovered_credits',v_debt);
END $$;
REVOKE ALL ON FUNCTION public.apply_commercial_reversal(text,text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_commercial_reversal(text,text,text,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_commercial_chargeback_debt(p_account_id uuid,p_amount integer,p_reason text,p_actor uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE remaining integer:=p_amount; d record; paid integer:=0;
BEGIN
 IF p_amount<=0 OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'invalid_debt_settlement'; END IF;
 PERFORM 1 FROM public.accounts WHERE id=p_account_id FOR UPDATE;
 FOR d IN SELECT * FROM public.commercial_chargeback_debts WHERE account_id=p_account_id AND status='open' ORDER BY created_at FOR UPDATE LOOP
  EXIT WHEN remaining=0;
  paid:=least(remaining,d.unrecovered_cents-d.settled_cents);
  UPDATE public.commercial_chargeback_debts SET settled_cents=settled_cents+paid,
    status=CASE WHEN settled_cents+paid>=unrecovered_cents THEN 'settled' ELSE 'open' END,
    settled_at=CASE WHEN settled_cents+paid>=unrecovered_cents THEN now() ELSE NULL END WHERE id=d.id;
  remaining:=remaining-paid;
 END LOOP;
 INSERT INTO public.commercial_audit_log(actor_user_id,account_id,operation,reason,after_state)
 VALUES(p_actor,p_account_id,'chargeback_debt_settled',p_reason,jsonb_build_object('amount',p_amount-remaining));
 RETURN p_amount-remaining;
END $$;
REVOKE ALL ON FUNCTION public.settle_commercial_chargeback_debt(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_commercial_chargeback_debt(uuid,integer,text,uuid) TO service_role;

-- Database authority prevents expired trials or restricted accounts from starting new work
-- even if the scheduled worker has not run yet.
CREATE OR REPLACE FUNCTION public.reserve_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account uuid; v_period public.account_billing_periods%ROWTYPE; v_sub public.account_subscriptions%ROWTYPE;
 v_enabled boolean; v_global boolean; v_trial boolean; v_used integer; v_held integer; v_balance integer; v_expired public.account_trials%ROWTYPE;
BEGIN
 SELECT account_id INTO v_account FROM public.performance_measurements WHERE performance_id=NEW.performance_id;
 IF v_account IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.accounts WHERE id=v_account FOR UPDATE;
 SELECT billing_enabled INTO v_global FROM public.commercial_settings WHERE id=true;
 SELECT billing_enabled INTO v_enabled FROM public.commercial_account_settings WHERE account_id=v_account;
 IF NOT coalesce(v_global,false) OR NOT coalesce(v_enabled,false) THEN
  INSERT INTO public.execution_reservations(performance_id,account_id,source) VALUES(NEW.performance_id,v_account,'unmetered') ON CONFLICT DO NOTHING; RETURN NEW;
 END IF;
 UPDATE public.account_trials SET status='expired',expired_at=now(),updated_at=now()
  WHERE account_id=v_account AND status='active' AND ends_at<=now() RETURNING * INTO v_expired;
 IF FOUND THEN
  INSERT INTO public.commercial_trial_history(account_id,trial_id,operation,ends_at,reason,actor_user_id)
   VALUES(v_account,v_expired.id,'expired',v_expired.expired_at,'Expiração automática antes de autorizar execução',v_expired.granted_by);
  INSERT INTO public.commercial_audit_log(account_id,operation,reason,after_state)
   VALUES(v_account,'trial_expired','Expiração automática antes de autorizar execução',jsonb_build_object('trial_id',v_expired.id,'expired_at',v_expired.expired_at));
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.account_trials WHERE account_id=v_account AND status='active' AND starts_at<=now() AND ends_at>now()) INTO v_trial;
 IF v_trial THEN
  INSERT INTO public.execution_reservations(performance_id,account_id,source) VALUES(NEW.performance_id,v_account,'trial') ON CONFLICT DO NOTHING; RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM public.account_subscriptions WHERE account_id=v_account AND (status='suspended' OR (status='past_due' AND grace_ends_at<=now()))) OR
    EXISTS(SELECT 1 FROM public.commercial_chargeback_debts WHERE account_id=v_account AND status='open' AND settled_cents<unrecovered_cents) THEN
  RAISE EXCEPTION 'commercial_account_restricted' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO v_sub FROM public.account_subscriptions WHERE account_id=v_account AND status='active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  SELECT * INTO v_period FROM public.account_billing_periods WHERE subscription_id=v_sub.id AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
   SELECT count(*) INTO v_used FROM public.account_usage_ledger WHERE billing_period_id=v_period.id AND entry_type='qualified_performance';
   SELECT count(*) INTO v_held FROM public.execution_reservations WHERE billing_period_id=v_period.id AND status='reserved' AND source='quota';
   IF v_used+v_held<v_period.included_executions THEN
    INSERT INTO public.execution_reservations(performance_id,account_id,billing_period_id,source) VALUES(NEW.performance_id,v_account,v_period.id,'quota') ON CONFLICT DO NOTHING; RETURN NEW;
   END IF;
  END IF;
 END IF;
 SELECT coalesce(sum(quantity),0) INTO v_balance FROM public.credit_wallet_ledger WHERE account_id=v_account AND (expires_at IS NULL OR expires_at>now());
 SELECT count(*) INTO v_held FROM public.execution_reservations WHERE account_id=v_account AND status='reserved' AND source='credit';
 IF v_balance-v_held>0 THEN INSERT INTO public.execution_reservations(performance_id,account_id,source) VALUES(NEW.performance_id,v_account,'credit') ON CONFLICT DO NOTHING; RETURN NEW; END IF;
 RAISE EXCEPTION 'commercial_quota_exhausted' USING ERRCODE='P0001';
END $$;
REVOKE ALL ON FUNCTION public.reserve_commercial_execution() FROM PUBLIC,anon,authenticated;
