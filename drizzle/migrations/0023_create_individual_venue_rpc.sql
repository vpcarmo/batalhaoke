CREATE OR REPLACE FUNCTION public.create_individual_venue_with_owner(
  p_name text,
  p_slug text,
  p_owner_user_id uuid
)
RETURNS TABLE (
  account_id uuid,
  venue_id uuid,
  slug text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_account_id uuid;
  v_venue_id uuid;
  v_slug text;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'venue name must not be empty' USING ERRCODE = '22023';
  END IF;

  IF p_slug IS NULL
     OR char_length(p_slug) < 3
     OR char_length(p_slug) > 51
     OR p_slug !~ '^v-[a-z0-9][a-z0-9-]{0,48}$'
  THEN
    RAISE EXCEPTION 'venue slug has invalid format'
      USING ERRCODE = '22023';
  END IF;

  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner user id must not be null' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.accounts (type, name)
  VALUES ('individual', btrim(p_name))
  RETURNING id INTO v_account_id;

  INSERT INTO public.venues AS venue (name, slug, account_id)
  VALUES (btrim(p_name), p_slug, v_account_id)
  RETURNING venue.id, venue.slug INTO v_venue_id, v_slug;

  INSERT INTO public.account_members (account_id, user_id, role)
  VALUES (v_account_id, p_owner_user_id, 'owner');

  INSERT INTO public.venue_operators (venue_id, user_id, role)
  VALUES (v_venue_id, p_owner_user_id, 'owner');

  RETURN QUERY SELECT v_account_id, v_venue_id, v_slug;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_individual_venue_with_owner(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_individual_venue_with_owner(text, text, uuid)
  TO service_role;
