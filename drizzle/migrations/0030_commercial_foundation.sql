-- Commercial layer foundation. All money is stored in integer BRL cents.
-- Billing is explicitly disabled by default; existing accounts receive no trial or debt.
CREATE TABLE public.commercial_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  billing_enabled boolean NOT NULL DEFAULT false,
  trial_duration_days integer CHECK (trial_duration_days IS NULL OR trial_duration_days > 0),
  delinquency_grace_days integer NOT NULL DEFAULT 0 CHECK (delinquency_grace_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.commercial_settings(id) VALUES (true);

CREATE TABLE public.commercial_account_settings (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE RESTRICT,
  billing_enabled boolean NOT NULL DEFAULT false,
  venue_limit_override integer CHECK (venue_limit_override IS NULL OR venue_limit_override >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.commercial_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  account_type text NOT NULL CHECK (account_type IN ('individual','business')),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL DEFAULT '',
  monthly_price_cents integer NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
  included_executions integer NOT NULL DEFAULT 0 CHECK (included_executions >= 0),
  venue_limit integer NOT NULL DEFAULT 0 CHECK (venue_limit >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive')),
  display_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Empty commercial templates only: values require configuration before publication.
INSERT INTO public.commercial_plans(code,account_type,name) VALUES
 ('individual','individual','Individual'), ('business','business','Business');

CREATE TABLE public.commercial_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT,
  version integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(plan_id,version)
);
CREATE TABLE public.account_trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked')),
  granted_by uuid, reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE public.account_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT,
  plan_version integer NOT NULL, plan_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_payment','active','past_due','cancel_requested','cancelled','expired','suspended')),
  provider text NOT NULL DEFAULT 'mercado_pago', external_id text, external_plan_id text,
  current_period_start timestamptz, current_period_end timestamptz, next_renewal_at timestamptz,
  payment_status text, pending_plan_id uuid REFERENCES public.commercial_plans(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz
);
CREATE UNIQUE INDEX account_subscriptions_one_current ON public.account_subscriptions(account_id)
 WHERE status IN ('pending_payment','active','past_due','cancel_requested','suspended');
CREATE TABLE public.account_billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES public.account_subscriptions(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, included_executions integer NOT NULL CHECK (included_executions >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at), UNIQUE(subscription_id,starts_at)
);
ALTER TABLE public.account_usage_ledger ADD COLUMN billing_period_id uuid REFERENCES public.account_billing_periods(id) ON DELETE RESTRICT;

CREATE TABLE public.credit_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''), description text NOT NULL DEFAULT '',
  credits integer NOT NULL CHECK (credits > 0), price_cents integer NOT NULL CHECK (price_cents >= 0),
  validity_days integer CHECK (validity_days IS NULL OR validity_days > 0), active boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.commercial_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  pack_id uuid REFERENCES public.credit_packs(id) ON DELETE RESTRICT, subscription_id uuid REFERENCES public.account_subscriptions(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('credits','subscription')), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled','refunded')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0), credits integer NOT NULL DEFAULT 0 CHECK (credits >= 0), provider text NOT NULL DEFAULT 'mercado_pago',
  external_preference_id text, external_payment_id text, external_reference text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE UNIQUE INDEX commercial_orders_provider_payment ON public.commercial_orders(provider,external_payment_id) WHERE external_payment_id IS NOT NULL;
CREATE TABLE public.credit_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity <> 0), entry_type text NOT NULL CHECK (entry_type IN ('purchase','grant','usage','refund','adjustment')),
  source text NOT NULL, order_id uuid REFERENCES public.commercial_orders(id) ON DELETE RESTRICT,
  performance_id uuid REFERENCES public.performances(id) ON DELETE RESTRICT, expires_at timestamptz,
  idempotency_key text NOT NULL UNIQUE, reason text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_wallet_account_date_idx ON public.credit_wallet_ledger(account_id,created_at DESC);
CREATE TABLE public.execution_reservations (
  performance_id uuid PRIMARY KEY REFERENCES public.performances(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  billing_period_id uuid REFERENCES public.account_billing_periods(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('trial','quota','credit','unmetered')),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','released')),
  reserved_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX execution_reservations_account_open_idx ON public.execution_reservations(account_id) WHERE status='reserved';
CREATE TABLE public.commercial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT,
  operation text NOT NULL, reason text, before_state jsonb, after_state jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mercado_pago_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text UNIQUE, resource_id text NOT NULL, topic text,
  signature_valid boolean NOT NULL, status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);

-- Wallet movements are append-only even for privileged application roles. Corrections use compensating entries.
CREATE OR REPLACE FUNCTION public.reject_credit_wallet_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 RAISE EXCEPTION 'credit_wallet_ledger_is_append_only' USING ERRCODE='55000';
END $$;
CREATE TRIGGER credit_wallet_ledger_append_only
BEFORE UPDATE OR DELETE ON public.credit_wallet_ledger
FOR EACH ROW EXECUTE FUNCTION public.reject_credit_wallet_mutation();

-- All commercial data is server-owned; no client policies or direct table grants.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['commercial_settings','commercial_account_settings','commercial_plans','commercial_plan_versions','account_trials','account_subscriptions','account_billing_periods','credit_packs','commercial_orders','credit_wallet_ledger','execution_reservations','commercial_audit_log','mercado_pago_events'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
   EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT ALL ON public.account_usage_ledger TO service_role;

-- Reserves one execution before playback measurement starts. Row locks serialize all venues in one account.
CREATE OR REPLACE FUNCTION public.reserve_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_account uuid; v_period public.account_billing_periods%ROWTYPE; v_sub public.account_subscriptions%ROWTYPE;
  v_enabled boolean; v_global boolean; v_trial boolean; v_used integer; v_held integer; v_balance integer; v_limit integer;
BEGIN
 SELECT account_id INTO v_account FROM public.performance_measurements WHERE performance_id=NEW.performance_id;
 IF v_account IS NULL THEN RETURN NEW; END IF;
 SELECT billing_enabled INTO v_global FROM public.commercial_settings WHERE id=true;
 SELECT billing_enabled INTO v_enabled FROM public.commercial_account_settings WHERE account_id=v_account FOR UPDATE;
 IF NOT coalesce(v_global,false) OR NOT coalesce(v_enabled,false) THEN
   INSERT INTO public.execution_reservations(performance_id,account_id,source) VALUES(NEW.performance_id,v_account,'unmetered') ON CONFLICT DO NOTHING;
   RETURN NEW;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.account_trials WHERE account_id=v_account AND status='active' AND starts_at<=now() AND ends_at>now()) INTO v_trial;
 IF v_trial THEN
   INSERT INTO public.execution_reservations(performance_id,account_id,source) VALUES(NEW.performance_id,v_account,'trial') ON CONFLICT DO NOTHING;
   RETURN NEW;
 END IF;
 SELECT * INTO v_sub FROM public.account_subscriptions WHERE account_id=v_account AND status='active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN
   SELECT * INTO v_period FROM public.account_billing_periods WHERE subscription_id=v_sub.id AND starts_at<=now() AND ends_at>now() ORDER BY starts_at DESC LIMIT 1 FOR UPDATE;
   IF FOUND THEN
     SELECT count(*) INTO v_used FROM public.account_usage_ledger WHERE billing_period_id=v_period.id AND entry_type='qualified_performance';
     SELECT count(*) INTO v_held FROM public.execution_reservations WHERE billing_period_id=v_period.id AND status='reserved' AND source='quota';
     IF v_used+v_held < v_period.included_executions THEN
       INSERT INTO public.execution_reservations(performance_id,account_id,billing_period_id,source) VALUES(NEW.performance_id,v_account,v_period.id,'quota') ON CONFLICT DO NOTHING;
       RETURN NEW;
     END IF;
   END IF;
 END IF;
 SELECT coalesce(sum(quantity),0) INTO v_balance FROM public.credit_wallet_ledger WHERE account_id=v_account AND (expires_at IS NULL OR expires_at>now());
 SELECT count(*) INTO v_held FROM public.execution_reservations WHERE account_id=v_account AND status='reserved' AND source='credit';
 IF v_balance-v_held>0 THEN
   INSERT INTO public.execution_reservations(performance_id,account_id,source) VALUES(NEW.performance_id,v_account,'credit') ON CONFLICT DO NOTHING;
   RETURN NEW;
 END IF;
 RAISE EXCEPTION 'commercial_quota_exhausted' USING ERRCODE='P0001';
END $$;
CREATE TRIGGER performance_measurement_commercial_reserve AFTER INSERT ON public.performance_measurements
FOR EACH ROW EXECUTE FUNCTION public.reserve_commercial_execution();

-- Qualification maps the existing measured ledger event to its reservation exactly once.
CREATE OR REPLACE FUNCTION public.confirm_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.execution_reservations%ROWTYPE;
BEGIN
 IF NEW.entry_type <> 'qualified_performance' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.execution_reservations WHERE performance_id=NEW.performance_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF r.status='consumed' THEN RETURN NEW; END IF;
 IF r.status='released' THEN RAISE EXCEPTION 'commercial_reservation_released'; END IF;
 NEW.billing_period_id := r.billing_period_id;
 IF r.source='credit' THEN
   INSERT INTO public.credit_wallet_ledger(account_id,quantity,entry_type,source,performance_id,idempotency_key)
   VALUES(r.account_id,-1,'usage','qualified_performance',NEW.performance_id,'usage:'||NEW.performance_id::text) ON CONFLICT(idempotency_key) DO NOTHING;
 END IF;
 UPDATE public.execution_reservations SET status='consumed',resolved_at=now() WHERE performance_id=NEW.performance_id;
 RETURN NEW;
END $$;
CREATE TRIGGER account_usage_confirm_commercial BEFORE INSERT ON public.account_usage_ledger
FOR EACH ROW EXECUTE FUNCTION public.confirm_commercial_execution();

CREATE OR REPLACE FUNCTION public.release_commercial_execution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='finalized' AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE public.execution_reservations SET status='released',resolved_at=now()
    WHERE performance_id=NEW.performance_id AND status='reserved';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER measurement_release_commercial AFTER UPDATE OF status ON public.performance_measurements
FOR EACH ROW EXECUTE FUNCTION public.release_commercial_execution();

-- Reserve venue capacity on the account row to prevent concurrent over-creation.
CREATE OR REPLACE FUNCTION public.enforce_commercial_venue_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_enabled boolean; v_global boolean; v_limit integer; v_count integer; v_plan jsonb;
BEGIN
 IF NEW.account_id IS NULL THEN RETURN NEW; END IF;
 SELECT billing_enabled INTO v_global FROM public.commercial_settings WHERE id=true;
 SELECT billing_enabled,venue_limit_override INTO v_enabled,v_limit FROM public.commercial_account_settings WHERE account_id=NEW.account_id FOR UPDATE;
 IF NOT coalesce(v_global,false) OR NOT coalesce(v_enabled,false) THEN RETURN NEW; END IF;
 IF v_limit IS NULL THEN
   SELECT s.plan_snapshot INTO v_plan FROM public.account_subscriptions s WHERE s.account_id=NEW.account_id AND s.status='active' ORDER BY s.created_at DESC LIMIT 1;
   v_limit := coalesce((v_plan->>'venue_limit')::integer,0);
 END IF;
 SELECT count(*) INTO v_count FROM public.venues WHERE account_id=NEW.account_id;
 IF v_count >= v_limit THEN RAISE EXCEPTION 'commercial_venue_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER venues_commercial_limit BEFORE INSERT OR UPDATE OF account_id ON public.venues
FOR EACH ROW EXECUTE FUNCTION public.enforce_commercial_venue_limit();

REVOKE ALL ON FUNCTION public.reserve_commercial_execution(), public.confirm_commercial_execution(),
  public.release_commercial_execution(), public.enforce_commercial_venue_limit(),
  public.reject_credit_wallet_mutation() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.credit_wallet_ledger IS 'Imutável: saldo financeiro de créditos, separado do account_usage_ledger.';
COMMENT ON TABLE public.execution_reservations IS 'Reserva atômica por performance; confirmação ocorre na qualificação medida de 30s.';
COMMENT ON COLUMN public.account_subscriptions.plan_snapshot IS 'Condições contratadas congeladas na contratação; edições do catálogo não alteram contratos existentes.';
