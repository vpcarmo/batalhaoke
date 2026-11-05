export type OperatorInviteStatus = "pending" | "accepted" | "expired" | "cancelled";

export const operatorInviteStatusLabels: Record<OperatorInviteStatus, string> = {
  pending: "Pendente",
  accepted: "Aceito",
  expired: "Expirado",
  cancelled: "Cancelado",
};

export function canManageVenueOperators(role: string | undefined) {
  return role === "owner";
}

export function availableInviteActions(status: OperatorInviteStatus) {
  return status === "pending" ? (["resend", "cancel"] as const) : ([] as const);
}
