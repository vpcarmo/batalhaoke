import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
