import { describe, expect, it } from "vitest";
import { countablePerformance, rankVenueSongs } from "./venue-top-songs.functions";

const source = {
  provider: "youtube",
  external_id: "video-1",
  title: "Música",
  channel_name: "Canal",
  thumbnail_url: "https://example.com/thumb.jpg",
  duration: "3:00",
  metadata: {},
};

describe("venue top songs ranking", () => {
  it("counts completed or cancelled performances that started and lasted at least 30 seconds", () => {
    expect(
      countablePerformance({
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T00:00:30Z",
        status: "completed",
      }),
    ).toBe(true);
    expect(
      countablePerformance({
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T00:00:45Z",
        status: "cancelled",
      }),
    ).toBe(true);
  });

  it("excludes queued rows, rows without a start, and performances shorter than 30 seconds", () => {
    expect(countablePerformance({ started_at: null, ended_at: null, status: "cancelled" })).toBe(
      false,
    );
    expect(
      countablePerformance({
        started_at: null,
        ended_at: "2026-01-01T00:01:00Z",
        status: "completed",
      }),
    ).toBe(false);
    expect(
      countablePerformance({
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T00:00:29.999Z",
        status: "completed",
      }),
    ).toBe(false);
    expect(
      countablePerformance({
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T00:01:00Z",
        status: "active",
      }),
    ).toBe(false);
  });

  it("returns the existing playback contract with venue scoped counts and most recent end time", () => {
    const rows = [
      {
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T00:01:00Z",
        status: "completed",
        source,
      },
      {
        started_at: "2026-01-02T00:00:00Z",
        ended_at: "2026-01-02T00:01:00Z",
        status: "cancelled",
        source,
      },
      {
        started_at: null,
        ended_at: null,
        status: "queued",
        source: { ...source, external_id: "queued" },
      },
    ];
    const ranked = rankVenueSongs(rows);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      result: { provider: "youtube", externalId: "video-1", title: "Música", channelName: "Canal" },
      playCount: 2,
      lastPlayedAt: "2026-01-02T00:01:00Z",
    });
  });
});
