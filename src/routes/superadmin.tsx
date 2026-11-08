/* eslint-disable @typescript-eslint/no-explicit-any -- commercial tables are newer than generated Supabase types. */
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
  listSuperadminUsersFn,
  getSuperadminUserFn,
  createSuperadminUserFn,
  updateSuperadminUserFn,
  banSuperadminUserFn,
  recoverSuperadminUserFn,
  deleteSuperadminUserFn,
} from "@/lib/superadmin.functions";
import {
  getCommercialAdminDataFn,
  updateCommercialSettingsFn,
  reconcileCommercialFn,
  saveCommercialPlanFn,
  saveCreditPackFn,
  grantCommercialTrialFn,
  grantCommercialCreditsFn,
  setAccountBillingFn,
  manageCommercialTrialFn,
  reprocessCommercialEventFn,
  getCommercialAccountDetailFn,
  settleCommercialDebtFn,
} from "@/lib/commercial.functions";

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
      <UsersPanel />
      <CommercialAdminPanel />
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

function CommercialAdminPanel() {
  const qc = useQueryClient();
  const load = useServerFn(getCommercialAdminDataFn);
  const save = useServerFn(updateCommercialSettingsFn);
  const reconcile = useServerFn(reconcileCommercialFn);
  const savePlan = useServerFn(saveCommercialPlanFn);
  const savePack = useServerFn(saveCreditPackFn);
  const grantTrial = useServerFn(grantCommercialTrialFn);
  const grantCredits = useServerFn(grantCommercialCreditsFn);
  const setBilling = useServerFn(setAccountBillingFn);
  const manageTrial = useServerFn(manageCommercialTrialFn);
  const reprocessEvent = useServerFn(reprocessCommercialEventFn);
  const loadAccountDetail = useServerFn(getCommercialAccountDetailFn);
  const settleDebt = useServerFn(settleCommercialDebtFn);
  const data = useQuery({ queryKey: ["sa-commercial"], queryFn: () => load(), retry: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState("all");
  const [trialFilter, setTrialFilter] = useState("all");
  const [billingFilter, setBillingFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [selectedAccount, setSelectedAccount] = useState("");
  const accountDetail = useQuery({
    queryKey: ["sa-commercial-account", selectedAccount],
    queryFn: () => loadAccountDetail({ data: { accountId: selectedAccount } }),
    enabled: Boolean(selectedAccount),
    retry: false,
  });
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const result = await work();
      setMessage(
        result && typeof result === "object" && "processed" in result
          ? `Reconciliação concluída: ${String((result as { processed: number }).processed)} pedidos processados.`
          : "Operação concluída.",
      );
      await qc.invalidateQueries({ queryKey: ["sa-commercial"] });
    } catch (e) {
      setMessage(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Gestão comercial</h2>
          <p className="text-sm text-muted-foreground">
            Cobrança global desativada por padrão; operações dependem de configuração e credenciais.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => reconcile({ data: {} }))}
        >
          Reconciliar Mercado Pago
        </Button>
      </header>
      {data.error && <p className="text-sm text-destructive">{errMsg(data.error)}</p>}
      {message && <p className="text-sm">{message}</p>}
      {data.isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {data.data && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded border p-3">
            <strong>Configuração</strong>
            <span>Trials: {data.data.settings?.trial_duration_days ?? "não configurado"} dias</span>
            <span>Tolerância: {data.data.settings?.delinquency_grace_days} dias</span>
            <span>Cobrança: {data.data.settings?.billing_enabled ? "ativa" : "desativada"}</span>
            <label className="flex items-center gap-2 text-sm">
              Estabelecimentos no Trial
              <Input
                type="number"
                min="1"
                className="w-24"
                defaultValue={data.data.settings?.trial_venue_limit ?? 1}
                onBlur={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isInteger(n) && n >= 1 && n !== data.data.settings?.trial_venue_limit)
                    void run(() => save({ data: { trial_venue_limit: n } }));
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Duração padrão do trial (dias)
              <Input
                className="w-24"
                type="number"
                min="1"
                defaultValue={data.data.settings?.trial_duration_days ?? ""}
                onBlur={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (n > 0 && n !== data.data.settings?.trial_duration_days)
                    void run(() => save({ data: { trial_duration_days: n } }));
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Tolerância (dias)
              <Input
                className="w-20"
                type="number"
                min="0"
                defaultValue={data.data.settings?.delinquency_grace_days ?? 0}
                onBlur={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (n >= 0 && n !== data.data.settings?.delinquency_grace_days)
                    void run(() => save({ data: { delinquency_grace_days: n } }));
                }}
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Planos ({data.data.plans.length})</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const name = window.prompt("Nome do plano");
                    if (!name) return;
                    const code = window.prompt(
                      "Código único",
                      name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                    );
                    if (!code) return;
                    const type = window.prompt("Tipo: individual ou business", "individual");
                    if (type !== "individual" && type !== "business") return;
                    void run(() =>
                      savePlan({
                        data: {
                          code,
                          account_type: type,
                          name,
                          description: "",
                          monthly_price_cents: Number(
                            window.prompt("Mensalidade em centavos", "0") ?? 0,
                          ),
                          included_executions: Number(window.prompt("Franquia mensal", "0") ?? 0),
                          venue_limit: Number(
                            window.prompt("Limite de estabelecimentos", "0") ?? 0,
                          ),
                          status: "draft",
                          display_order: data.data.plans.length,
                        },
                      }),
                    );
                  }}
                >
                  Novo plano
                </Button>
              </div>
              <ul className="mt-2 space-y-2">
                {data.data.plans.map((p: any) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                    key={p.id}
                  >
                    <span>
                      <b>{p.name}</b> · {p.account_type} · R${" "}
                      {(p.monthly_price_cents / 100).toFixed(2)} · {p.included_executions} execuções
                      · {p.venue_limit} estabelecimentos · {p.status}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        const price = window.prompt(
                          "Mensalidade em centavos",
                          String(p.monthly_price_cents),
                        );
                        if (price === null) return;
                        const included = window.prompt(
                          "Franquia mensal",
                          String(p.included_executions),
                        );
                        if (included === null) return;
                        const venues = window.prompt(
                          "Limite de estabelecimentos",
                          String(p.venue_limit),
                        );
                        if (venues === null) return;
                        const status = window.prompt("Status: draft, active ou inactive", p.status);
                        if (status !== "draft" && status !== "active" && status !== "inactive")
                          return;
                        void run(() =>
                          savePlan({
                            data: {
                              id: p.id,
                              code: p.code,
                              account_type: p.account_type,
                              name: p.name,
                              description: p.description,
                              monthly_price_cents: Number(price),
                              included_executions: Number(included),
                              venue_limit: Number(venues),
                              status,
                              display_order: p.display_order,
                            },
                          }),
                        );
                      }}
                    >
                      Editar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Pacotes de créditos ({data.data.packs.length})</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    const name = window.prompt("Nome do pacote");
                    if (!name) return;
                    void run(() =>
                      savePack({
                        data: {
                          name,
                          description: "",
                          credits: Number(window.prompt("Quantidade de créditos", "1") ?? 1),
                          price_cents: Number(window.prompt("Preço em centavos", "0") ?? 0),
                          validity_days: null,
                          active: false,
                          display_order: data.data.packs.length,
                        },
                      }),
                    );
                  }}
                >
                  Novo pacote
                </Button>
              </div>
              <ul className="mt-2 space-y-2">
                {data.data.packs.map((p: any) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                    key={p.id}
                  >
                    <span>
                      {p.name} · {p.credits} créditos · R$ {(p.price_cents / 100).toFixed(2)} ·{" "}
                      {p.active ? "ativo" : "inativo"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        const credits = window.prompt("Quantidade de créditos", String(p.credits));
                        if (credits === null) return;
                        const price = window.prompt("Preço em centavos", String(p.price_cents));
                        if (price === null) return;
                        const active = window.confirm("Ativar pacote? Cancelar mantém inativo.");
                        void run(() =>
                          savePack({
                            data: {
                              id: p.id,
                              name: p.name,
                              description: p.description,
                              credits: Number(credits),
                              price_cents: Number(price),
                              validity_days: p.validity_days,
                              active,
                              display_order: p.display_order,
                            },
                          }),
                        );
                      }}
                    >
                      Editar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <AdminList
              title="Trials"
              items={data.data.trials}
              label={(x) =>
                `${x.accounts?.name ?? x.account_id} · ${x.status} · até ${new Date(x.ends_at).toLocaleDateString("pt-BR")}`
              }
            />
            <AdminList
              title="Assinaturas"
              items={data.data.subscriptions}
              label={(x) =>
                `${x.accounts?.name ?? x.account_id} · ${x.status} · ${x.plan_snapshot?.name ?? "—"}`
              }
            />
            <AdminList
              title="Pedidos"
              items={data.data.orders}
              label={(x) =>
                `${x.accounts?.name ?? x.account_id} · ${x.kind} · ${x.status} · R$ ${(x.amount_cents / 100).toFixed(2)}`
              }
            />
          </div>
          <div>
            <h3 className="font-medium">Contas e ações comerciais ({data.data.accounts.length})</h3>
            <div className="my-2 grid gap-2 sm:grid-cols-6">
              <select
                aria-label="Tipo de conta"
                value={accountTypeFilter}
                onChange={(e) => setAccountTypeFilter(e.target.value)}
                className="rounded border bg-background p-2 text-sm"
              >
                <option value="all">Todos os tipos</option>
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </select>
              <select
                aria-label="Plano"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="rounded border bg-background p-2 text-sm"
              >
                <option value="all">Todos os planos</option>
                {data.data.plans.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Assinatura"
                value={subscriptionFilter}
                onChange={(e) => setSubscriptionFilter(e.target.value)}
                className="rounded border bg-background p-2 text-sm"
              >
                <option value="all">Todas as assinaturas</option>
                {["pending_payment", "active", "past_due", "suspended", "cancelled"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select
                aria-label="Trial"
                value={trialFilter}
                onChange={(e) => setTrialFilter(e.target.value)}
                className="rounded border bg-background p-2 text-sm"
              >
                <option value="all">Todos os trials</option>
                <option value="active">Ativo</option>
                <option value="expired">Vencido</option>
                <option value="none">Sem trial</option>
              </select>
              <select
                aria-label="Cobrança"
                value={billingFilter}
                onChange={(e) => setBillingFilter(e.target.value)}
                className="rounded border bg-background p-2 text-sm"
              >
                <option value="all">Cobrança (todos)</option>
                <option value="true">Habilitada</option>
                <option value="false">Desabilitada</option>
              </select>
              <select
                aria-label="Eventos"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded border bg-background p-2 text-sm"
              >
                <option value="all">Todos os eventos</option>
                <option value="problem">Evento falho/pendente</option>
              </select>
            </div>
            <ul className="mt-2 max-h-96 space-y-2 overflow-auto">
              {data.data.accounts
                .filter((a: any) => {
                  const sub = data.data.subscriptions.find((x: any) => x.account_id === a.id);
                  const trial = data.data.trials.find((x: any) => x.account_id === a.id);
                  const billing =
                    data.data.accountSettings.find((x: any) => x.account_id === a.id)
                      ?.billing_enabled ?? false;
                  const hasProblemEvent = data.data.problemEvents.some(
                    (e: any) => e.account_id === a.id,
                  );
                  const effectiveTrial =
                    trial && trial.status === "active" && Date.parse(trial.ends_at) <= Date.now()
                      ? "expired"
                      : trial?.status;
                  return (
                    (accountTypeFilter === "all" || a.type === accountTypeFilter) &&
                    (planFilter === "all" || sub?.plan_id === planFilter) &&
                    (subscriptionFilter === "all" || sub?.status === subscriptionFilter) &&
                    (trialFilter === "all" ||
                      (trialFilter === "none" ? !trial : effectiveTrial === trialFilter)) &&
                    (billingFilter === "all" || String(billing) === billingFilter) &&
                    (eventFilter === "all" || hasProblemEvent)
                  );
                })
                .map((a: any) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
                  >
                    <span>
                      {a.name} · {a.type} · {a.id}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setSelectedAccount(a.id)}
                      >
                        Visão consolidada
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const amount = Number(window.prompt("Valor regularizado em centavos"));
                          if (!Number.isInteger(amount) || amount <= 0) return;
                          const reason = window.prompt(
                            "Justificativa obrigatória da regularização",
                          );
                          if (!reason || reason.trim().length < 3) return;
                          void run(() => settleDebt({ data: { accountId: a.id, amount, reason } }));
                        }}
                      >
                        Regularizar débito
                      </Button>
                      {data.data.trials
                        .filter((t: any) => t.account_id === a.id && t.status === "active")
                        .map((t: any) => (
                          <div className="flex gap-1" key={t.id}>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => {
                                const date = window.prompt(
                                  "Novo vencimento do trial (data e hora ISO)",
                                  new Date(t.ends_at).toISOString(),
                                );
                                if (!date) return;
                                const reason = window.prompt("Justificativa obrigatória");
                                if (!reason || reason.trim().length < 3) return;
                                if (!window.confirm(`Confirmar extensão/ajuste até ${date}?`))
                                  return;
                                void run(() =>
                                  manageTrial({
                                    data: {
                                      accountId: a.id,
                                      operation:
                                        Date.parse(date) > Date.parse(t.ends_at)
                                          ? "extended"
                                          : "adjusted",
                                      endsAt: new Date(date).toISOString(),
                                      reason,
                                    },
                                  }),
                                );
                              }}
                            >
                              Ajustar trial
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    "Revogar este trial agora? Esta operação é auditada e não pode ser desfeita.",
                                  )
                                )
                                  return;
                                const reason = window.prompt(
                                  "Justificativa obrigatória para revogação",
                                );
                                if (!reason || reason.trim().length < 3) return;
                                void run(() =>
                                  manageTrial({
                                    data: {
                                      accountId: a.id,
                                      operation: "revoked",
                                      endsAt: null,
                                      reason,
                                    },
                                  }),
                                );
                              }}
                            >
                              Revogar trial
                            </Button>
                          </div>
                        ))}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt("Justificativa do trial");
                          if (!reason || reason.trim().length < 3) return;
                          void run(() =>
                            grantTrial({
                              data: {
                                accountId: a.id,
                                days: Number(data.data.settings?.trial_duration_days ?? 14),
                                reason,
                              },
                            }),
                          );
                        }}
                      >
                        Conceder trial
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const quantity = Number(
                            window.prompt(
                              "Créditos para conceder (negativo para ajuste compensatório)",
                              "10",
                            ),
                          );
                          if (!quantity) return;
                          const reason = window.prompt("Justificativa");
                          if (!reason || reason.trim().length < 3) return;
                          void run(() =>
                            grantCredits({
                              data: {
                                accountId: a.id,
                                quantity,
                                reason,
                                idempotencyKey: crypto.randomUUID(),
                              },
                            }),
                          );
                        }}
                      >
                        Ajustar créditos
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt(
                            "Justificativa para alterar habilitação de cobrança",
                          );
                          if (!reason || reason.trim().length < 3) return;
                          void run(() =>
                            setBilling({
                              data: { accountId: a.id, billing_enabled: true, reason },
                            }),
                          );
                        }}
                      >
                        Habilitar conta
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
            {selectedAccount && (
              <div className="mt-3 rounded border p-3">
                <div className="flex justify-between">
                  <b>Conta selecionada: {selectedAccount}</b>
                  <Button size="sm" variant="outline" onClick={() => setSelectedAccount("")}>
                    Fechar
                  </Button>
                </div>
                {accountDetail.isLoading ? (
                  <p>Carregando histórico completo…</p>
                ) : accountDetail.error ? (
                  <p>{errMsg(accountDetail.error)}</p>
                ) : (
                  accountDetail.data && (
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(accountDetail.data, null, 2)}
                    </pre>
                  )
                )}
              </div>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="font-medium">Eventos MP recentes ({data.data.events.length})</h3>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
                {data.data.events.map((event: any) => (
                  <li
                    className="flex items-center justify-between gap-2 rounded bg-muted p-2"
                    key={event.id}
                  >
                    <span>
                      {event.topic} · {event.status} · {event.resource_id} · tentativas{" "}
                      {event.attempts ?? 0}
                      {event.last_error ? ` · ${event.last_error}` : ""}
                      <details>
                        <summary>Payload e tentativas</summary>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                          {JSON.stringify(
                            { payload: event.payload, attempts: event.mercado_pago_event_attempts },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        busy ||
                        !event.signature_valid ||
                        !["failed", "received", "processed", "reprocessed"].includes(event.status)
                      }
                      onClick={() =>
                        void run(() => reprocessEvent({ data: { eventId: event.id } }))
                      }
                    >
                      Reprocessar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <AdminList
              title="Falhas/reconciliações"
              items={data.data.reconciliation.filter((x: any) => x.outcome === "failed")}
              label={(x) => `${x.outcome} · ${x.detail ?? "sem detalhes"}`}
            />
          </div>
        </>
      )}
    </section>
  );
}

function AdminList({
  title,
  items,
  label,
}: {
  title: string;
  items: any[];
  label: (item: any) => string;
}) {
  return (
    <div>
      <h3 className="font-medium">
        {title} ({items.length})
      </h3>
      <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
        {items.slice(0, 30).map((x, i) => (
          <li className="rounded bg-muted p-2" key={x.id ?? i}>
            {label(x)}
          </li>
        ))}
        {items.length === 0 && <li className="text-muted-foreground">Sem registros.</li>}
      </ul>
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSuperadminUsersFn);
  const detailFn = useServerFn(getSuperadminUserFn);
  const createFn = useServerFn(createSuperadminUserFn);
  const updateFn = useServerFn(updateSuperadminUserFn);
  const banFn = useServerFn(banSuperadminUserFn);
  const recoverFn = useServerFn(recoverSuperadminUserFn);
  const deleteFn = useServerFn(deleteSuperadminUserFn);
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const users = useQuery({
    queryKey: ["sa-users", page, search],
    queryFn: () => listFn({ data: { page, perPage: 20, ...(search ? { email: search } : {}) } }),
  });
  const detail = useQuery({
    queryKey: ["sa-user", selected],
    queryFn: () => detailFn({ data: { userId: selected! } }),
    enabled: !!selected,
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["sa-users"] }),
      qc.invalidateQueries({ queryKey: ["sa-user", selected] }),
    ]);
  };
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage("Operação concluída.");
      await refresh();
    } catch (e) {
      setMessage(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Usuários</h2>
        <Button
          onClick={() => {
            setCreateOpen(true);
            setMessage("");
          }}
        >
          Criar usuário
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(email.trim());
        }}
      >
        <Input
          aria-label="Pesquisar por e-mail"
          placeholder="Pesquisar por e-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button variant="outline">Pesquisar</Button>
      </form>
      {users.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {users.error && <p className="text-sm text-destructive">{errMsg(users.error)}</p>}
      {!users.isLoading && users.data?.users.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
      )}
      <ul className="divide-y">
        {users.data?.users.map(
          (u: {
            id: string;
            name: string;
            isSuperadmin: boolean;
            email: string;
            emailConfirmed: boolean;
            banned: boolean;
            createdAt: string;
          }) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium">
                  {u.name || "Sem nome"}{" "}
                  {u.isSuperadmin && <span className="text-xs text-primary">SuperAdmin</span>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {u.email} · {u.emailConfirmed ? "E-mail confirmado" : "Pendente"} ·{" "}
                  {u.banned ? "Bloqueado" : "Ativo"} ·{" "}
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString("pt-BR") : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSelected(u.id)}>
                Detalhes
              </Button>
            </li>
          ),
        )}
      </ul>
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={page <= 1 || users.isLoading}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <span className="text-sm">Página {page}</span>
        <Button
          variant="outline"
          disabled={!users.data?.hasMore || users.isLoading}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <Dialog open={createOpen} onOpenChange={(o) => !busy && setCreateOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar usuário</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await createFn({ data: { name, email: newEmail } });
                setCreateOpen(false);
                setName("");
                setNewEmail("");
              });
            }}
          >
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
            <Label>E-mail</Label>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              A pessoa receberá convite para definir a própria senha.
            </p>
            <Button disabled={busy} className="w-full">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Enviar convite
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {selected && (
        <Dialog open onOpenChange={(o) => !o && !busy && setSelected(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Detalhes do usuário</DialogTitle>
            </DialogHeader>
            {detail.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
            {detail.error && <p className="text-destructive">{errMsg(detail.error)}</p>}
            {detail.data && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={name || detail.data.name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Label>E-mail</Label>
                  <Input
                    type="email"
                    value={newEmail || detail.data.email}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      void act(async () => {
                        await updateFn({
                          data: {
                            userId: selected,
                            name: name || detail.data!.name,
                            email: newEmail || detail.data!.email,
                          },
                        });
                        setName("");
                        setNewEmail("");
                      })
                    }
                  >
                    Salvar dados
                  </Button>
                </div>
                <div>
                  <h3 className="font-semibold">Contas · papéis administrativos</h3>
                  {detail.data.accounts.length ? (
                    detail.data.accounts.map(
                      (a: {
                        account_id: string;
                        role: string;
                        accounts?: { name?: string } | null;
                      }) => (
                        <p key={a.account_id} className="text-sm">
                          {a.accounts?.name ?? a.account_id}: {a.role}
                        </p>
                      ),
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem contas vinculadas.</p>
                  )}
                </div>
                <div>
                  <h3 className="font-semibold">Estabelecimentos · papéis operacionais</h3>
                  {detail.data.venues.length ? (
                    detail.data.venues.map(
                      (v: {
                        venue_id: string;
                        role: string;
                        venues?: { name?: string } | null;
                      }) => (
                        <p key={v.venue_id} className="text-sm">
                          {v.venues?.name ?? v.venue_id}:{" "}
                          {v.role === "owner" ? "Proprietário" : "Operador"}
                        </p>
                      ),
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Sem estabelecimentos vinculados.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(() => recoverFn({ data: { email: detail.data!.email } }))
                    }
                  >
                    Recuperar senha
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || detail.data.isSuperadmin}
                    onClick={() => {
                      if (
                        window.confirm(
                          `${detail.data!.banned ? "Desbloquear" : "Bloquear"} ${detail.data!.email}?`,
                        )
                      )
                        void act(() =>
                          banFn({ data: { userId: selected, banned: !detail.data!.banned } }),
                        );
                    }}
                  >
                    {detail.data.banned ? "Desbloquear" : "Bloquear"}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || detail.data.isSuperadmin}
                    onClick={() => {
                      const emailConfirm = window.prompt(
                        `Para excluir ${detail.data!.name || "este usuário"}, digite ${detail.data!.email}`,
                      );
                      if (emailConfirm !== null)
                        void act(() =>
                          deleteFn({ data: { userId: selected, emailConfirmation: emailConfirm } }),
                        );
                    }}
                  >
                    Excluir usuário
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
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
      setResult({
        kind: "ok",
        text: "Estabelecimento e proprietário vinculados com sucesso.",
        venueId: r.venueId,
      });
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
