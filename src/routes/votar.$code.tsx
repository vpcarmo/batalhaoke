import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Mic2, ThumbsUp } from "lucide-react";
import { useSessionLive } from "@/hooks/use-session-live";
import { displayName, getSessionByCode, getVoterToken } from "@/lib/karaoke";
import { castVote, getVoterStatus } from "@/lib/votes.functions";

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
  const sessionQ = useQuery({ queryKey: ["session-by-code", code], queryFn: () => getSessionByCode(code), retry: 2 });
  const live = useSessionLive(sessionQ.data?.id);
  const session = live.session.data ?? sessionQ.data;
  const active = live.active;
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => { setToken(getVoterToken()); }, []);

  const status = useServerFn(getVoterStatus);
  const vote = useServerFn(castVote);
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ["voter-status", code, active?.id],
    queryFn: () => status({ data: { code, token: token! } }),
    enabled: !!token && !!active?.id,
  });
  const hasVoted = !!active && (voted[active.id] || (statusQ.data?.performanceId === active.id && statusQ.data.hasVoted));

  async function onVote() {
    if (!token || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await vote({ data: { code, token } });
      if (r.result === "ok" || r.result === "already_voted") setVoted((v) => ({ ...v, [r.performanceId]: true }));
      else if (r.result === "no_performance") setErr("A apresentação terminou. Aguarde o próximo cantor.");
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
        {sessionQ.isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : sessionQ.error ? (
          <p role="alert" className="text-destructive">Sem conexão. Verifique a internet e recarregue.</p>
        ) : !session ? (
          <p className="text-lg text-muted-foreground">QR Code inválido.</p>
        ) : session.status !== "active" ? (
          <p className="text-lg text-muted-foreground">Esta sessão foi encerrada. Obrigado por participar!</p>
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
                <p className="text-xl text-muted-foreground">Você gostou?</p>
                <button onClick={onVote} disabled={busy || !token || statusQ.isLoading}
                  className="flex h-40 w-full items-center justify-center gap-4 rounded-3xl bg-primary font-display text-5xl text-primary-foreground shadow-glow transition active:scale-95 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring">
                  <ThumbsUp className="size-12" aria-hidden /> {busy ? "…" : "Gostei"}
                </button>
              </>
            )}
            {err && <p role="alert" className="text-destructive">{err}</p>}
          </>
        )}
      </section>
    </main>
  );
}
