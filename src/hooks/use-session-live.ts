import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getDevelopmentKaraokeSnapshot,
  getOperatorKaraokeSnapshot,
  getPublicKaraokeSnapshot,
  getTvKaraokeSnapshot,
  type KaraokeLiveSnapshot,
} from "@/lib/karaoke.functions";
import type { Match, Participant, Performance, Session } from "@/lib/karaoke";

export type SessionLiveAccess =
  | { kind: "public"; code: string }
  | { kind: "operator"; sessionId: string }
  | { kind: "tv"; deviceToken: string }
  | { kind: "development"; sessionId: string };

export function sessionLiveQueryKey(access: SessionLiveAccess) {
  const scopeKey =
    access.kind === "public"
      ? access.code
      : access.kind === "tv"
        ? access.deviceToken
        : access.sessionId;
  return ["session-live", access.kind, scopeKey] as const;
}

/** Loads one server-scoped session snapshot and refreshes it on safe Realtime invalidations. */
export function useSessionLive(access: SessionLiveAccess | undefined) {
  const qc = useQueryClient();
  const publicSnapshot = useServerFn(getPublicKaraokeSnapshot);
  const operatorSnapshot = useServerFn(getOperatorKaraokeSnapshot);
  const tvSnapshot = useServerFn(getTvKaraokeSnapshot);
  const developmentSnapshot = useServerFn(getDevelopmentKaraokeSnapshot);
  const accessKind = access?.kind;
  const scopeKey =
    access?.kind === "public"
      ? access.code
      : access?.kind === "tv"
        ? access.deviceToken
        : access?.sessionId;
  const queryKey = useMemo(
    () =>
      accessKind
        ? (["session-live", accessKind, scopeKey] as const)
        : (["session-live", "disabled"] as const),
    [accessKind, scopeKey],
  );
  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<KaraokeLiveSnapshot> => {
      if (!access) throw new Error("Escopo da sessão não informado.");
      switch (access.kind) {
        case "public":
          return await publicSnapshot({ data: { code: access.code } });
        case "operator":
          return (await operatorSnapshot({
            data: { sessionId: access.sessionId },
          })) as KaraokeLiveSnapshot;
        case "tv":
          return await tvSnapshot({ data: { deviceToken: access.deviceToken } });
        case "development":
          return await developmentSnapshot({ data: { sessionId: access.sessionId } });
      }
    },
    enabled: !!access,
    retry: 1,
    refetchInterval: access ? 3000 : false,
  });

  const liveSessionId = snapshotQuery.data?.session?.id;
  const venueId = snapshotQuery.data?.venueId;
  useEffect(() => {
    if (!accessKind) return;
    const topics = new Set<string>();
    if (liveSessionId) topics.add(`session-live:${liveSessionId}`);
    if (venueId && (accessKind === "public" || accessKind === "tv"))
      topics.add(`venue-live:${venueId}`);

    const channels = [...topics].map((topic) =>
      supabase
        .channel(topic)
        .on("broadcast", { event: "invalidate" }, () => {
          void qc.invalidateQueries({ queryKey });
        })
        .subscribe(),
    );
    return () => {
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [accessKind, queryKey, qc, liveSessionId, venueId]);

  const session = snapshotQuery.data?.session as Session | null | undefined;
  const participants = (snapshotQuery.data?.participants ?? []) as Participant[];
  const performances = (snapshotQuery.data?.performances ?? []) as Performance[];
  const matches = (snapshotQuery.data?.matches ?? []) as Match[];
  const isX1 = session?.session_type === "x1";

  return {
    snapshot: snapshotQuery.data,
    queryKey,
    session: { ...snapshotQuery, data: session ?? null },
    participants: { ...snapshotQuery, data: participants },
    performances: { ...snapshotQuery, data: performances },
    matches: isX1 ? { ...snapshotQuery, data: matches } : undefined,
    active: performances.find((performance) => performance.status === "active") ?? null,
    queued: performances.filter((performance) => performance.status === "queued"),
    error: snapshotQuery.error,
  };
}
