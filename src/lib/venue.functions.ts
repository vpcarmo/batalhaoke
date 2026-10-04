import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DeviceToken = z.string().min(48).max(128).regex(/^[a-f0-9]+$/i);
const PairingCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/);
const Id = z.string().uuid();
const PairingTtlMs = 10 * 60 * 1000;
const pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newPairingCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let index = 0; index < bytes.length; index += 1) code += pairingAlphabet.charAt(bytes[index]! % pairingAlphabet.length);
  return code;
}

export type TvState = {
  paired: boolean;
  disabled: boolean;
  venueId: string | null;
  venueDeviceId: string | null;
  venueDeviceName: string | null;
  activeSessionId: string | null;
};

/** Resolves a TV exclusively from its secret browser token; no device hashes leave the server. */
export const getTvState = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ deviceToken: DeviceToken }).parse(data))
  .handler(async ({ data }): Promise<TvState> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = await sha256(data.deviceToken);
    const { data: device } = await supabaseAdmin
      .from("venue_devices")
      .select("id, venue_id, name, status")
      .eq("device_token_hash", hash)
      .maybeSingle();
    if (!device) return { paired: false, disabled: false, venueId: null, venueDeviceId: null, venueDeviceName: null, activeSessionId: null };

    // Fire-and-forget: last_seen must not delay the TV's state resolution.
    void supabaseAdmin.from("venue_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
    if (device.status === "disabled") return { paired: false, disabled: true, venueId: null, venueDeviceId: device.id, venueDeviceName: device.name, activeSessionId: null };
    if (device.status !== "paired" || !device.venue_id) return { paired: false, disabled: false, venueId: null, venueDeviceId: device.id, venueDeviceName: device.name, activeSessionId: null };

    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("id")
      .eq("venue_id", device.venue_id)
      .eq("status", "active")
      .maybeSingle();
    return { paired: true, disabled: false, venueId: device.venue_id, venueDeviceId: device.id, venueDeviceName: device.name, activeSessionId: session?.id ?? null };
  });

/** Registers or refreshes a short-lived pending pairing code without exposing database hashes. */
export const registerTvDevice = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ deviceToken: DeviceToken }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = await sha256(data.deviceToken);
    const { data: existing } = await supabaseAdmin.from("venue_devices").select("id, status").eq("device_token_hash", tokenHash).maybeSingle();
    if (existing?.status === "disabled") return { paired: false, disabled: true, pairingCode: null as string | null };
    if (existing?.status === "paired") return { paired: true, disabled: false, pairingCode: null as string | null };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const pairingCode = newPairingCode();
      const pairingCodeHash = await sha256(pairingCode);
      const expiresAt = new Date(Date.now() + PairingTtlMs).toISOString();
      const payload = { pairing_code_hash: pairingCodeHash, pairing_expires_at: expiresAt, status: "pending" };
      const result = existing
        ? await supabaseAdmin.from("venue_devices").update(payload).eq("id", existing.id)
        : await supabaseAdmin.from("venue_devices").insert({ ...payload, device_token_hash: tokenHash });
      if (!result.error) return { paired: false, disabled: false, pairingCode };
      if (result.error.code !== "23505") throw new Error("Não foi possível preparar o pareamento desta TV.");
    }
    throw new Error("Não foi possível gerar um código de pareamento. Tente novamente.");
  });

export const listVenues = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("venues").select("id, name").order("name");
  if (error) throw new Error("Não foi possível carregar estabelecimentos.");
  return data ?? [];
});

export const createVenue = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ name: z.string().trim().min(2).max(100) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: venue, error } = await supabaseAdmin.from("venues").insert({ name: data.name }).select("id, name").single();
    if (error || !venue) throw new Error("Não foi possível criar o estabelecimento.");
    return venue;
  });

export const listVenueDevices = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ venueId: Id }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: devices, error } = await supabaseAdmin.from("venue_devices")
      .select("id, name, status, last_seen_at, created_at")
      .eq("venue_id", data.venueId)
      .order("created_at");
    if (error) throw new Error("Não foi possível carregar as TVs.");
    return devices ?? [];
  });

export const pairVenueDevice = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ pairingCode: PairingCode, venueId: Id.optional(), venueName: z.string().trim().min(2).max(100).optional(), deviceName: z.string().trim().min(1).max(100) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const codeHash = await sha256(data.pairingCode);
    const { data: device } = await supabaseAdmin.from("venue_devices").select("id")
      .eq("pairing_code_hash", codeHash).eq("status", "pending").gt("pairing_expires_at", new Date().toISOString()).maybeSingle();
    if (!device) throw new Error("Código de pareamento inválido ou expirado.");
    let venueId = data.venueId;
    if (!venueId) {
      if (!data.venueName) throw new Error("Selecione ou informe um estabelecimento.");
      const { data: venue, error } = await supabaseAdmin.from("venues").insert({ name: data.venueName }).select("id").single();
      if (error || !venue) throw new Error("Não foi possível criar o estabelecimento.");
      venueId = venue.id;
    }
    const { data: paired, error } = await supabaseAdmin.from("venue_devices")
      .update({ venue_id: venueId, name: data.deviceName, status: "paired", pairing_code_hash: null, pairing_expires_at: null })
      .eq("id", device.id).eq("status", "pending").eq("pairing_code_hash", codeHash)
      .select("id").maybeSingle();
    if (error || !paired) throw new Error("Código de pareamento inválido ou já utilizado.");
    return { venueId, venueDeviceId: paired.id };
  });

export const disableVenueDevice = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ venueDeviceId: Id }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("venue_devices")
      .update({ status: "disabled", pairing_code_hash: null, pairing_expires_at: null })
      .eq("id", data.venueDeviceId);
    if (error) throw new Error("Não foi possível desabilitar a TV.");
  });
