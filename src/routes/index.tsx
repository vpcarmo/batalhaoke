import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Mic2, Tv, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSession, getActiveSession, type VotingMode } from "@/lib/karaoke";
import type { SessionType } from "@/integrations/supabase/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BatalhaOkê — O público decide quem continua" },
      { name: "description", content: "Karaokê interativo para bares, festas e eventos: cantores, apresentações e votação do público." },
      { property: "og:title", content: "BatalhaOkê" },
      { property: "og:description", content: "Karaokê interativo com votação do público em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function defaultName() {
  const d = new Date().toLocaleDateString("pt-BR", { weekday: "long" });
  return `BatalhaOkê · ${d.charAt(0).toUpperCase() + d.slice(1)}`;
}

function Home() {
  const nav = useNavigate();
  const active = useQuery({ queryKey: ["active-session"], queryFn: getActiveSession, retry: 1 });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(defaultName);
  const [sessionType, setSessionType] = useState<SessionType>("free");
  const [votingMode, setVotingMode] = useState<VotingMode>("like_only");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function selectSessionType(type: SessionType) {
    setSessionType(type);
    if (type === "x1" || type === "championship") setVotingMode("like_dislike");
  }

  async function start() {
    setBusy(true); setErr(null);
    try {
      const s = await createSession(name.trim() || defaultName(), { sessionType, votingMode });
      nav({ to: "/sessao/$id", params: { id: s.id } });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow animate-in zoom-in-50 duration-500">
          <Mic2 className="size-8" aria-hidden />
        </div>
        <h1 className="font-display text-6xl leading-none sm:text-7xl">BatalhaOkê</h1>
        <p className="mt-3 text-lg text-muted-foreground">O público decide quem continua.</p>
      </header>

      <section className="flex flex-col gap-3">
        {active.isLoading && <p className="text-center text-sm text-muted-foreground">Verificando sessões…</p>}
        {active.error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Não foi possível conectar ao servidor. Verifique a internet.</p>}
        {active.data && (
          <Button asChild size="lg" className="h-16 text-lg font-semibold shadow-glow">
            <Link to="/sessao/$id" params={{ id: active.data.id }}><Play className="size-5" /> Continuar sessão</Link>
          </Button>
        )}
        {active.data && <p className="-mt-1 text-center text-sm text-muted-foreground">{active.data.name}</p>}

        {!creating ? (
          <Button size="lg" variant={active.data ? "secondary" : "default"} className="h-16 text-lg font-semibold" onClick={() => setCreating(true)}>
            Iniciar nova sessão
          </Button>
        ) : (
          <div className="rounded-2xl border bg-card p-4 animate-in fade-in slide-in-from-bottom-2">
            <Label htmlFor="sname">Nome da sessão</Label>
            <Input id="sname" className="mt-2 h-12 text-base" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">Formato</p>
              <div className="grid gap-2" role="radiogroup" aria-label="Formato da sessão">
                <Button variant={sessionType === "free" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "free"} onClick={() => selectSessionType("free")}>🎤 BatalhaOkê Livre</Button>
                <Button variant={sessionType === "x1" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "x1"} onClick={() => selectSessionType("x1")}>⚔️ BatalhaOkê X1</Button>
                <Button variant={sessionType === "championship" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={sessionType === "championship"} onClick={() => selectSessionType("championship")}>🏆 BatalhaOkê Campeonato</Button>
              </div>
            </div>
            {sessionType === "free" ? (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">Modo de votação</p>
                <div className="grid gap-2" role="radiogroup" aria-label="Modo de votação">
                  <Button variant={votingMode === "like_only" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={votingMode === "like_only"} onClick={() => setVotingMode("like_only")}>👍 Apenas Gostei</Button>
                  <Button variant={votingMode === "like_dislike" ? "default" : "secondary"} className="h-11 justify-start" role="radio" aria-checked={votingMode === "like_dislike"} onClick={() => setVotingMode("like_dislike")}>👍 Gostei / 👎 Não gostei</Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-sm">Votação obrigatória: <strong>👍 Gostei / 👎 Não gostei</strong></p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button variant="secondary" className="h-12" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button className="h-12" disabled={busy} onClick={start}>{busy ? "Criando…" : "Iniciar"}</Button>
            </div>
          </div>
        )}
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      </section>

      <Link to="/karaoke-tv" className="mx-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <Tv className="size-4" /> Abrir tela da TV
      </Link>
    </main>
  );
}
