import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Mic2, ThumbsDown, ThumbsUp } from "lucide-react";
import { useSessionLive } from "@/hooks/use-session-live";
import { displayName, getVoterToken } from "@/lib/karaoke";
import { castVote, getVoterStatus } from "@/lib/votes.functions";
import { castX1MatchVote, getX1MatchVoteStatus } from "@/lib/x1.functions";
import { useVoteCountdown } from "@/hooks/use-vote-countdown";
import type { Participant } from "@/lib/karaoke";

export const Route = createFileRoute("/votar/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Votar — BatalhaOkê" },
      { name: "description", content: "Vote pelo celular na apresentação que está acontecendo agora." },
      { property: "og:title", content: "Vote no BatalhaOkê" },
      { property: "og:description", content: "Escaneou o QR? Toque em GOSTEI e apoie quem está cantando." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VotePage,
});

function VotePage() {
  const { code } = Route.useParams();
  const live = useSessionLive({ kind: "public", code });
  const target = live.snapshot;
  const session = target?.session;
  const currentSession = live.session.data ?? session;
  const active = live.active;
  const afterBoth = currentSession?.session_type === "x1" && currentSession.x1_voting_mode === "after_both_performances";
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { setToken(getVoterToken()); }, []);

  const status = useServerFn(getVoterStatus);
  const vote = useServerFn(castVote);
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ["voter-status", code, active?.id],
    queryFn: () => status({ data: { code, token: token!, voteType: "like" } }),
    enabled: !!token && !!active?.id && !afterBoth,
  });
  const hasVoted = !!active && (voted[active.id] || (statusQ.data?.performanceId === active.id && statusQ.data.hasVoted));

  async function onVote(voteType: "like" | "dislike") {
    if (!token || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await vote({ data: { code, token, voteType } });
      if (r.result === "ok" || r.result === "already_voted") setVoted((v) => ({ ...v, [r.performanceId]: true }));
      else if (r.result === "vote_not_allowed") setErr("Esta sessão aceita apenas votos de gostei.");
      else if (r.result === "no_performance") setErr("A apresentação terminou. Aguarde o próximo cantor.");
      else if (r.result === "no_active_session") setErr("Este estabelecimento não possui uma batalha ativa no momento.");
      else setErr("Esta sessão não está mais aceitando votos.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 py-8 text-center">
      <header className="flex items-center justify-center gap-2">
        <Mic2 className="size-6 text-primary" aria-hidden />
        <p className="font-display text-3xl">BatalhaOkê</p>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-6">
        {live.session.isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : live.error ? (
          <p role="alert" className="text-destructive">Sem conexão. Verifique a internet e recarregue.</p>
        ) : target?.kind === "venue" && !session ? (
          <p className="text-lg text-muted-foreground">Este estabelecimento não possui uma batalha ativa no momento.</p>
        ) : !session ? (
          <p className="text-lg text-muted-foreground">QR Code inválido.</p>
        ) : currentSession?.status !== "active" ? (
          <p className="text-lg text-muted-foreground">Esta sessão foi encerrada. Obrigado por participar!</p>
        ) : afterBoth ? (
          <X1DirectVote code={code} token={token} active={!!active?.participant} activeName={active?.participant ? displayName(active.participant) : null} participants={live.participants.data ?? []} />
        ) : !active?.participant ? (
          <div>
            <p className="font-display text-4xl">Aguardando o próximo cantor.</p>
            <p className="mt-4 text-muted-foreground">Assim que uma apresentação começar, você poderá votar aqui.</p>
          </div>
        ) : (
          <>
            <div className="w-full min-w-0">
              <p className="break-words font-display text-6xl leading-none text-primary">🎤 {displayName(active.participant)}</p>
              {active.source && <p className="mt-3 line-clamp-2 text-lg">{active.source.title}</p>}
            </div>
            {hasVoted ? (
              <div className="w-full rounded-2xl border bg-card p-6" role="status">
                <p className="flex items-center justify-center gap-2 font-display text-3xl text-success"><Check className="size-7" /> Voto registrado</p>
                <p className="mt-3">Obrigado por participar!</p>
                <p className="mt-1 text-sm text-muted-foreground">✓ Você já votou nesta apresentação. Aguarde o próximo cantor.</p>
              </div>
            ) : (
              <>
                <p className="text-xl text-muted-foreground">{session.voting_mode === "like_dislike" ? "O que você achou?" : "Você gostou?"}</p>
                <div className={`grid w-full gap-3 ${session.voting_mode === "like_dislike" ? "grid-cols-2" : "grid-cols-1"}`}>
                  <button onClick={() => onVote("like")} disabled={busy || !token || statusQ.isLoading}
                    className="flex h-40 w-full items-center justify-center gap-4 rounded-3xl bg-primary font-display text-5xl font-semibold text-primary-foreground shadow-glow transition active:scale-95 disabled:opacity-80 focus-visible:outline-2 focus-visible:outline-ring">
                    <ThumbsUp className="size-12" aria-hidden /> {busy ? "…" : "Gostei"}
                  </button>
                  {session.voting_mode === "like_dislike" && <button onClick={() => onVote("dislike")} disabled={busy || !token || statusQ.isLoading}
                    className="flex h-40 w-full items-center justify-center gap-3 rounded-3xl bg-secondary font-display text-3xl shadow-glow transition active:scale-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring">
                    <ThumbsDown className="size-10" aria-hidden /> {busy ? "…" : "Não gostei"}
                  </button>}
                </div>
              </>
            )}
            {err && <p role="alert" className="text-destructive">{err}</p>}
          </>
        )}
      </section>
    </main>
  );
}

/** X1 after_both_performances: no A/B voting while singing; direct choice once the window opens. */
function X1DirectVote({ code, token, active, activeName, participants }: {
  code: string; token: string | null; active: boolean; activeName: string | null; participants: Participant[];
}) {
  const statusFn = useServerFn(getX1MatchVoteStatus);
  const voteFn = useServerFn(castX1MatchVote);
  const q = useQuery({
    queryKey: ["x1-vote-status", code],
    queryFn: () => statusFn({ data: { code, token: token! } }),
    enabled: !!token,
    refetchInterval: 2000,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [localVote, setLocalVote] = useState<Record<string, boolean>>({});
  const match = q.data?.match ?? null;
  const offset = q.data ? q.data.serverNow - Date.now() : 0;
  const remaining = useVoteCountdown(match?.voting_status === "open" ? match.voting_ends_at : null, offset);
  const byId = (id: string) => participants.find((p) => p.id === id);
  const voted = !!match && (localVote[match.id] || q.data?.hasVoted);

  async function vote(chosenParticipantId: string) {
    if (!token || !match || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await voteFn({ data: { code, token, matchId: match.id, chosenParticipantId } });
      if (r.result === "ok" || r.result === "already_voted") setLocalVote((v) => ({ ...v, [match.id]: true }));
      else if (r.result === "voting_closed") setErr("Votação encerrada.");
      else setErr("Não foi possível registrar o voto.");
      void q.refetch();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (active) return (
    <div className="w-full min-w-0">
      {activeName && <p className="break-words font-display text-5xl leading-none text-primary">🎤 {activeName}</p>}
      <p className="mt-6 text-xl">Apresentação em andamento.</p>
      <p className="mt-2 text-muted-foreground">A votação abrirá após as apresentações dos dois cantores.</p>
    </div>
  );
  if (!match || match.voting_status === "idle") return (
    <div>
      <p className="font-display text-4xl">Aguardando o próximo duelo.</p>
      <p className="mt-4 text-muted-foreground">A votação abrirá após as apresentações dos dois cantores.</p>
    </div>
  );
  const isOpen = match.voting_status === "open" && remaining > 0;
  if (!isOpen) return <p className="font-display text-4xl">Votação encerrada.</p>;
  if (voted) return (
    <div className="w-full rounded-2xl border bg-card p-6" role="status">
      <p className="flex items-center justify-center gap-2 font-display text-3xl text-success"><Check className="size-7" /> Voto registrado!</p>
      <p className="mt-3">Aguarde o resultado no telão.</p>
    </div>
  );
  const a = byId(match.participant_a_id), b = byId(match.participant_b_id);
  return (
    <div className="flex w-full flex-col gap-4">
      <p className="font-display text-4xl">QUEM VOCÊ PREFERE?</p>
      <p className="font-display text-5xl text-primary" aria-live="polite">{remaining}s</p>
      {[a, b].map((p, i) => p && (
        <button key={p.id} onClick={() => { void vote(p.id); }} disabled={busy || !token}
          className="h-28 w-full rounded-3xl bg-primary px-4 font-display text-4xl text-primary-foreground shadow-glow transition active:scale-95 disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-ring">
          {i === 0 ? "A" : "B"} · {displayName(p)}
        </button>
      ))}
      {err && <p role="alert" className="text-destructive">{err}</p>}
    </div>
  );
}
