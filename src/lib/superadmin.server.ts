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
export const userNameSchema = z.string().trim().min(1).max(120);
const userIdSchema = z.string().uuid();
const rpcVenueResultSchema = z.object({
  account_id: z.string().uuid(),
  venue_id: z.string().uuid(),
  slug: z.string().min(1),
});

const PER_PAGE = 200;
const MAX_PAGES = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function authUser(u: any) {
  return {
    id: u.id as string,
    name: (u.user_metadata?.full_name ?? u.user_metadata?.name ?? "") as string,
    email: (u.email ?? "") as string,
    createdAt: (u.created_at ?? "") as string,
    emailConfirmed: Boolean(u.email_confirmed_at),
    banned: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
    isSuperadmin: u.app_metadata?.platform_role === "superadmin",
  };
}

export async function listUsers(
  admin: AdminClient,
  raw: { page: number; perPage: number; email?: string },
) {
  const page = z.number().int().min(1).max(100000).parse(raw.page);
  const perPage = z.number().int().min(1).max(50).parse(raw.perPage);
  const email = raw.email?.trim().toLowerCase();
  if (email && email.length > 254) throw new SuperadminError("E-mail invÃ¡lido.", "validation");
  if (email) {
    // Auth Admin has no email filter. Scan bounded pages and return matching rows only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches: any[] = [];
    for (let scanPage = 1; scanPage <= MAX_PAGES; scanPage++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page: scanPage,
        perPage: PER_PAGE,
      });
      if (error) throw new SuperadminError("NÃ£o foi possÃ­vel pesquisar usuÃ¡rios.", "failed");
      const rows = data?.users ?? [];
      matches.push(
        ...rows
          .map(authUser)
          .filter((u: ReturnType<typeof authUser>) => u.email.toLowerCase().includes(email)),
      );
      if (rows.length < PER_PAGE) break;
      if (scanPage === MAX_PAGES)
        throw new SuperadminError("A pesquisa excedeu o limite seguro de pÃ¡ginas.", "uncertain");
    }
    const start = (page - 1) * perPage;
    return {
      users: matches.slice(start, start + perPage),
      page,
      perPage,
      hasMore: matches.length > start + perPage,
    };
  }
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
  if (error) throw new SuperadminError("NÃ£o foi possÃ­vel listar usuÃ¡rios.", "failed");
  return {
    users: (data?.users ?? []).map(authUser),
    page,
    perPage,
    hasMore: (data?.users?.length ?? 0) === perPage,
  };
}

export async function getUserDetails(admin: AdminClient, rawId: string) {
  const id = userIdSchema.parse(rawId);
  const [
    { data: auth, error: authError },
    { data: accounts, error: accountError },
    { data: venues, error: venueError },
  ] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin
      .from("account_members")
      .select("account_id, role, created_at, accounts(id, name, type)")
      .eq("user_id", id),
    admin
      .from("venue_operators")
      .select("venue_id, role, created_at, venues(id, name)")
      .eq("user_id", id),
  ]);
  if (authError || !auth?.user) throw new SuperadminError("UsuÃ¡rio nÃ£o encontrado.", "not_found");
  if (accountError || venueError)
    throw new SuperadminError("NÃ£o foi possÃ­vel consultar os vÃ­nculos.", "failed");
  return { ...authUser(auth.user), accounts: accounts ?? [], venues: venues ?? [] };
}

export async function createUser(
  admin: AdminClient,
  raw: { name: string; email: string },
  redirectTo: string,
) {
  const name = userNameSchema.safeParse(raw.name);
  const email = emailSchema.safeParse(raw.email);
  if (!name.success || !email.success)
    throw new SuperadminError("Informe nome e e-mail vÃ¡lidos.", "validation");
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.data, {
    data: { full_name: name.data },
    redirectTo,
  });
  if (error || !data?.user)
    throw new SuperadminError(error?.message ?? "NÃ£o foi possÃ­vel convidar usuÃ¡rio.", "failed");
  return authUser(data.user);
}

export async function updateUser(
  admin: AdminClient,
  raw: { id: string; name: string; email: string },
) {
  const id = userIdSchema.parse(raw.id);
  const name = userNameSchema.safeParse(raw.name);
  const email = emailSchema.safeParse(raw.email);
  if (!name.success || !email.success)
    throw new SuperadminError("Informe nome e e-mail vÃ¡lidos.", "validation");
  const { data, error } = await admin.auth.admin.updateUserById(id, {
    email: email.data,
    user_metadata: { full_name: name.data },
  });
  if (error || !data?.user)
    throw new SuperadminError(error?.message ?? "NÃ£o foi possÃ­vel atualizar usuÃ¡rio.", "failed");
  return authUser(data.user);
}

