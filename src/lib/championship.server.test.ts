import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCoherentDates,
  canActivateStage,
  canEditChampionship,
  createChampionship,
  CreateChampionshipInput,
  formatChangeBlockReason,
  getChampionship,
  getPublicChampionshipRegistration,
  listChampionships,
  listChampionshipEntries,
  registerChampionshipEntry,
  transitionChampionshipRegistration,
  updateChampionship,
  UpdateChampionshipInput,
} from "./championship.server";
import { DEFAULT_PROVIDER } from "./playback/registry";

const venueId = "11111111-1111-4111-8111-111111111111";
const championshipId = "22222222-2222-4222-8222-222222222222";
const atomicRegistrationMigration = readFileSync(
  new URL("../../drizzle/migrations/0013_championship_atomic_registration.sql", import.meta.url),
  "utf8",
);

function makeRegistrationDb(
  options: {
    status?: string;
    deadline?: string | null;
    confirmedCount?: number;
    format?: number;
    missing?: boolean;
    duplicateContact?: boolean;
    sourceError?: boolean;
    songError?: boolean;
  } = {},
) {
  const championship = options.missing
    ? null
    : {
        id: championshipId,
        venue_id: venueId,
        title: "Copa",
        format: options.format ?? 8,
        status: options.status ?? "registration_open",
        event_starts_at: null,
        registration_deadline: options.deadline ?? null,
        location: "Centro",
        rules: "Regras",
        prize_info: null,
        fee_info: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
  const entries: Array<Record<string, unknown>> = Array.from(
    { length: options.confirmedCount ?? 0 },
    (_, index) => ({
      id: `existing-${index}`,
      championship_id: championshipId,
      status: "confirmed",
    }),
  );
  const sources: Record<string, unknown>[] = [];
  const songs: Record<string, unknown>[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name !== "register_championship_entry")
        return { data: null, error: { code: "42883", message: "unknown function" } };
      if (!championship)
        return { data: null, error: { code: "P0002", message: "Campeonato não encontrado." } };
      if (championship.status !== "registration_open")
        return {
          data: null,
          error: { code: "P0001", message: "As inscrições deste Campeonato não estão abertas." },
        };
      if (
        championship.registration_deadline &&
        new Date(championship.registration_deadline).getTime() <= Date.now()
      ) {
        return {
          data: null,
          error: { code: "P0001", message: "O prazo de inscrição deste Campeonato terminou." },
        };
      }

      const incomingSongs = args["p_songs"] as Array<Record<string, unknown>>;
      if (
        incomingSongs.some(
          (item) =>
            typeof item["provider"] !== "string" ||
            !/^[a-z][a-z0-9_-]{0,39}$/.test(item["provider"]) ||
            typeof item["external_id"] !== "string" ||
            !/^[A-Za-z0-9_-]{1,200}$/.test(item["external_id"]),
        )
      ) {
        return { data: null, error: { code: "22023", message: "Fonte de música inválida." } };
      }
      if (options.duplicateContact)
        return {
          data: null,
          error: { code: "23505", message: "championship_entries_email_unique" },
        };
      if (options.sourceError || options.songError)
        return { data: null, error: { code: "22023", message: "Falha na validação da música." } };

      const status =
        entries.filter((entry) => entry["status"] === "confirmed").length <
        (options.format ?? 8)
          ? "confirmed"
          : "waitlist";
      const id = `30000000-0000-4000-8000-${String(entries.length + 1).padStart(12, "0")}`;
      entries.push({
        id,
        championship_id: championshipId,
        name: args["p_name"],
        contact_email: args["p_contact_email"],
        contact_phone: args["p_contact_phone"],
        status,
      });
      for (const item of incomingSongs) {
        const existing = sources.find(
          (source) =>
            source["provider"] === item["provider"] &&
            source["external_id"] === item["external_id"],
        );
        const sourceId = existing?.["id"] ?? `source-${sources.length + 1}`;
        if (!existing)
          sources.push({
            id: sourceId,
            provider: item["provider"],
            external_id: item["external_id"],
            title: item["title"],
            channel_name: item["channel_name"],
            thumbnail_url: item["thumbnail_url"],
            duration: item["duration"],
          });
        songs.push({
          entry_id: id,
          playback_source_id: sourceId,
          song_type: item["song_type"],
          song_order: item["song_order"],
        });
      }
      return { data: { id, status }, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let selectOptions: { count?: string } | undefined;
      let insertValues: Record<string, unknown> | Record<string, unknown>[] | null = null;
      let isDelete = false;
      const resolve = () => {
        if (table === "championships") return { data: championship, error: null };
        if (table === "championship_entries" && selectOptions?.count === "exact") {
          return {
            count: entries.filter((entry) => entry["status"] === filters["status"]).length,
            error: null,
          };
        }
        if (table === "playback_sources" && insertValues) {
          if (options.sourceError)
            return { data: null, error: { code: "23503", message: "invalid source" } };
          const values = insertValues as Record<string, unknown>;
          const existing = sources.find(
            (source) =>
              source["provider"] === values["provider"] &&
              source["external_id"] === values["external_id"],
          );
          if (existing)
            return {
              data: null,
              error: { code: "23505", message: "playback_sources_provider_external_id_key" },
            };
          const source = { id: `source-${sources.length}`, ...values };
          sources.push(source);
          return { data: { id: source["id"] }, error: null };
        }
        if (table === "playback_sources") {
          const found = sources.find(
            (source) =>
              source["provider"] === filters["provider"] &&
              source["external_id"] === filters["external_id"],
          );
          return { data: found ? { id: found["id"] } : null, error: null };
        }
        if (table === "championship_entries" && isDelete) {
          const index = entries.findIndex((entry) => entry["id"] === filters["id"]);
          if (index >= 0) entries.splice(index, 1);
          return { data: null, error: null };
        }
        if (table === "championship_entries" && insertValues) {
          const values = insertValues as Record<string, unknown>;
          if (options.duplicateContact && (values["contact_phone"] || values["contact_email"])) {
            return {
              data: null,
              error: { code: "23505", message: "championship_entries_email_unique" },
            };
          }
          if (
            values["status"] === "confirmed" &&
            entries.filter((entry) => entry["status"] === "confirmed").length >=
              (championship?.format ?? 0)
          ) {
            return {
              data: null,
              error: { code: "P0001", message: "championship capacity reached" },
            };
          }
          const entry: Record<string, unknown> = {
            id: `entry-${entries.length}`,
            championship_id: championshipId,
            ...values,
          };
          entries.push(entry);
          return { data: { id: entry["id"], status: entry["status"] }, error: null };
        }
        if (table === "championship_entries") {
          const selected = entries.filter(
            (entry) => entry["championship_id"] === filters["championship_id"],
          );
          return { data: selected, error: null };
        }
        if (table === "championship_entry_songs" && insertValues) {
          if (options.songError)
            return { data: null, error: { code: "23503", message: "invalid source reference" } };
          songs.push(...(insertValues as Record<string, unknown>[]));
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };
      const query = {
        select(_columns?: string, optionsArg?: { count?: string }) {
          selectOptions = optionsArg;
          return query;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return query;
        },
        order() {
          return query;
        },
        insert(values: Record<string, unknown> | Record<string, unknown>[]) {
          insertValues = values;
          return query;
        },
        delete() {
          isDelete = true;
          return query;
        },
        async maybeSingle() {
          return resolve();
        },
        async single() {
          return resolve();
        },
        then(
          resolvePromise: (value: unknown) => unknown,
          rejectPromise: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(resolve()).then(resolvePromise, rejectPromise);
        },
      };
      return query;
    },
  };
  return { db: db as never, entries, sources, songs, rpcCalls };
}

const validEntry = (overrides: Record<string, unknown> = {}) => ({
  championshipId,
  name: "Cantora",
  stageName: "Voz",
  contactPhone: "11 99999-1111",
  contactEmail: "cantora@example.com",
  songs: [song("main", 1)],
  ...overrides,
});

const song = (
  type: "main" | "reserve",
  order: number,
  externalId = `YT_${type === "main" ? "m" : "r"}${order}abcdef`,
) => ({
  type,
  order,
  provider: DEFAULT_PROVIDER,
  externalId,
  title: `Track ${externalId}`,
});

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

  it("rejects public details for missing, closed, and expired championships", async () => {
    await expect(
      getPublicChampionshipRegistration(makeRegistrationDb({ missing: true }).db, championshipId),
    ).rejects.toThrow("não encontrado");
    await expect(
      getPublicChampionshipRegistration(
        makeRegistrationDb({ status: "registration_closed" }).db,
        championshipId,
      ),
    ).rejects.toThrow("não estão abertas");
    await expect(
      registerChampionshipEntry(
        makeRegistrationDb({ status: "registration_closed" }).db,
        validEntry(),
      ),
    ).rejects.toThrow("não estão abertas");
    await expect(
      registerChampionshipEntry(
        makeRegistrationDb({ deadline: "2026-01-01T00:00:00.000Z" }).db,
        validEntry(),
      ),
    ).rejects.toThrow("prazo");
  });

  it("returns only limited public registration details", async () => {
    const result = await getPublicChampionshipRegistration(
      makeRegistrationDb({ confirmedCount: 3 }).db,
      championshipId,
    );
    expect(result).toMatchObject({
      championship: { id: championshipId, title: "Copa", format: 8 },
      confirmedEntries: 3,
    });
    expect(result.championship).not.toHaveProperty("venue_id");
    expect(result.championship).not.toHaveProperty("status");
    expect(JSON.stringify(result)).not.toContain("contact");
  });

  it("creates a confirmed entry and stores main and reserve song slots", async () => {
    const registration = makeRegistrationDb();
    const result = await registerChampionshipEntry(
      registration.db,
      validEntry({
        songs: [song("main", 1), song("reserve", 1)],
      }),
    );
    expect(result.status).toBe("confirmed");
    expect(registration.entries.at(-1)).toMatchObject({ name: "Cantora", status: "confirmed" });
    expect(registration.songs).toHaveLength(2);
    expect(registration.sources).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("cantora@example.com");
    expect(registration.sources[0]).toHaveProperty("title", "Track YT_m1abcdef");
    expect(registration.rpcCalls[0]?.args["p_songs"]).toEqual([
      {
        song_type: "main",
        song_order: 1,
        provider: DEFAULT_PROVIDER,
        external_id: "YT_m1abcdef",
        title: "Track YT_m1abcdef",
        channel_name: null,
        thumbnail_url: null,
        duration: null,
      },
      {
        song_type: "reserve",
        song_order: 1,
        provider: DEFAULT_PROVIDER,
        external_id: "YT_r1abcdef",
        title: "Track YT_r1abcdef",
        channel_name: null,
        thumbnail_url: null,
        duration: null,
      },
    ]);
  });

  it("reuses playback source metadata for repeated provider identifiers", async () => {
    const registration = makeRegistrationDb();
    await registerChampionshipEntry(
      registration.db,
      validEntry({ songs: [song("main", 1, "shared_id01")] }),
    );
    await registerChampionshipEntry(
      registration.db,
      validEntry({
        contactPhone: "11 99999-2222",
        contactEmail: "cantora2@example.com",
        songs: [song("main", 1, "shared_id01")],
      }),
    );
    expect(registration.sources).toHaveLength(1);
    expect(registration.songs).toHaveLength(2);
  });

  it("places entries on the waitlist when full or when a concurrent insert fills the last place", async () => {
    const full = makeRegistrationDb({ format: 8, confirmedCount: 8 });
    await expect(registerChampionshipEntry(full.db, validEntry())).resolves.toMatchObject({
      status: "waitlist",
    });

    const race = makeRegistrationDb({ format: 8, confirmedCount: 7 });
    const [first, second] = await Promise.all([
      registerChampionshipEntry(
        race.db,
        validEntry({ contactPhone: "11111111", contactEmail: "one@example.com" }),
      ),
      registerChampionshipEntry(
        race.db,
        validEntry({ contactPhone: "22222222", contactEmail: "two@example.com" }),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual(["confirmed", "waitlist"]);
    expect(race.entries.filter((entry) => entry["status"] === "confirmed")).toHaveLength(8);
  });

  it("maps unique contact collisions to a privacy-safe message", async () => {
    const duplicate = makeRegistrationDb({ duplicateContact: true });
    await expect(registerChampionshipEntry(duplicate.db, validEntry())).rejects.toThrow(
      "Já existe uma inscrição usando este telefone ou e-mail",
    );
  });

  it("requires a name and at least one valid contact identifier", async () => {
    await expect(
      registerChampionshipEntry(
        makeRegistrationDb().db,
        validEntry({ name: " ", contactPhone: null, contactEmail: null }),
      ),
    ).rejects.toThrow();
    await expect(
      registerChampionshipEntry(
        makeRegistrationDb().db,
        validEntry({ contactEmail: "not-an-email", contactPhone: null }),
      ),
    ).rejects.toThrow("e-mail válido");
  });

  it("requires at least one main song", async () => {
    await expect(
      registerChampionshipEntry(makeRegistrationDb().db, validEntry({ songs: [] })),
    ).rejects.toThrow("Escolha ao menos uma música principal");
  });

  it("enforces the four-main, two-reserve limit and unique valid slots", async () => {
    const tooManyMain = [1, 2, 3, 4, 5].map((position) => song("main", position));
    const tooManyReserve = [1, 2, 3].map((position) => song("reserve", position));
    await expect(
      registerChampionshipEntry(makeRegistrationDb().db, validEntry({ songs: tooManyMain })),
    ).rejects.toThrow("no máximo quatro");
    await expect(
      registerChampionshipEntry(makeRegistrationDb().db, validEntry({ songs: tooManyReserve })),
    ).rejects.toThrow("posições 1 ou 2");
    await expect(
      registerChampionshipEntry(
        makeRegistrationDb().db,
        validEntry({
          songs: [song("main", 1), song("main", 1)],
        }),
      ),
    ).rejects.toThrow("única");

    const validSlots = makeRegistrationDb();
    await registerChampionshipEntry(
      validSlots.db,
      validEntry({
        songs: [1, 2, 3, 4]
          .map((position) => song("main", position))
          .concat([song("reserve", 1), song("reserve", 2)]),
      }),
    );
    expect(validSlots.songs).toHaveLength(6);
  });

  it("rejects invalid source data and rolls back an entry if song storage fails", async () => {
    await expect(
      registerChampionshipEntry(
        makeRegistrationDb().db,
        validEntry({
          songs: [{ ...song("main", 1), provider: "", title: "" }],
        }),
      ),
    ).rejects.toThrow();
    const sourceFailure = makeRegistrationDb({ sourceError: true });
    await expect(
      registerChampionshipEntry(sourceFailure.db, validEntry({ songs: [song("main", 1)] })),
    ).rejects.toThrow("Falha na validação da música");
    expect(sourceFailure.entries).toHaveLength(0);

    const failedSongs = makeRegistrationDb({ songError: true });
    await expect(
      registerChampionshipEntry(failedSongs.db, validEntry({ songs: [song("main", 1)] })),
    ).rejects.toThrow("Falha na validação da música");
    expect(failedSongs.entries).toHaveLength(0);
  });

  it("rejects unsupported providers and identifiers without creating a partial entry", async () => {
    const invalidSource = makeRegistrationDb();
    await expect(
      registerChampionshipEntry(
        invalidSource.db,
        validEntry({
          songs: [{ ...song("main", 1), provider: "unlicensed-provider" }],
        }),
      ),
    ).rejects.toThrow("Fonte de música inválida");
    expect(invalidSource.entries).toHaveLength(0);
    expect(invalidSource.sources).toHaveLength(0);

    const invalidIdentifier = makeRegistrationDb();
    await expect(
      registerChampionshipEntry(
        invalidIdentifier.db,
        validEntry({ songs: [song("main", 1, "not-a-valid-id")] }),
      ),
    ).rejects.toThrow("Fonte de música inválida");
    expect(invalidIdentifier.rpcCalls).toHaveLength(0);
  });

  it("lists entries only from the requested championship", async () => {
    const db = makeRegistrationDb({ confirmedCount: 1 });
    await expect(listChampionshipEntries(db.db, championshipId)).resolves.toHaveLength(1);
    await expect(listChampionshipEntries(db.db, venueId)).resolves.toHaveLength(0);
  });

  it("declares atomic locking and service-role-only RPC execution in the migration", () => {
    expect(atomicRegistrationMigration).toContain("FOR UPDATE");
    expect(atomicRegistrationMigration).toContain("pg_catalog.clock_timestamp()");
    expect(atomicRegistrationMigration).toContain("REVOKE ALL ON FUNCTION");
    expect(atomicRegistrationMigration).toContain("FROM PUBLIC, anon, authenticated");
    expect(atomicRegistrationMigration).toContain("TO service_role");
  });
});
