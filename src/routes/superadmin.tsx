import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { Building2, Loader2, Plus, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createVenueWithOwnerFn,
  findConfirmedUserFn,
  getSuperadminStatusFn,
  linkVenueOperatorFn,
  listSuperadminVenuesFn,
  listVenueOperatorsFn,
} from "@/lib/superadmin.functions";

export const Route = createFileRoute("/superadmin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "SuperAdmin — BatalhaOkê" },
      { name: "description", content: "Administração da plataforma BatalhaOkê." },
      { property: "og:title", content: "SuperAdmin — BatalhaOkê" },
      { property: "og:description", content: "Administração da plataforma BatalhaOkê." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SuperadminPage,
});

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Operação não concluída.");

function SuperadminPage() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const statusFn = useServerFn(getSuperadminStatusFn);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.replace("/login?redirect=/superadmin");
        return;
      }
      setAuthed(true);
    });
  }, [navigate]);
  const status = useQuery({
    queryKey: ["superadmin-status"],
    queryFn: () => statusFn(),
    enabled: authed === true,
    retry: false,
  });
  if (authed !== true || status.isLoading)
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  if (!status.data?.isSuperadmin)
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-bold">Acesso negado</h1>
          <p className="mt-2 text-muted-foreground">
            Esta área é restrita à administração da plataforma.
          </p>
        </div>
      </main>
    );
  return <Dashboard />;
}

function Dashboard() {
  const listFn = useServerFn(listSuperadminVenuesFn);
  const venues = useQuery({ queryKey: ["sa-venues"], queryFn: () => listFn() });
  const [createOpen, setCreateOpen] = useState(false);
  const [manage, setManage] = useState<{ id: string; name: string } | null>(null);
  const list = venues.data ?? [];
  const totalLinks = list.reduce((s, v) => s + v.operatorCount, 0);
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck className="h-6 w-6 text-primary" /> SuperAdmin
        </h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Cadastrar estabelecimento
        </Button>
      </header>
      <section className="grid grid-cols-2 gap-3">
        <Stat
          icon={<Building2 className="h-5 w-5" />}
          label="Estabelecimentos"
          value={list.length}
        />
        <Stat
          icon={<Users className="h-5 w-5" />}
          label="Vínculos de operadores"
          value={totalLinks}
        />
      </section>
      {venues.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {venues.error && <p className="text-destructive">{errMsg(venues.error)}</p>}
      <ul className="space-y-2">
        {list.map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-4"
          >
            <div className="min-w-0">
              <p className="font-semibold">{v.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {v.slug ?? "sem slug"} · {new Date(v.created_at).toLocaleDateString("pt-BR")} ·{" "}
                {v.operatorCount} operador(es)
                {v.operatorCount === 0 && (
                  <span className="ml-1 font-medium text-destructive">· sem proprietário</span>
                )}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManage({ id: v.id, name: v.name })}
            >
              Gerenciar operadores
            </Button>
          </li>
        ))}
      </ul>
      <CreateVenueDialog open={createOpen} onOpenChange={setCreateOpen} onManage={setManage} />
      {manage && <OperatorsDialog venue={manage} onClose={() => setManage(null)} />}
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

