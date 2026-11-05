import { z } from "zod";
import { AuthorizationError, PLATFORM_DENIED, assertPlatformAdmin } from "./auth.server";

/* Minimal structural type of the privileged client used here (keeps tests mockable). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = any;

export class SuperadminError extends Error {
  constructor(
    message: string,
    public code: "validation" | "not_found" | "not_confirmed" | "conflict" | "uncertain" | "failed",
  ) {
    super(message);
  }
}

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const venueNameSchema = z.string().trim().min(2).max(120);
export const roleSchema = z.enum(["owner", "operator"]);
const rpcVenueResultSchema = z.object({
  account_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  slug: z.string().min(1),
});

const PER_PAGE = 200;
const MAX_PAGES = 50;

export async function requirePlatformAdmin(admin: AdminClient, userId: unknown) {
  await assertPlatformAdmin(admin, userId);
}

export type FoundUser = { id: string; email: string; emailConfirmed: boolean };

/** Exact-email lookup across all Auth pages; never returns lists to the browser. */
export async function findUserByEmail(
  admin: AdminClient,
  rawEmail: string,
): Promise<FoundUser | null> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw new SuperadminError("E-mail inválido.", "validation");
  const email = parsed.data;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error)
      throw new SuperadminError(
        "Não foi possível consultar as contas. Tente novamente.",
        "uncertain",
      );
    const users: { id: string; email?: string | null; email_confirmed_at?: string | null }[] =
      data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return { id: hit.id, email, emailConfirmed: Boolean(hit.email_confirmed_at) };
    if (users.length < PER_PAGE) return null;
  }
  throw new SuperadminError(
    "Não foi possível confirmar a busca (limite de páginas atingido).",
    "uncertain",
  );
}

async function requireConfirmedUser(admin: AdminClient, email: string) {
  const user = await findUserByEmail(admin, email);
  if (!user) throw new SuperadminError("Conta não encontrada para este e-mail.", "not_found");
  if (!user.emailConfirmed)
    throw new SuperadminError("A conta ainda não confirmou o e-mail.", "not_confirmed");
  return user;
}

export function slugBase(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `v-${base || "bar"}`;
}

function randomSuffix() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function listVenues(admin: AdminClient) {
  const { data: venues, error } = await admin
    .from("venues")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new SuperadminError("Não foi possível listar os estabelecimentos.", "failed");
  const { data: links, error: linkError } = await admin.from("venue_operators").select("venue_id");
  if (linkError) throw new SuperadminError("Não foi possível listar os vínculos.", "failed");
  const counts = new Map<string, number>();
  for (const l of (links ?? []) as { venue_id: string }[])
    counts.set(l.venue_id, (counts.get(l.venue_id) ?? 0) + 1);
  return (
    (venues ?? []) as { id: string; name: string; slug: string | null; created_at: string }[]
  ).map((v) => ({
    id: v.id,
    name: v.name,
    slug: v.slug,
    created_at: v.created_at,
    operatorCount: counts.get(v.id) ?? 0,
  }));
}

export async function listOperators(admin: AdminClient, venueId: string) {
  const { data, error } = await admin
    .from("venue_operators")
    .select("venue_id, user_id, role, created_at")
    .eq("venue_id", venueId)
    .order("created_at");
  if (error) throw new SuperadminError("Não foi possível listar os operadores.", "failed");
  const rows = (data ?? []) as {
    venue_id: string;
    user_id: string;
    role: string;
    created_at: string;
  }[];
  return Promise.all(
    rows.map(async (r) => {
      let email: string | null = null;
      try {
        const res = await admin.auth.admin.getUserById(r.user_id);
        email = res?.data?.user?.email ?? null;
      } catch {
        email = null;
      }
      return {
        venue_id: r.venue_id,
        user_id: r.user_id,
        email,
        role: r.role,
        created_at: r.created_at,
      };
    }),
  );
}

export async function linkOperator(
  admin: AdminClient,
  venueId: string,
  email: string,
  role: string,
) {
  const parsedRole = roleSchema.safeParse(role);
  if (!parsedRole.success) throw new SuperadminError("Papel inválido.", "validation");
  const { data: venue, error } = await admin
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .maybeSingle();
  if (error) throw new SuperadminError("Não foi possível verificar o estabelecimento.", "failed");
  if (!venue) throw new SuperadminError("Estabelecimento não encontrado.", "not_found");
  const user = await requireConfirmedUser(admin, email);
  const { data: existing, error: exError } = await admin
    .from("venue_operators")
    .select("id")
    .eq("venue_id", venueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (exError) throw new SuperadminError("Não foi possível verificar vínculos.", "failed");
  if (existing)
    throw new SuperadminError("Esta conta já está vinculada a este estabelecimento.", "conflict");
  const { data: link, error: insError } = await admin
    .from("venue_operators")
    .insert({ venue_id: venueId, user_id: user.id, role: parsedRole.data })
    .select("id")
    .single();
  if (insError?.code === "23505")
    throw new SuperadminError("Esta conta já está vinculada a este estabelecimento.", "conflict");
  if (insError || !link) throw new SuperadminError("Não foi possível criar o vínculo.", "failed");
  return { linkId: link.id as string, userId: user.id, role: parsedRole.data };
}

export type CreateVenueResult = {
  status: "created";
  accountId: string;
  venueId: string;
  slug: string;
  ownerUserId: string;
};

/** Creates the account, venue, and owner links atomically through the server-only RPC. */
export async function createVenueWithOwner(
  admin: AdminClient,
  rawName: string,
  ownerEmail: string,
): Promise<CreateVenueResult> {
  const name = venueNameSchema.safeParse(rawName);
  if (!name.success)
    throw new SuperadminError("Informe um nome entre 2 e 120 caracteres.", "validation");
  const owner = await requireConfirmedUser(admin, ownerEmail);
  const base = slugBase(name.data);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `${base}-${randomSuffix()}`;
    const { data, error } = await admin.rpc("create_individual_venue_with_owner", {
      p_name: name.data,
      p_slug: slug,
      p_owner_user_id: owner.id,
    });
    const slugConstraintCollision =
      error?.code === "23505" &&
      (error?.constraint === "venues_slug_key" ||
        /venues_slug_key/.test(`${error?.message ?? ""} ${error?.details ?? ""}`));
    if (slugConstraintCollision) continue;
    if (error)
      throw new SuperadminError(
        "Resultado incerto ao criar o estabelecimento. Atualize a lista antes de tentar novamente.",
        "uncertain",
      );
    const rows = Array.isArray(data) ? data : null;
    const row = rows?.length === 1 ? rpcVenueResultSchema.safeParse(rows[0]) : null;
    if (!row?.success || row.data.slug !== slug)
      throw new SuperadminError(
        "Resultado incerto ao criar o estabelecimento. Atualize a lista antes de tentar novamente.",
        "uncertain",
      );
    return {
      status: "created",
      accountId: row.data.account_id,
      venueId: row.data.venue_id,
      slug: row.data.slug,
      ownerUserId: owner.id,
    };
  }
  throw new SuperadminError("Não foi possível gerar um identificador único.", "failed");
}
/** Maps any error to a safe client message; internal details only go to server logs. */
export function toClientError(e: unknown): Error {
  if (e instanceof AuthorizationError) return new Error(PLATFORM_DENIED);
  if (e instanceof SuperadminError) return new Error(e.message);
  console.error("[superadmin]", e);
  return new Error("Operação não concluída.");
}
