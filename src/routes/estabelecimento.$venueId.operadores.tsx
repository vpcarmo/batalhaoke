import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Mail, RefreshCw, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelVenueOperatorInviteFn,
  createVenueOperatorInviteFn,
  listVenueOperatorInvitesFn,
  resendVenueOperatorInviteFn,
} from "@/lib/operator-invites.functions";
import { listOperatorVenues } from "@/lib/venue.functions";
import {
  availableInviteActions,
  canManageVenueOperators,
  operatorInviteStatusLabels,
  type OperatorInviteStatus,
} from "@/lib/operator-invites-ui";

export const Route = createFileRoute("/estabelecimento/$venueId/operadores")({
  component: VenueOperators,
});

type Invite = {
  id: string;
  email_normalized: string;
  status: OperatorInviteStatus;
  sent_at: string | null;
  expires_at: string;
};
function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString("pt-BR") : "—";
}

function VenueOperators() {
  const { venueId } = Route.useParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const listFn = useServerFn(listVenueOperatorInvitesFn);
  const createFn = useServerFn(createVenueOperatorInviteFn);
  const cancelFn = useServerFn(cancelVenueOperatorInviteFn);
  const resendFn = useServerFn(resendVenueOperatorInviteFn);
  const venues = useQuery({ queryKey: ["operator-venues"], queryFn: listOperatorVenues });
  const venue = (venues.data ?? []).find((item) => item.id === venueId);
  const invites = useQuery({
    queryKey: ["venue-operator-invites", venueId],
    queryFn: async () => (await listFn({ data: { venueId } })) as Invite[],
    enabled: canManageVenueOperators(venue?.role),
    retry: false,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["venue-operator-invites", venueId] });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await createFn({ data: { venueId, email: email.trim() } });
      setEmail("");
      setMessage({ text: "Convite enviado por e-mail.", error: false });
      await refresh();
    } catch (error) {
      setMessage({
        text: (error as Error).message || "Não foi possível enviar o convite.",
        error: true,
      });
      await refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function act(invite: Invite, action: "cancel" | "resend") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      if (action === "cancel") {
        await cancelFn({ data: { inviteId: invite.id } });
        setMessage({ text: "Convite cancelado.", error: false });
      } else {
        await resendFn({ data: { inviteId: invite.id } });
        setMessage({ text: "Convite reenviado por e-mail.", error: false });
      }
    } catch (error) {
      setMessage({
        text: (error as Error).message || "Não foi possível concluir a ação.",
        error: true,
      });
    } finally {
      await refresh();
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (venues.isLoading)
    return <main className="mx-auto max-w-xl p-6">Carregando estabelecimento…</main>;
  if (!venue || !canManageVenueOperators(venue.role))
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          Esta área está disponível somente para o proprietário do estabelecimento.
        </p>
        <Button asChild variant="link" className="mt-3 px-0">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </main>
    );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-5 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Início
      </Link>
      <header>
        <h1 className="font-display text-3xl">Gerenciar operadores</h1>
        <p className="mt-1 text-muted-foreground">{venue.name}</p>
      </header>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Convidar operador</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enviaremos um link de acesso para o e-mail informado.
        </p>
        <form className="mt-4 space-y-3" onSubmit={(event) => void send(event)}>
          <Label htmlFor="operator-email">E-mail</Label>
          <Input
            id="operator-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="pessoa@exemplo.com"
          />
          <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
            <UserPlus className="size-4" /> {busy ? "Processando…" : "Enviar convite"}
          </Button>
        </form>
        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={`mt-3 text-sm ${message.error ? "text-destructive" : "text-success"}`}
          >
            {message.text}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Convites</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={invites.isFetching}
            onClick={() => void invites.refetch()}
          >
            <RefreshCw className="size-4" /> Atualizar
          </Button>
        </div>
        {invites.isLoading && <p className="text-sm text-muted-foreground">Carregando convites…</p>}
        {invites.error && (
          <p role="alert" className="text-sm text-destructive">
            {invites.error.message || "Não foi possível carregar os convites."}
          </p>
        )}
        {!invites.isLoading && !invites.error && (invites.data ?? []).length === 0 && (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">
            Nenhum convite enviado ainda.
          </p>
        )}
        <div className="space-y-3">
          {(invites.data ?? []).map((invite) => (
            <article key={invite.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium">
                  <Mail className="size-4 text-muted-foreground" />
                  {invite.email_normalized}
                </div>
                <Badge variant={invite.status === "pending" ? "default" : "secondary"}>
                  {operatorInviteStatusLabels[invite.status]}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Enviado: {date(invite.sent_at)} · Expira: {date(invite.expires_at)}
              </p>
              {availableInviteActions(invite.status).length > 0 && (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(invite, "resend")}
                  >
                    <RefreshCw className="size-4" /> Reenviar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(invite, "cancel")}
                  >
                    <X className="size-4" /> Cancelar
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