function useUserCheck() {
  const findFn = useServerFn(findConfirmedUserFn);
  const [check, setCheck] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({
    busy: false,
    msg: null,
    ok: false,
  });
  async function run(email: string) {
    setCheck({ busy: true, msg: null, ok: false });
    try {
      const { user } = await findFn({ data: { email } });
      if (!user)
        setCheck({
          busy: false,
          ok: false,
          msg: "Conta não encontrada. A pessoa deve se cadastrar em /login.",
        });
      else if (!user.emailConfirmed)
        setCheck({
          busy: false,
          ok: false,
          msg: "Conta encontrada, mas o e-mail não foi confirmado.",
        });
      else setCheck({ busy: false, ok: true, msg: `Conta confirmada: ${user.email}` });
    } catch (e) {
      setCheck({ busy: false, ok: false, msg: errMsg(e) });
    }
  }
  return { check, run, reset: () => setCheck({ busy: false, msg: null, ok: false }) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CreateVenueDialog({
  open,
  onOpenChange,
  onManage,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onManage: (v: { id: string; name: string }) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createVenueWithOwnerFn);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    kind: "ok" | "error";
    text: string;
    venueId?: string;
  } | null>(null);
  const { check, run, reset } = useUserCheck();
  const valid = name.trim().length >= 2 && EMAIL_RE.test(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await createFn({ data: { name, ownerEmail: email } });
      setResult({ kind: "ok", text: "Estabelecimento e proprietário vinculados com sucesso.", venueId: r.venueId });
    } catch (err) {
      setResult({ kind: "error", text: `Operação não concluída: ${errMsg(err)}` });
    } finally {
      await qc.invalidateQueries({ queryKey: ["sa-venues"] });
      setBusy(false);
    }
  }
  function close(o: boolean) {
    if (busy) return;
    if (!o) {
      setName("");
      setEmail("");
      setResult(null);
      reset();
    }
    onOpenChange(o);
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar estabelecimento</DialogTitle>
        </DialogHeader>
        {result && result.kind !== "error" ? (
          <div className="space-y-3">
            <p className={result.kind === "ok" ? "text-success" : "text-destructive"}>
              {result.text}
            </p>
            <Button variant="outline" onClick={() => close(false)}>
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="sa-name">Nome do estabelecimento</Label>
              <Input
                id="sa-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sa-email">E-mail do proprietário</Label>
              <div className="flex gap-2">
                <Input
                  id="sa-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    reset();
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!EMAIL_RE.test(email.trim()) || check.busy}
                  onClick={() => run(email)}
                >
                  {check.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar"}
                </Button>
              </div>
              {check.msg && (
                <p className={`text-sm ${check.ok ? "text-success" : "text-destructive"}`}>
                  {check.msg}
                </p>
              )}
            </div>
            {result?.kind === "error" && <p className="text-sm text-destructive">{result.text}</p>}
            <Button type="submit" disabled={!valid || busy || !check.ok} className="w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OperatorsDialog({
  venue,
  onClose,
}: {
  venue: { id: string; name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listVenueOperatorsFn);
  const linkFn = useServerFn(linkVenueOperatorFn);
  const ops = useQuery({
    queryKey: ["sa-ops", venue.id],
    queryFn: () => listFn({ data: { venueId: venue.id } }),
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "operator">("operator");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { check, run, reset } = useUserCheck();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !EMAIL_RE.test(email.trim())) return;
    setBusy(true);
    setMsg(null);
    try {
      await linkFn({ data: { venueId: venue.id, email, role } });
      setMsg({ ok: true, text: "Vínculo criado." });
      setEmail("");
      reset();
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err) });
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sa-ops", venue.id] }),
        qc.invalidateQueries({ queryKey: ["sa-venues"] }),
      ]);
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Operadores — {venue.name}</DialogTitle>
        </DialogHeader>
        {ops.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {ops.error && <p className="text-sm text-destructive">{errMsg(ops.error)}</p>}
        <ul className="space-y-1 text-sm">
          {ops.data?.length === 0 && (
            <li className="text-muted-foreground">Nenhum operador vinculado.</li>
          )}
          {ops.data?.map((o) => (
            <li key={o.user_id} className="flex justify-between gap-2 rounded border p-2">
              <span className="truncate">{o.email ?? o.user_id}</span>
              <span className="font-medium">
                {o.role === "owner" ? "Proprietário" : "Operador"}
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={submit} className="space-y-3 border-t pt-3">
          <Label htmlFor="op-email">Adicionar por e-mail</Label>
          <div className="flex gap-2">
            <Input
              id="op-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                reset();
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!EMAIL_RE.test(email.trim()) || check.busy}
              onClick={() => run(email)}
            >
              {check.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar"}
            </Button>
          </div>
          {check.msg && (
            <p className={`text-sm ${check.ok ? "text-success" : "text-destructive"}`}>
              {check.msg}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={role === "operator" ? "default" : "outline"}
              onClick={() => setRole("operator")}
            >
              Operador
            </Button>
            <Button
              type="button"
              size="sm"
              variant={role === "owner" ? "default" : "outline"}
              onClick={() => setRole("owner")}
            >
              Proprietário
            </Button>
          </div>
          {msg && (
            <p className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>
          )}
          <Button type="submit" className="w-full" disabled={busy || !EMAIL_RE.test(email.trim())}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Vincular
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
