import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Id = z.string().uuid();
async function deps() {
  const [{ supabaseAdmin }, auth, invites] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./auth.server"),
    import("./operator-invites.server"),
  ]);
  return {
    auth,
    invites,
    service: invites.createDefaultInviteDeps(supabaseAdmin, auth, supabaseAdmin),
  };
}
async function run<T>(work: (d: Awaited<ReturnType<typeof deps>>) => Promise<T>): Promise<T> {
  try {
    return await work(await deps());
  } catch (error) {
    if (error instanceof z.ZodError)
      throw new Error(error.issues[0]?.message ?? "Dados inválidos.");
    if (
      error instanceof Error &&
      (error.name === "AuthorizationError" || error.name === "OperatorInviteError")
    )
      throw new Error(error.message);
    console.error("[operator-invites] operation failed");
    throw new Error("Não foi possível concluir a operação.");
  }
}

export const createVenueOperatorInviteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ venueId: Id, email: z.string().trim().email().max(254) })
      .strict()
      .parse(input),
  )
  .handler(({ data, context }) =>
    run(({ service, invites }) => invites.createInvite(service, context.userId, data)),
  );

export const listVenueOperatorInvitesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ venueId: Id }).strict().parse(input))
  .handler(({ data, context }) =>
    run(({ service, invites }) => invites.listInvites(service, context.userId, data.venueId)),
  );

export const cancelVenueOperatorInviteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ inviteId: Id }).strict().parse(input))
  .handler(({ data, context }) =>
    run(({ service, invites }) => invites.cancelInvite(service, context.userId, data.inviteId)),
  );

export const resendVenueOperatorInviteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ inviteId: Id }).strict().parse(input))
  .handler(({ data, context }) =>
    run(({ service, invites }) => invites.resendInvite(service, context.userId, data.inviteId)),
  );

export const acceptVenueOperatorInviteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z
          .string()
          .min(40)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/),
      })
      .strict()
      .parse(input),
  )
  .handler(({ data, context }) =>
    run(({ service, invites }) => invites.acceptInvite(service, context.userId, data.token)),
  );
