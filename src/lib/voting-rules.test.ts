import { describe, expect, it } from "vitest";
import { publicVoteRejection, x1MatchVoteRejection } from "./voting-rules";

const free = {
  status: "active",
  session_type: "free" as const,
  x1_voting_mode: "during_performance" as const,
  voting_mode: "like_only" as const,
};

describe("publicVoteRejection", () => {
  it("keeps like-only, like/dislike, and X1 during-performance voting distinct", () => {
    expect(publicVoteRejection(free, "like")).toBeNull();
    expect(publicVoteRejection(free, "dislike")).toBe("vote_not_allowed");
    expect(publicVoteRejection({ ...free, voting_mode: "like_dislike" }, "dislike")).toBeNull();
    expect(
      publicVoteRejection({ ...free, session_type: "x1", voting_mode: "like_dislike" }, "like"),
    ).toBeNull();
    expect(
      publicVoteRejection(
        {
          ...free,
          session_type: "x1",
          x1_voting_mode: "after_both_performances",
          voting_mode: "like_dislike",
        },
        "like",
      ),
    ).toBe("voting_disabled");
  });

  it("rejects votes outside an active session", () => {
    expect(publicVoteRejection({ ...free, status: "finished" }, "like")).toBe("session_closed");
  });
});

describe("x1MatchVoteRejection", () => {
  const match = {
    status: "in_progress",
    voting_status: "open",
    voting_ends_at: "2026-10-13T15:25:00.000Z",
    participant_a_id: "participant-a",
    participant_b_id: "participant-b",
  };

  it("accepts only a current vote for one of the two participants", () => {
    expect(
      x1MatchVoteRejection(match, "participant-a", Date.parse("2026-10-13T15:24:00.000Z")),
    ).toBeNull();
    expect(x1MatchVoteRejection(match, "outsider", Date.parse("2026-10-13T15:24:00.000Z"))).toBe(
      "invalid_choice",
    );
  });

  it("rejects closed and expired windows", () => {
    expect(x1MatchVoteRejection({ ...match, voting_status: "closed" }, "participant-a", 0)).toBe(
      "voting_closed",
    );
    expect(
      x1MatchVoteRejection(match, "participant-a", Date.parse("2026-10-13T15:25:00.000Z")),
    ).toBe("voting_closed");
  });
});
