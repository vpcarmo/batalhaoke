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

async function authorizeMatch(deps: Deps, userId: string, matchId: string) {
  const championshipId = await deps.domain.getChampionshipMatchChampionshipId(deps.db, matchId);
  await deps.auth.assertChampionshipOperator(deps.db, userId, championshipId);
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

export const recordGroupStageTieBreakDecisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(({ data, context }) => run(async (deps) => {
    const input = deps.domain.GroupStageTieDecisionInput.parse(data);
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, input.championshipId);
    return deps.domain.recordGroupStageTieBreakDecision(deps.db, input, context.userId);
  }));

export const finalizeGroupStageAndGenerateQuarterFinalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.finalizeGroupStageAndGenerateQuarterFinals(deps.db, data, context.userId);
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

export const getChampionshipStandingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.getChampionshipStandings(deps.db, data.championshipId);
  }));

export const getChampionshipEliminationBoardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.getChampionshipEliminationBoard(deps.db, data.championshipId);
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

export const setChampionshipMatchPerformancesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    matchId: Id,
    performanceAId: Id,
    performanceBId: Id,
  }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.setChampionshipMatchPerformances(deps.db, data, context.userId);
  }));

export const startChampionshipMatchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.startChampionshipMatch(deps.db, data, context.userId);
  }));

export const startChampionshipPresentationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: Id, slot: z.enum(["a", "b"]) }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.startChampionshipPresentation(deps.db, data, context.userId);
  }));

export const completeChampionshipPresentationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: Id, slot: z.enum(["a", "b"]) }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.completeChampionshipPresentation(deps.db, data, context.userId);
  }));

export const openChampionshipMatchVotingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.openChampionshipMatchVoting(deps.db, data, context.userId);
  }));

export const closeChampionshipMatchVotingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.closeChampionshipMatchVoting(deps.db, data, context.userId);
  }));

export const getChampionshipMatchScoreFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.getChampionshipMatchScore(deps.db, data.matchId, context.userId);
  }));

export const castChampionshipMatchVoteFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    matchId: Id,
    chosenEntryId: Id,
    token: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  }).strict().parse(d))
  .handler(({ data }) => run((deps) => deps.domain.castChampionshipMatchVote(deps.db, data)));

export const advanceChampionshipEliminationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.advanceChampionshipElimination(deps.db, data, context.userId);
  }));

export const recordChampionshipMatchWoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    matchId: Id,
    withdrawnEntryId: Id,
    reason: z.string().trim().min(1).max(1000),
  }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await authorizeMatch(deps, context.userId, data.matchId);
    return deps.domain.recordChampionshipMatchWo(deps.db, data, context.userId);
  }));

export const completeChampionshipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ championshipId: Id }).strict().parse(d))
  .handler(({ data, context }) => run(async (deps) => {
    await deps.auth.assertChampionshipOperator(deps.db, context.userId, data.championshipId);
    return deps.domain.completeChampionship(deps.db, data, context.userId);
  }));
