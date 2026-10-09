import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Code = z.string().trim().min(4).max(40).regex(/^[a-zA-Z0-9_-]+$/);

const Input = z.object({
  code: Code,
  token: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  voteType: z.enum(["like", "dislike"]).default("like"),
});

async function hashToken(sessionId: string, token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sessionId}:${token}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveVotingSession(code: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: venue, error: venueError } = await supabaseAdmin.from("venues").select("id").eq("slug", code).maybeSingle();
  if (venueError) throw new Error("Não foi possível localizar o estabelecimento.");

  if (venue) {
    const { data: session, error } = await supabaseAdmin.from("sessions").select("*")
      .eq("venue_id", venue.id).eq("status", "active").maybeSingle();
    if (error) throw new Error("Não foi possível carregar a sessão ativa.");
    return { kind: "venue" as const, venueId: venue.id, session };
  }

  const { data: session, error } = await supabaseAdmin.from("sessions").select("*").eq("public_code", code).maybeSingle();
  if (error) throw new Error("Não foi possível carregar a sessão.");
  return { kind: "legacy" as const, venueId: null, session };
}

export const getVotingSession = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ code: Code }).parse(data))
  .handler(async ({ data }) => resolveVotingSession(data.code));

/** Has this anonymous voter already voted on the session's currently active performance? */
export const getVoterStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { session: s } = await resolveVotingSession(data.code);
    if (!s || s.status !== "active") return { performanceId: null as string | null, hasVoted: false };
    const { data: perf } = await supabaseAdmin.from("performances").select("id").eq("session_id", s.id).eq("status", "active").limit(1).maybeSingle();
    if (!perf) return { performanceId: null, hasVoted: false };
    const hash = await hashToken(s.id, data.token);
    const { data: voter } = await supabaseAdmin.from("voter_sessions").select("id").eq("session_id", s.id).eq("voter_token_hash", hash).maybeSingle();
    if (!voter) return { performanceId: perf.id, hasVoted: false };
    const { count } = await supabaseAdmin.from("votes").select("id", { count: "exact", head: true }).eq("performance_id", perf.id).eq("voter_session_id", voter.id);
    return { performanceId: perf.id, hasVoted: (count ?? 0) > 0 };
  });

/**
 * Registers a vote. The client never chooses the performance: the server
 * resolves the session's currently active performance from the public code.
 */
export const castVote = createServerFn({ method: "POST" })
  .inputValidator((d) => Input.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { kind, session: s } = await resolveVotingSession(data.code);
    if (!s) return kind === "venue" ? { result: "no_active_session" as const } : { result: "invalid_session" as const };
    if (s.status !== "active") return { result: "session_closed" as const };
    // X1 direct A/B model: per-performance like/dislike is not part of this session.
    if (s.session_type === "x1" && s.x1_voting_mode === "after_both_performances") return { result: "voting_disabled" as const };
    if (data.voteType === "dislike" && s.voting_mode !== "like_dislike") return { result: "vote_not_allowed" as const };
    const { data: perf } = await supabaseAdmin.from("performances").select("id").eq("session_id", s.id).eq("status", "active").limit(1).maybeSingle();
    if (!perf) return { result: "no_performance" as const };

    const hash = await hashToken(s.id, data.token);
    const now = new Date().toISOString();
    const { data: voter, error: vErr } = await supabaseAdmin
      .from("voter_sessions")
      .upsert({ session_id: s.id, voter_token_hash: hash, last_seen_at: now }, { onConflict: "session_id,voter_token_hash" })
      .select("id")
      .single();
    if (vErr || !voter) throw new Error("Não foi possível registrar o voto. Tente novamente.");

    const { error } = await supabaseAdmin.from("votes").insert({ performance_id: perf.id, voter_session_id: voter.id, vote_type: data.voteType });
    if (error) {
      if (error.code === "23505") return { result: "already_voted" as const, performanceId: perf.id };
      throw new Error("Não foi possível registrar o voto. Tente novamente.");
    }
    return { result: "ok" as const, performanceId: perf.id };
  });
