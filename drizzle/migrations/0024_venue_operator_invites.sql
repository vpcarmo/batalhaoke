CREATE TABLE public.venue_operator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  email_normalized text NOT NULL CHECK (email_normalized = lower(btrim(email_normalized)) AND email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text NOT NULL DEFAULT 'operator' CHECK (role = 'operator'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  delivery_state text NOT NULL DEFAULT 'pending_send' CHECK (delivery_state IN ('pending_send', 'sending', 'sent', 'failed')),
  invited_by uuid NOT NULL,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  delivery_claim_id uuid,
  delivery_claimed_at timestamptz,
  delivery_lease_until timestamptz,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK ((accepted_at IS NULL) = (accepted_by IS NULL))
);

CREATE INDEX venue_operator_invites_venue_created_idx
  ON public.venue_operator_invites (venue_id, created_at DESC);
CREATE INDEX venue_operator_invites_expiration_idx
  ON public.venue_operator_invites (expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX venue_operator_invites_one_pending_per_email
  ON public.venue_operator_invites (venue_id, email_normalized) WHERE status = 'pending';

ALTER TABLE public.venue_operator_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_operator_invites FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_operator_invites TO service_role;

-- Called only after the server verifies the current Auth identity and confirmed email.
-- The backend MUST validate the user via Supabase Auth before calling this RPC. Never expose
-- the service_role key to a client. User identity parameters are trusted only from that backend.
-- The lock and both writes share one transaction, so concurrent accepts cannot both win.
CREATE OR REPLACE FUNCTION public.accept_venue_operator_invite(
  p_token_hash text,
  p_user_id uuid,
  p_email_normalized text
)
RETURNS TABLE (venue_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_invite public.venue_operator_invites%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_user_id IS NULL OR p_email_normalized IS NULL
     OR p_email_normalized <> lower(btrim(p_email_normalized))
     OR p_email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invite is invalid or unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_invite
    FROM public.venue_operator_invites
    WHERE token_hash = p_token_hash
    FOR UPDATE;

  IF NOT FOUND OR v_invite.status <> 'pending'
     OR v_invite.expires_at <= now()
     OR v_invite.role <> 'operator' OR v_invite.delivery_state <> 'sent' THEN
    RAISE EXCEPTION 'invite is invalid or unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF v_invite.email_normalized <> lower(btrim(p_email_normalized)) THEN
    RAISE EXCEPTION 'invite email mismatch' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.venue_operators (venue_id, user_id, role)
  VALUES (v_invite.venue_id, p_user_id, 'operator')
  ON CONFLICT (venue_id, user_id) DO NOTHING;

  UPDATE public.venue_operator_invites
    SET status = 'accepted', accepted_by = p_user_id, accepted_at = now()
    WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.venue_id, 'operator'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_venue_operator_invite(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_venue_operator_invite(text, uuid, text)
  TO service_role;

-- Email delivery cannot share a transaction with PostgreSQL, so exactly-once delivery is
-- impossible. The 15-minute lease exceeds the Auth email request timeout; expired claims can
-- be reclaimed. A retry rotates token_hash first, so only the current token can be accepted.
-- A provider may have sent the previous message before a crash; that old link is fenced out.
CREATE OR REPLACE FUNCTION public.claim_venue_operator_invite_resend(
  p_invite_id uuid, p_token_hash text, p_expires_at timestamptz, p_claim_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE v_claim_id uuid;
BEGIN
  IF p_invite_id IS NULL OR p_claim_id IS NULL OR p_token_hash IS NULL
     OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_expires_at IS NULL
     OR p_expires_at <= now() THEN RETURN NULL; END IF;
  UPDATE public.venue_operator_invites
    SET token_hash = p_token_hash, expires_at = p_expires_at,
        sent_at = NULL, delivery_state = 'sending', delivery_claim_id = p_claim_id,
        delivery_claimed_at = clock_timestamp(),
        delivery_lease_until = clock_timestamp() + interval '15 minutes'
    WHERE id = p_invite_id AND status = 'pending'
      AND expires_at > clock_timestamp()
      AND (delivery_state IN ('sent', 'failed', 'pending_send')
           OR (delivery_state = 'sending' AND delivery_lease_until <= clock_timestamp()))
    RETURNING delivery_claim_id INTO v_claim_id;
  RETURN v_claim_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_venue_operator_invite_delivery(
  p_invite_id uuid, p_token_hash text, p_claim_id uuid, p_sent boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE v_id uuid;
BEGIN
  UPDATE public.venue_operator_invites
    SET delivery_state = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
        sent_at = CASE WHEN p_sent THEN now() ELSE NULL END
    WHERE id = p_invite_id AND token_hash = p_token_hash
      AND delivery_claim_id = p_claim_id
      AND status = 'pending' AND expires_at > clock_timestamp() AND delivery_state = 'sending'
      AND delivery_lease_until > clock_timestamp()
    RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_venue_operator_invite_resend(uuid, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_venue_operator_invite_resend(uuid, text, timestamptz, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.finish_venue_operator_invite_delivery(uuid, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_venue_operator_invite_delivery(uuid, text, uuid, boolean)
  TO service_role;
