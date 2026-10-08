import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSession, listMatches, listParticipants, listPerformances } from "@/lib/karaoke";

/** Session data kept fresh through Realtime (no polling). */
export function useSessionLive(sessionId: string | undefined) {
  const qc = useQueryClient();
  const enabled = !!sessionId;
  const session = useQuery({ queryKey: ["session", sessionId], queryFn: () => getSession(sessionId!), enabled, retry: 1 });
  const participants = useQuery({ queryKey: ["participants", sessionId], queryFn: () => listParticipants(sessionId!), enabled, retry: 1 });
  // Safety polling: refetch performances every 3s so a lost/delayed Realtime
  // event (or zombie channel) never leaves the TV stuck on the waiting screen.
  const performances = useQuery({ queryKey: ["performances", sessionId], queryFn: () => listPerformances(sessionId!), enabled, retry: 1, refetchInterval: 3000 });
  const isX1 = session.data?.session_type === "x1";
  const matches = useQuery({
    queryKey: ["matches", sessionId],
    queryFn: () => listMatches(sessionId!),
    enabled: enabled && isX1,
    retry: 1,
    // Fallback when a Realtime matches event is missed (voting window changes).
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!sessionId) return;
    const f = `session_id=eq.${sessionId}`;
    let ch = supabase
      .channel(`live:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "performances", filter: f }, () => qc.invalidateQueries({ queryKey: ["performances", sessionId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: f }, () => {
        qc.invalidateQueries({ queryKey: ["participants", sessionId] });
        qc.invalidateQueries({ queryKey: ["performances", sessionId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, () => qc.invalidateQueries({ queryKey: ["session", sessionId] }));
    // Always subscribe to matches too: the channel must be created once per
    // sessionId and never recreated when session_type resolves to "x1"
    // (recreating the same topic can leave the channel in a zombie state).
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: f }, () => {
      qc.invalidateQueries({ queryKey: ["matches", sessionId] });
    });
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, qc]);

  const perfs = performances.data ?? [];
  return {
    session,
    participants,
    performances,
    matches: isX1 ? matches : undefined,
    active: perfs.find((p) => p.status === "active") ?? null,
    queued: perfs.filter((p) => p.status === "queued"),
    error: session.error || participants.error || performances.error || (isX1 ? matches.error : null),
  };
}
