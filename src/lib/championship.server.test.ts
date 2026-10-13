import { describe, expect, it } from "vitest";
import {
  assertCoherentDates,
  canActivateStage,
  canEditChampionship,
  createChampionship,
  CreateChampionshipInput,
  formatChangeBlockReason,
  getChampionship,
  listChampionships,
  transitionChampionshipRegistration,
  updateChampionship,
  UpdateChampionshipInput,
} from "./championship.server";

const venueId = "11111111-1111-4111-8111-111111111111";
const championshipId = "22222222-2222-4222-8222-222222222222";

function makeDb(options: {
  status?: string;
  stageSession?: Record<string, unknown> | null;
  entryCount?: number;
} = {}) {
  const row: Record<string, unknown> = {
    id: championshipId,
    venue_id: venueId,
    title: "Copa",
    format: 8,
    status: options.status ?? "draft",
    event_starts_at: null,
    registration_deadline: null,
    location: null,
    rules: null,
    prize_info: null,
    fee_info: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const touchedTables: string[] = [];
  const mutatedTables: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      touchedTables.push(table);
      const filters: Record<string, unknown> = {};
      let updateValues: Record<string, unknown> | null = null;
      let insertValues: Record<string, unknown> | null = null;
      let isCountQuery = false;
      const resolve = () => {
        if (table === "venues") return { data: { id: venueId }, error: null };
        if (table === "championship_entries") return { data: null, error: null, count: options.entryCount ?? 0 };
        if (table === "sessions") return { data: options.stageSession ?? null, error: null };
        if (insertValues) {
          const created = { ...row, ...insertValues };
          inserted.push(created);
          return { data: created, error: null };
        }
        if (updateValues) {
          const matches = Object.entries(filters).every(([key, value]) => row[key] === value);
          if (matches) Object.assign(row, updateValues);
          return { data: matches ? { ...row } : null, error: null };
        }
        if (filters["venue_id"] === venueId) return { data: [{ ...row }], error: null };
        return { data: filters["id"] === championshipId ? { ...row } : null, error: null };
      };
      const query = {
        select(_columns?: string, optionsArg?: { count?: string; head?: boolean }) {
          isCountQuery = optionsArg?.count === "exact";
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        order() {
          return query;
        },
        update(values: Record<string, unknown>) {
          mutatedTables.push(table);
          updateValues = values;
          return query;
        },
        insert(values: Record<string, unknown>) {
          mutatedTables.push(table);
          insertValues = values;
          return query;
        },
        async maybeSingle() {
          return resolve();
        },
        async single() {
          return resolve();
        },
        then(resolvePromise: (value: unknown) => unknown, rejectPromise: (reason: unknown) => unknown) {
          return Promise.resolve(isCountQuery ? { count: options.entryCount ?? 0, error: null } : resolve())
            .then(resolvePromise, rejectPromise);
        },
      };
      return query;
    },
  };
  return { db: db as never, row, touchedTables, mutatedTables, inserted };
}

describe("championship rules", () => {
  it("accepts only formats 8, 12 and 16", () => {
    for (const format of [8, 12, 16]) expect(CreateChampionshipInput.safeParse({ venueId, title: "Copa", format }).success).toBe(true);
    for (const format of [4, 10, 32]) expect(CreateChampionshipInput.safeParse({ venueId, title: "Copa", format }).success).toBe(false);
  });
  it("rejects an empty title", () => {
    expect(CreateChampionshipInput.safeParse({ venueId, title: "   ", format: 8 }).success).toBe(false);
  });
  it("rejects a status field in updates", () => {
    expect(UpdateChampionshipInput.safeParse({ championshipId: venueId, patch: { status: "drawn" } }).success).toBe(false);
  });
  it("rejects registration deadline after the event start", () => {
    expect(() => assertCoherentDates("2026-12-02T20:00:00Z", "2026-12-01T20:00:00Z")).toThrow();
    expect(() => assertCoherentDates("2026-12-01T20:00:00Z", "2026-12-01T20:00:00Z")).not.toThrow();
  });
  it("locks the format when any entry exists or status is not draft", () => {
    expect(formatChangeBlockReason("draft", 0)).toBeNull();
    expect(formatChangeBlockReason("draft", 1)).not.toBeNull();
    expect(formatChangeBlockReason("registration_open", 0)).not.toBeNull();
  });
  it("allows editing only in draft", () => {
    expect(canEditChampionship("draft")).toBe(true);
    expect(canEditChampionship("registration_open")).toBe(false);
    expect(canEditChampionship("registration_closed")).toBe(false);
    expect(canEditChampionship("cancelled")).toBe(false);
  });
  it("allows starting the stage only after the draw", () => {
    expect(canActivateStage("draft")).toBe(false);
    expect(canActivateStage("registration_closed")).toBe(false);
    expect(canActivateStage("drawn")).toBe(true);
    expect(canActivateStage("completed")).toBe(false);
  });

  it("does not create a stage-session association when creating a championship", async () => {
    const { db, inserted, touchedTables } = makeDb();
    const created = await createChampionship(db, { venueId, title: "Copa", format: 8 });

    expect(created.status).toBe("draft");
    expect(inserted[0]).not.toHaveProperty("championship_id");
    expect(touchedTables).not.toContain("sessions");
  });

  it("lists championships scoped to the requested venue", async () => {
    const { db } = makeDb();
    await expect(listChampionships(db, venueId)).resolves.toMatchObject([{ id: championshipId }]);
  });

  it("rejects edits after the championship leaves draft", async () => {
    const { db } = makeDb({ status: "registration_open" });
    await expect(updateChampionship(db, {
      championshipId,
      patch: { title: "Novo título" },
    })).rejects.toThrow("não pode mais ser editado");
  });

  it("allows only draft-to-open and open-to-closed registration transitions", async () => {
    const draft = makeDb();
    await expect(transitionChampionshipRegistration(draft.db, { championshipId }, "close"))
      .rejects.toThrow("só podem ser encerradas");

    const open = makeDb({ status: "registration_open" });
    await expect(transitionChampionshipRegistration(open.db, { championshipId }, "open"))
      .rejects.toThrow("só podem ser abertas");

    const validOpen = makeDb();
    await expect(transitionChampionshipRegistration(validOpen.db, { championshipId }, "open"))
      .resolves.toMatchObject({ status: "registration_open" });
    const validClose = makeDb({ status: "registration_open" });
    await expect(transitionChampionshipRegistration(validClose.db, { championshipId }, "close"))
      .resolves.toMatchObject({ status: "registration_closed" });
  });

  it("returns the optional stage-session association without exposing entry contacts", async () => {
    const stageSession = {
      id: "33333333-3333-4333-8333-333333333333",
      championship_id: championshipId,
      status: "draft",
    };
    const { db, mutatedTables } = makeDb({ stageSession });
    const result = await getChampionship(db, championshipId);
    expect(result.stageSession).toEqual(stageSession);
    expect(result).not.toHaveProperty("entries");
    await updateChampionship(db, { championshipId, patch: { title: "Copa atualizada" } });
    expect((await getChampionship(db, championshipId)).stageSession).toEqual(stageSession);
    expect(mutatedTables).not.toContain("sessions");
  });
});
