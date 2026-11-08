import type { PlayerState } from "./types";

export const QUALIFICATION_MS = 30_000;
export const MAX_HEARTBEAT_GAP_MS = 7_000;
export const MAX_POSITION_DRIFT_SECONDS = 2;

export interface MeasurementAnchor {
  state: PlayerState;
  receivedAtMs: number;
  positionSeconds: number;
  sequence: number;
}

export interface HeartbeatInput extends MeasurementAnchor {
  epochId: string;
}

export interface HeartbeatResult {
  accepted: boolean;
  accumulatedMs: number;
  qualified: boolean;
  anchor: MeasurementAnchor;
  reason?: "duplicate" | "out_of_order" | "invalid_position" | "seek" | "gap" | "epoch";
}

/** Pure transition used by the server persistence layer and deterministic unit tests. */
export function applyHeartbeat(
  previous: MeasurementAnchor | null,
  accumulatedMs: number,
  input: HeartbeatInput,
  activeEpochId: string,
): HeartbeatResult {
  const fallback = previous ?? input;
  if (input.epochId !== activeEpochId)
    return {
      accepted: false,
      accumulatedMs,
      qualified: accumulatedMs >= QUALIFICATION_MS,
      anchor: fallback,
      reason: "epoch",
    };
  if (!Number.isFinite(input.positionSeconds) || input.positionSeconds < 0)
    return {
      accepted: false,
      accumulatedMs,
      qualified: accumulatedMs >= QUALIFICATION_MS,
      anchor: fallback,
      reason: "invalid_position",
    };
  if (previous && input.sequence === previous.sequence)
    return {
      accepted: false,
      accumulatedMs,
      qualified: accumulatedMs >= QUALIFICATION_MS,
      anchor: previous,
      reason: "duplicate",
    };
  if (
    previous &&
    (input.sequence < previous.sequence || input.receivedAtMs <= previous.receivedAtMs)
  )
    return {
      accepted: false,
      accumulatedMs,
      qualified: accumulatedMs >= QUALIFICATION_MS,
      anchor: previous,
      reason: "out_of_order",
    };

  let added = 0;
  let reason: HeartbeatResult["reason"];
  if (previous && previous.state === "playing" && input.state === "playing") {
    const elapsed = input.receivedAtMs - previous.receivedAtMs;
    const mediaElapsed = input.positionSeconds - previous.positionSeconds;
    if (elapsed > MAX_HEARTBEAT_GAP_MS) reason = "gap";
    else if (
      mediaElapsed < 0 ||
      Math.abs(mediaElapsed - elapsed / 1000) > MAX_POSITION_DRIFT_SECONDS
    )
      reason = "seek";
    else added = elapsed;
  }
  const anchor = {
    state: input.state,
    receivedAtMs: input.receivedAtMs,
    positionSeconds: input.positionSeconds,
    sequence: input.sequence,
  };
  const total = accumulatedMs + added;
  return {
    accepted: true,
    accumulatedMs: total,
    qualified: total >= QUALIFICATION_MS,
    anchor,
    ...(reason ? { reason } : {}),
  };
}
