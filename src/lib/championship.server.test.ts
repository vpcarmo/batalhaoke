import { describe, expect, it } from "vitest";
import { assertCoherentDates, canActivateStage, canEditChampionship, CreateChampionshipInput, formatChangeBlockReason, UpdateChampionshipInput } from "./championship.server";

const venueId = "11111111-1111-4111-8111-111111111111";

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
  it("allows editing only in draft and registration_open", () => {
    expect(canEditChampionship("draft")).toBe(true);
    expect(canEditChampionship("registration_open")).toBe(true);
    expect(canEditChampionship("registration_closed")).toBe(false);
    expect(canEditChampionship("cancelled")).toBe(false);
  });
  it("allows starting the stage only after the draw", () => {
    expect(canActivateStage("draft")).toBe(false);
    expect(canActivateStage("registration_closed")).toBe(false);
    expect(canActivateStage("drawn")).toBe(true);
    expect(canActivateStage("completed")).toBe(false);
  });
});
