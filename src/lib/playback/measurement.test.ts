import { describe, expect, it } from "vitest";
import { applyHeartbeat, type HeartbeatInput, type MeasurementAnchor } from "./measurement";

const epochId = "epoch-1";
function hb(
  sequence: number,
  receivedAtMs: number,
  positionSeconds: number,
  state: HeartbeatInput["state"] = "playing",
  epoch = epochId,
): HeartbeatInput {
  return { sequence, receivedAtMs, positionSeconds, state, epochId: epoch };
}
function step(anchor: MeasurementAnchor | null, total: number, input: HeartbeatInput) {
  return applyHeartbeat(anchor, total, input, epochId);
}

describe("performance measurement heartbeat rules", () => {
  it("keeps 29,999 ms unqualified and qualifies at 30,000 exactly once", () => {
    let r = step(null, 0, hb(1, 0, 0));
    r = step(r.anchor, 0, hb(2, 7_000, 7));
    r = step(r.anchor, r.accumulatedMs, hb(3, 14_000, 14));
    r = step(r.anchor, r.accumulatedMs, hb(4, 21_000, 21));
    r = step(r.anchor, r.accumulatedMs, hb(5, 27_999, 26.999));
    expect(r.accumulatedMs).toBe(27_999);
    expect(r.qualified).toBe(false);
    r = step(r.anchor, r.accumulatedMs, hb(6, 30_000, 29));
    expect(r.accumulatedMs).toBe(30_000);
    expect(r.qualified).toBe(true);
  });

  it("counts continuous playback, pauses, resumes and buffering only across confirmed playing pairs", () => {
    let r = step(null, 0, hb(1, 0, 0));
    r = step(r.anchor, r.accumulatedMs, hb(2, 5_000, 5));
    r = step(r.anchor, r.accumulatedMs, hb(3, 10_000, 5, "paused"));
    expect(r.accumulatedMs).toBe(5_000);
    r = step(r.anchor, r.accumulatedMs, hb(4, 40_000, 5, "playing"));
    expect(r.accumulatedMs).toBe(5_000);
    r = step(r.anchor, r.accumulatedMs, hb(5, 45_000, 10));
    expect(r.accumulatedMs).toBe(10_000);
    r = step(r.anchor, r.accumulatedMs, hb(6, 50_000, 10, "buffering"));
    expect(r.accumulatedMs).toBe(10_000);
  });

  it("rejects duplicates, out of order, seeks, stale epochs and unconfirmed gaps", () => {
    const first = step(null, 0, hb(4, 1_000, 1));
    expect(step(first.anchor, 0, hb(4, 2_000, 2)).reason).toBe("duplicate");
    expect(step(first.anchor, 0, hb(3, 2_000, 2)).reason).toBe("out_of_order");
    expect(step(first.anchor, 0, hb(5, 2_000, 20)).reason).toBe("seek");
    expect(step(first.anchor, 0, hb(5, 10_000, 10)).reason).toBe("gap");
    expect(step(first.anchor, 0, hb(5, 2_000, 2, "playing", "old-epoch")).reason).toBe("epoch");
  });

  it("allows a fresh anchor after reconnect and does not count stopped performances", () => {
    const prior = step(null, 0, hb(1, 0, 0));
    const afterReconnect = step(prior.anchor, prior.accumulatedMs, hb(2, 60_000, 60));
    expect(afterReconnect.accumulatedMs).toBe(0);
    const resumed = step(afterReconnect.anchor, 0, hb(3, 65_000, 65));
    expect(resumed.accumulatedMs).toBe(5_000);
  });
});
