import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Administração do Campeonato · BatalhaOkê" },
      { name: "description", content: "Acesso restrito para operadores autorizados administrarem Campeonatos BatalhaOkê." },
      { property: "og:title", content: "Entrar — Administração do Campeonato · BatalhaOkê" },
      { property: "og:description", content: "Acesso restrito para operadores autorizados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSent, setSignupSent] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // getUser re-validates with the auth server, so an expired/revoked session shows as signed out.
    supabase.auth.getUser().then(({ data, error: err }) => {
      if (err && err.name !== "AuthSessionMissingError") setError("Sua sessão expirou. Entre novamente.");
      setUserEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "signin") {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (err) setError("E-mail ou senha inválidos.");
      else setPassword("");
      return;
    }
    // Signup: email confirmation is enabled, so data.session is null until the user
    // clicks the confirmation link. Never treat a successful signUp as signed in.
    const { error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) setError("Não foi possível criar a conta. Verifique o e-mail e tente uma senha mais forte.");
    else setSignupSent(true);
  }

  async function onLogout() {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-6 text-card-foreground">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Administração do Campeonato</h1>
          <p className="text-sm text-muted-foreground">Acesso restrito a operadores autorizados.</p>
        </div>
        {!ready ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : userEmail ? (
          <div className="space-y-4">
            <p className="text-sm">Conectado como <strong>{userEmail}</strong>.</p>
            <Button onClick={onLogout} disabled={busy} variant="outline" className="w-full">
              {busy ? "Saindo…" : "Sair"}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? "Entrando…" : "Entrar"}</Button>
          </form>
        )}
        <Link to="/" className="block text-center text-sm text-muted-foreground underline">Voltar ao início</Link>
      </div>
    </main>
  );
}
