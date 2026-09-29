import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSession, listParticipants, listPerformances } from "@/lib/karaoke";

/** Session data kept fresh through Realtime (no polling). */
export function useSessionLive(sessionId: string | undefined) {
  const qc = useQueryClient();
  const enabled = !!sessionId;
  const session = useQuery({ queryKey: ["session", sessionId], queryFn: () => getSession(sessionId!), enabled, retry: 1 });
  const participants = useQuery({ queryKey: ["participants", sessionId], queryFn: () => listParticipants(sessionId!), enabled, retry: 1 });
  const performances = useQuery({ queryKey: ["performances", sessionId], queryFn: () => listPerformances(sessionId!), enabled, retry: 1 });

  useEffect(() => {
    if (!sessionId) return;
    const f = `session_id=eq.${sessionId}`;
    const ch = supabase
      .channel(`live:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "performances", filter: f }, () => qc.invalidateQueries({ queryKey: ["performances", sessionId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: f }, () => {
        qc.invalidateQueries({ queryKey: ["participants", sessionId] });
        qc.invalidateQueries({ queryKey: ["performances", sessionId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${sessionId}` }, () => qc.invalidateQueries({ queryKey: ["session", sessionId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, qc]);

  const perfs = performances.data ?? [];
  return {
    session,
    participants,
    performances,
    active: perfs.find((p) => p.status === "active") ?? null,
    queued: perfs.filter((p) => p.status === "queued"),
    error: session.error || participants.error || performances.error,
  };
}
