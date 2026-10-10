import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Every wrapper: JWT (middleware) → resolve the real venue server-side → assertVenueOperator → domain fn.
// Domain rules stay in championship.server.ts; nothing here re-implements them.

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

async function venueOfChampionship(deps: Deps, championshipId: string) {
  const { data, error } = await deps.db.from("championships").select("venue_id").eq("id", championshipId).maybeSingle();
  // Same message for "missing" and "not yours" so IDs from other venues are not probeable.
  if (error || !data) throw new deps.auth.AuthorizationError("Você não tem permissão para administrar este estabelecimento.");
  return data.venue_id;
}

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

export const getChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    const venueId = await venueOfChampionship(deps, data.championshipId);
    await deps.auth.assertVenueOperator(deps.db, context.userId, venueId);
    return deps.domain.getChampionship(deps.db, data.championshipId);
  }));

export const updateChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(({ data, context }) => run(async (deps) => {
    const input = deps.domain.UpdateChampionshipInput.parse(data);
    const venueId = await venueOfChampionship(deps, input.championshipId);
    await deps.auth.assertVenueOperator(deps.db, context.userId, venueId);
    return deps.domain.updateChampionship(deps.db, input);
  }));

export const prepareStageSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    const venueId = await venueOfChampionship(deps, data.championshipId);
    await deps.auth.assertVenueOperator(deps.db, context.userId, venueId);
    return deps.domain.prepareStageSession(deps.db, { championshipId: data.championshipId, venueId });
  }));

export const activateStageSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id, sessionId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    const venueId = await venueOfChampionship(deps, data.championshipId);
    await deps.auth.assertVenueOperator(deps.db, context.userId, venueId);
    return deps.domain.activateStageSession(deps.db, { ...data, venueId });
  }));