async function ownerCounts(admin: AdminClient, id: string) {
  const [{ data: accounts, error: ae }, { data: venues, error: ve }] = await Promise.all([
    admin.from("account_members").select("account_id").eq("user_id", id).eq("role", "owner"),
    admin.from("venue_operators").select("venue_id").eq("user_id", id).eq("role", "owner"),
  ]);
  if (ae || ve)
    throw new SuperadminError("NÃ£o foi possÃ­vel validar os proprietÃ¡rios.", "failed");
  for (const a of accounts ?? []) {
    const { count, error } = await admin
      .from("account_members")
      .select("id", { count: "exact", head: true })
      .eq("account_id", a.account_id)
      .eq("role", "owner");
    if (error)
      throw new SuperadminError("NÃ£o foi possÃ­vel validar proprietÃ¡rios da conta.", "failed");
    if ((count ?? 0) <= 1)
      throw new SuperadminError("UsuÃ¡rio Ã© o Ãºltimo proprietÃ¡rio de uma conta.", "conflict");
  }
  for (const v of venues ?? []) {
    const { count, error } = await admin
      .from("venue_operators")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", v.venue_id)
      .eq("role", "owner");
    if (error)
      throw new SuperadminError(
        "NÃ£o foi possÃ­vel validar proprietÃ¡rios do estabelecimento.",
        "failed",
      );
    if ((count ?? 0) <= 1)
      throw new SuperadminError(
        "UsuÃ¡rio Ã© o Ãºltimo proprietÃ¡rio de um estabelecimento.",
        "conflict",
      );
  }
}

export async function setUserBanned(
  admin: AdminClient,
  executorId: string,
  targetId: string,
  banned: boolean,
) {
  const id = userIdSchema.parse(targetId);
  if (banned && executorId === id)
    throw new SuperadminError("NÃ£o Ã© permitido bloquear a prÃ³pria conta.", "conflict");
  if (banned) await ownerCounts(admin, id);
  const { data, error } = await admin.auth.admin.updateUserById(id, {
    ban_duration: banned ? "876000h" : "none",
  });
  if (error || !data?.user)
    throw new SuperadminError("NÃ£o foi possÃ­vel alterar o bloqueio.", "failed");
  return authUser(data.user);
}

export async function sendPasswordRecovery(
  admin: AdminClient,
  rawEmail: string,
  redirectTo: string,
) {
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) throw new SuperadminError("E-mail invÃ¡lido.", "validation");
  const { error } = await admin.auth.resetPasswordForEmail(email.data, { redirectTo });
  if (error)
    throw new SuperadminError("NÃ£o foi possÃ­vel enviar a recuperaÃ§Ã£o de senha.", "failed");
  return { sent: true };
}

export async function deleteUser(
  admin: AdminClient,
  executorId: string,
  targetId: string,
  emailConfirmation: string,
) {
  const id = userIdSchema.parse(targetId);
  if (id === executorId)
    throw new SuperadminError("NÃ£o Ã© permitido excluir a prÃ³pria conta.", "conflict");
  const details = await getUserDetails(admin, id);
  if (details.email.toLowerCase() !== emailConfirmation.trim().toLowerCase())
    throw new SuperadminError(
      "O e-mail de confirmaÃ§Ã£o nÃ£o corresponde ao usuÃ¡rio.",
      "validation",
    );
  await ownerCounts(admin, id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountRows = details.accounts.map((r: any) => ({
    account_id: r.account_id,
    user_id: id,
    role: r.role,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const venueRows = details.venues.map((r: any) => ({
    venue_id: r.venue_id,
    user_id: id,
    role: r.role,
  }));
  // All integrity checks complete before the first write. Restore removed links if Auth deletion fails.
  if (accountRows.length) {
    const { error } = await admin.from("account_members").delete().eq("user_id", id);
    if (error)
      throw new SuperadminError("NÃ£o foi possÃ­vel remover vÃ­nculos da conta.", "failed");
  }
  if (venueRows.length) {
    const { error } = await admin.from("venue_operators").delete().eq("user_id", id);
    if (error) {
      const restored = accountRows.length
        ? await admin.from("account_members").insert(accountRows)
        : { error: null };
      if (restored.error)
        throw new SuperadminError(
          "Falha ao remover vÃ­nculos e ao restaurar a conta; requer reconciliaÃ§Ã£o administrativa.",
          "uncertain",
        );
      throw new SuperadminError(
        "NÃ£o foi possÃ­vel remover vÃ­nculos do estabelecimento.",
        "failed",
      );
    }
  }
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    const rollback = await Promise.all([
      accountRows.length
        ? admin.from("account_members").insert(accountRows)
        : Promise.resolve({ error: null }),
      venueRows.length
        ? admin.from("venue_operators").insert(venueRows)
        : Promise.resolve({ error: null }),
    ]);
    if (rollback.some((r) => "error" in r && r.error))
      throw new SuperadminError(
        "Falha ao excluir e ao restaurar vÃ­nculos; requer reconciliaÃ§Ã£o administrativa.",
        "uncertain",
      );
    throw new SuperadminError(
      "NÃ£o foi possÃ­vel excluir usuÃ¡rio; vÃ­nculos restaurados.",
      "failed",
    );
  }
  return { deleted: true };
}

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
