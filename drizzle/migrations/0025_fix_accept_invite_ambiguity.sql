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
#variable_conflict use_column
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