import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { acceptVenueOperatorInviteFn } from "@/lib/operator-invites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  authRedirectUrl,
  isPasswordSetupEvent,
  isPasswordSetupLink,
  updatePassword,
} from "@/lib/authRedirect";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Administração · BatalhaOkê" },
      {
        name: "description",
        content:
          "Acesso restrito para operadores autorizados administrarem seus estabelecimentos e Campeonatos.",
      },
      { property: "og:title", content: "Entrar — Administração · BatalhaOkê" },
      { property: "og:description", content: "Acesso restrito para operadores autorizados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup" | "recover" | "set-password">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupSent, setSignupSent] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<string | null>(null);
  const [inviteDone, setInviteDone] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("operator_invite");
    if (token && /^[A-Za-z0-9_-]{40,128}$/.test(token)) setInviteToken(token);
    else if (token) setInviteState("O token do convite é inválido.");
    if (isPasswordSetupLink(window.location.hash)) setMode("set-password");
    // getUser re-validates with the auth server, so an expired/revoked session shows as signed out.
    supabase.auth.getUser().then(({ data, error: err }) => {
      if (err && err.name !== "AuthSessionMissingError")
        setError("Sua sessão expirou. Entre novamente.");
      setUserEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        isPasswordSetupEvent(event) ||
        (event === "SIGNED_IN" && isPasswordSetupLink(window.location.hash))
      )
        setMode("set-password");
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED")
        setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!inviteToken || !userEmail || inviteDone || !ready) return;
    let active = true;
    setInviteState("Confirmando sua identidade e aceitando o convite…");
    void (async () => {
      const { data, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !data.user) {
        setInviteState("Entre ou crie uma conta para aceitar este convite.");
        return;
      }
      if (!data.user.email_confirmed_at) {
        setInviteState("Confirme seu e-mail pelo link enviado para continuar.");
        return;
      }
      try {
        await acceptVenueOperatorInviteFn({ data: { token: inviteToken } });
        if (!active) return;
        setInviteDone(true);
        setInviteState("Convite aceito. Você agora é operador deste estabelecimento.");
        window.history.replaceState(null, "", window.location.pathname);
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Não foi possível aceitar o convite.";
        setInviteState(
          /e-mail|email/i.test(message)
            ? "Este convite foi enviado para outro e-mail."
            : /expir|inválid|invalid|cancel/i.test(message)
              ? "O convite é inválido, expirou ou foi cancelado."
              : "Não foi possível aceitar o convite. Tente novamente.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [inviteToken, userEmail, ready, inviteDone]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "signin") {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(false);
      if (err) setError("E-mail ou senha inválidos.");
      else setPassword("");
      return;
    }
    if (mode === "set-password") {
      const { error: err } = await updatePassword(supabase.auth, password);
      setBusy(false);
      if (err) setError("Não foi possível definir a senha. Solicite um novo link.");
      else {
        setPassword("");
        setMode("signin");
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      return;
    }
    if (mode === "recover") {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authRedirectUrl({
          search: window.location.search,
          development: import.meta.env.DEV,
          localOrigin: window.location.origin,
        }),
      });
      setBusy(false);
      if (err) setError("NÃ£o foi possÃ­vel enviar o link. Verifique o e-mail e tente novamente.");
      else setRecoverySent(true);
      return;
    }
    // Signup: email confirmation is enabled, so data.session is null until the user
    // clicks the confirmation link. Never treat a successful signUp as signed in.
    const { error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: authRedirectUrl({
          search: window.location.search,
          development: import.meta.env.DEV,
          localOrigin: window.location.origin,
        }),
      },
    });
    setBusy(false);
    if (err)
      setError("Não foi possível criar a conta. Verifique o e-mail e tente uma senha mais forte.");
    else setSignupSent(true);
  }

  async function onLogout() {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
  }

  return (
    <main className="pulso-login min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-6 text-card-foreground">
        <div className="space-y-1">
          <p className="font-display text-2xl text-primary">BatalhaOkê</p>
          <h1 className="font-display text-4xl font-semibold">Administração</h1>
          <p className="text-sm text-muted-foreground">
            Acesso restrito aos operadores autorizados de cada estabelecimento.
          </p>
        </div>
        {inviteState && (
          <p role="status" className="text-sm text-muted-foreground">
            {inviteState}
          </p>
        )}
        {!ready ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : userEmail && mode !== "set-password" && mode !== "recover" ? (
          <div className="space-y-4">
            <p className="text-sm">
              Conectado como <strong>{userEmail}</strong>.
            </p>
            <Button onClick={onLogout} disabled={busy} variant="outline" className="w-full">
              {busy ? "Saindo…" : "Sair"}
            </Button>
          </div>
        ) : recoverySent ? (
          <div className="space-y-4">
            <p className="text-sm">
              Se este e-mail estiver cadastrado, enviaremos um link para definir uma nova senha.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setRecoverySent(false);
                setMode("signin");
              }}
            >
              Voltar para entrar
            </Button>
          </div>
        ) : signupSent ? (
          <div className="space-y-4">
            <p className="text-sm">
              Conta criada! Enviamos um link de confirmação para <strong>{email.trim()}</strong>.
              Confirme o e-mail e depois entre com sua senha.
            </p>
            <p className="text-sm text-muted-foreground">
              O acesso administrativo a um estabelecimento é liberado separadamente, por um operador
              autorizado.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setSignupSent(false);
                setMode("signin");
                setPassword("");
              }}
            >
              Voltar para entrar
            </Button>
          </div>
        ) : (
          <form
            aria-describedby={error ? "login-error" : undefined}
            onSubmit={onSubmit}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {mode !== "recover" && (
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  minLength={mode === "signin" ? undefined : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p id="login-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy
                ? mode === "signin"
                  ? "Entrando…"
                  : "Criando conta…"
                : mode === "signin"
                  ? "Entrar"
                  : mode === "recover"
                    ? "Enviar link de recuperação"
                    : mode === "signup"
                      ? "Criar conta"
                      : "Definir senha"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline"
              onClick={() => {
                if (mode !== "set-password") setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
            >
              {mode === "signin"
                ? "Não tem conta? Cadastre-se"
                : mode === "signup"
                  ? "Já tem conta? Entrar"
                  : "Voltar para entrar"}
            </button>
            {mode === "signin" && (
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline"
                onClick={() => {
                  setMode("recover");
                  setError(null);
                }}
              >
                Esqueci minha senha
              </button>
            )}
          </form>
        )}
        <Link to="/" className="block text-center text-sm text-muted-foreground underline">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
