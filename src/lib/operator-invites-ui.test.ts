import { describe, expect, it } from "vitest";
import {
  availableInviteActions,
  canManageVenueOperators,
  operatorInviteStatusLabels,
} from "./operator-invites-ui";

describe("operator invite interface rules", () => {
  it("shows management only for venue owners", () => {
    expect(canManageVenueOperators("owner")).toBe(true);
    expect(canManageVenueOperators("operator")).toBe(false);
    expect(canManageVenueOperators(undefined)).toBe(false);
  });

  it("labels all backend invite states", () => {
    expect(operatorInviteStatusLabels).toEqual({
      pending: "Pendente",
      accepted: "Aceito",
      expired: "Expirado",
      cancelled: "Cancelado",
    });
  });

  it("offers cancel and resend only while pending", () => {
    expect(availableInviteActions("pending")).toEqual(["resend", "cancel"]);
    expect(availableInviteActions("accepted")).toEqual([]);
    expect(availableInviteActions("expired")).toEqual([]);
    expect(availableInviteActions("cancelled")).toEqual([]);
  });
});
