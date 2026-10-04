-- TV pairing is server-mediated. Pending devices intentionally have no venue
-- until an operator enters their short-lived pairing code.
CREATE TABLE public.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.venue_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid REFERENCES public.venues(id) ON DELETE CASCADE,
  name text,
  device_token_hash text NOT NULL UNIQUE,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paired', 'disabled')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_devices_pairing_state_check CHECK (
    (status = 'pending' AND venue_id IS NULL AND pairing_code_hash IS NOT NULL AND pairing_expires_at IS NOT NULL)
    OR (status = 'paired' AND venue_id IS NOT NULL AND pairing_code_hash IS NULL AND pairing_expires_at IS NULL)
    OR (status = 'disabled' AND pairing_code_hash IS NULL AND pairing_expires_at IS NULL)
  )
);

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venues(id);

CREATE INDEX sessions_active_venue_id_idx ON public.sessions(venue_id, started_at DESC)
  WHERE status = 'active' AND venue_id IS NOT NULL;
CREATE UNIQUE INDEX sessions_one_active_per_venue ON public.sessions(venue_id)
  WHERE status = 'active' AND venue_id IS NOT NULL;
CREATE INDEX venue_devices_venue_id_idx ON public.venue_devices(venue_id);
CREATE INDEX venue_devices_device_token_hash_idx ON public.venue_devices(device_token_hash);
CREATE UNIQUE INDEX venue_devices_pairing_code_hash_idx ON public.venue_devices(pairing_code_hash)
  WHERE pairing_code_hash IS NOT NULL;

CREATE TRIGGER t_venues BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t_venue_devices BEFORE UPDATE ON public.venue_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT ALL ON public.venues, public.venue_devices TO service_role;
REVOKE ALL ON public.venues, public.venue_devices FROM anon, authenticated;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_devices ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: venue and device pairing data are served only
-- through server functions, so device/pairing hashes are never publicly readable.

ALTER PUBLICATION supabase_realtime ADD TABLE public.venue_devices;
