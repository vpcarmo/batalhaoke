import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Administrative wrappers resolve and authorize the real venue server-side.
// Domain rules stay in championship.server.ts; public registration endpoints intentionally omit auth.

const Id = z.string().uuid();

async function loadDeps() {
  const [{ supabaseAdmin }, auth, domain] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./auth.server"),
    import("./championship.server"),
  ]);
  return { db: supabaseAdmin, auth, domain };
}

type Deps = Awaited<ReturnType<typeof loadDeps>>;

async function run<T>(fn: (deps: Deps) => Promise<T>): Promise<T> {
  const deps = await loadDeps();
  try {
    return await fn(deps);
  } catch (e) {
    if (e instanceof deps.auth.AuthorizationError || e instanceof deps.domain.ChampionshipError) throw new Error(e.message);
    if (e instanceof z.ZodError) throw new Error(e.issues[0]?.message ?? "Dados inválidos.");
    console.error("[championship]", e);
    throw new Error("Não foi possível concluir a operação.");
  }
}

export const createChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(({ data, context }) => run(async (deps) => {
    const input = deps.domain.CreateChampionshipInput.parse(data);
    await deps.auth.assertVenueOperator(deps.db, context.userId, input.venueId);
    return deps.domain.createChampionship(deps.db, input);
  }));

export const listChampionshipsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ venueId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertVenueOperator(deps.db, context.userId, data.venueId);
    return deps.domain.listChampionships(deps.db, data.venueId);
  }));

export const getChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.getChampionship(deps.db, data.championshipId);
  }));

export const getPublicChampionshipRegistrationFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data }) =>
    run((deps) => deps.domain.getPublicChampionshipRegistration(deps.db, data.championshipId)),
  );

export const registerChampionshipEntryFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => d)
  .handler(({ data }) => run((deps) => deps.domain.registerChampionshipEntry(deps.db, data)));

export const listChampionshipEntriesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) =>
    run(async (deps) => {
      await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
      return deps.domain.listChampionshipEntries(deps.db, data.championshipId);
    }),
  );

export const updateChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(({ data, context }) => run(async (deps) => {
    const input = deps.domain.UpdateChampionshipInput.parse(data);
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, input.championshipId);
    return deps.domain.updateChampionship(deps.db, input);
  }));

export const openChampionshipRegistrationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.transitionChampionshipRegistration(deps.db, data, "open");
  }));

export const closeChampionshipRegistrationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.transitionChampionshipRegistration(deps.db, data, "close");
  }));

export const drawChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.drawChampionship(deps.db, data.championshipId);
  }));

export const getChampionshipDrawFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.getChampionshipDraw(deps.db, data.championshipId);
  }));

export const getChampionshipScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.getChampionshipSchedule(deps.db, data.championshipId);
  }));

export const prepareStageSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    const venueId = await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.prepareStageSession(deps.db, { championshipId: data.championshipId, venueId });
  }));

export const activateStageSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id, sessionId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    const venueId = await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.activateStageSession(deps.db, { ...data, venueId });
  }));
