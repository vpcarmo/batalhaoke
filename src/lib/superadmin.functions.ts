import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function authRedirectUrl() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request?.url) throw new Error("NÃ£o foi possÃ­vel determinar a URL de retorno.");
  return new URL("/login", request.url).toString();
}

// Every handler: auth middleware -> assertPlatformAdmin (live Auth lookup) -> work. Admin client loaded inside handlers only.
async function guarded<T>(
  userId: string,
  work: (admin: unknown, m: typeof import("./superadmin.server")) => Promise<T>,
) {
  const [{ supabaseAdmin }, m] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./superadmin.server"),
  ]);
  try {
    await m.requirePlatformAdmin(supabaseAdmin, userId);
    return await work(supabaseAdmin, m);
  } catch (e) {
    throw m.toClientError(e);
  }
}

export const getSuperadminStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ supabaseAdmin }, { assertPlatformAdmin }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./auth.server"),
    ]);
    try {
      await assertPlatformAdmin(supabaseAdmin, context.userId);
      return { isSuperadmin: true };
    } catch {
      return { isSuperadmin: false };
    }
  });

export const listSuperadminVenuesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => guarded(context.userId, (a, m) => m.listVenues(a)));

export const listVenueOperatorsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ venueId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) => m.listOperators(a, data.venueId)),
  );

export const findConfirmedUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ email: z.string().max(254) }).parse(d))
  .handler(({ data, context }) =>
    guarded(context.userId, async (a, m) => ({ user: await m.findUserByEmail(a, data.email) })),
  );

export const createVenueWithOwnerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ name: z.string().max(200), ownerEmail: z.string().max(254) }).parse(d),
  )
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) => m.createVenueWithOwner(a, data.name, data.ownerEmail)),
  );

export const linkVenueOperatorFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        venueId: z.string().uuid(),
        email: z.string().max(254),
        role: z.enum(["owner", "operator"]),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) => m.linkOperator(a, data.venueId, data.email, data.role)),
  );

export const listSuperadminUsersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        page: z.number().int().min(1).max(100000),
        perPage: z.number().int().min(1).max(50),
        email: z.string().max(254).optional(),
      })
      .parse(d),
  )
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) =>
      m.listUsers(a, {
        page: data.page,
        perPage: data.perPage,
        ...(data.email ? { email: data.email } : {}),
      }),
    ),
  );

export const getSuperadminUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) => m.getUserDetails(a, data.userId)),
  );

export const createSuperadminUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ name: z.string().max(120), email: z.string().max(254) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const redirectTo = await authRedirectUrl();
    return guarded(context.userId, (a, m) => m.createUser(a, data, redirectTo));
  });

export const updateSuperadminUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ userId: z.string().uuid(), name: z.string().max(120), email: z.string().max(254) })
      .parse(d),
  )
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) =>
      m.updateUser(a, { id: data.userId, name: data.name, email: data.email }),
    ),
  );

export const banSuperadminUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), banned: z.boolean() }).parse(d))
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) => m.setUserBanned(a, context.userId, data.userId, data.banned)),
  );

export const recoverSuperadminUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ email: z.string().max(254) }).parse(d))
  .handler(async ({ data, context }) => {
    const redirectTo = await authRedirectUrl();
    return guarded(context.userId, (a, m) => m.sendPasswordRecovery(a, data.email, redirectTo));
  });

export const deleteSuperadminUserFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), emailConfirmation: z.string().max(254) }).parse(d),
  )
  .handler(({ data, context }) =>
    guarded(context.userId, (a, m) =>
      m.deleteUser(a, context.userId, data.userId, data.emailConfirmation),
    ),
  );
