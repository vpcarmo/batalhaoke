import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAccountCommercialOverviewFn } from "@/lib/commercial.functions";
import {
  listCommercialOffersFn,
  startCreditCheckoutFn,
  startSubscriptionCheckoutFn,
  requestPlanChangeFn,
  requestSubscriptionCancellationFn,
} from "@/lib/commercial.functions";
export const Route = createFileRoute("/financeiro")({ component: FinanceiroPage });

function FinanceiroPage() {
  const load = useServerFn(getAccountCommercialOverviewFn);
  const loadOffers = useServerFn(listCommercialOffersFn);
  const startPlan = useServerFn(startSubscriptionCheckoutFn);
  const startCredits = useServerFn(startCreditCheckoutFn);
  const changePlan = useServerFn(requestPlanChangeFn);
  const cancelPlan = useServerFn(requestSubscriptionCancellationFn);
  const offers = useQuery({
    queryKey: ["commercial-offers"],
    queryFn: () => loadOffers(),
    retry: false,
  });
  const query = useQuery({
    queryKey: ["account-commercial-overview"],
    queryFn: () => load(),
    retry: false,
  });
  if (query.isLoading)
    return <main className="mx-auto max-w-3xl p-6">Carregando financeiroÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</main>;
  if (query.error)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Financeiro da conta</h1>
        <p className="mt-3 text-destructive">{query.error.message}</p>
      </main>
    );
  const data = query.data;
  if (!data) return null;
  async function checkout(run: () => Promise<{ checkoutUrl: string }>) {
    try {
      const result = await run();
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Falha ao iniciar checkout.");
    }
  }
  async function action(run: () => Promise<unknown>) {
    try {
      await run();
      await query.refetch();
      window.alert("Solicitação registrada.");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Falha na operação.");
    }
  }

  const plan = data.subscription?.plan_snapshot as {
    name?: string;
    monthly_price_cents?: number;
  } | null;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Financeiro da conta</h1>
        <p className="text-muted-foreground">
          {data.account?.name} Ãƒâ€šÃ‚Â·{" "}
          {data.account?.type === "business" ? "Business" : "Individual"}
        </p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <article className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">Planos disponÃƒÆ’Ã‚Â­veis</h2>
          {offers.data?.plans.map(
            (p: {
              id: string;
              name: string;
              description: string;
              monthly_price_cents: number;
              included_executions: number;
              venue_limit: number;
            }) => (
              <div key={p.id} className="flex items-center justify-between gap-3 border-t pt-3">
                <div>
                  <p className="font-medium">
                    {p.name} Ãƒâ€šÃ‚Â· R$ {(p.monthly_price_cents / 100).toFixed(2)}/mÃƒÆ’Ã‚Âªs
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.description} Ãƒâ€šÃ‚Â· {p.included_executions} execuÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Âµes
                    Ãƒâ€šÃ‚Â· {p.venue_limit} estabelecimentos
                  </p>
                </div>
                <button
                  className="rounded-md border px-3 py-2 text-sm"
                  onClick={() =>
                    data.subscription?.status === "active"
                      ? void action(() => changePlan({ data: { planId: p.id } }))
                      : void checkout(() => startPlan({ data: { planId: p.id } }))
                  }
                >
                  {data.subscription?.status === "active" ? "Agendar mudança" : "Contratar"}
                </button>
              </div>
            ),
          )}
          {!offers.isLoading && !offers.data?.plans.length && (
            <p className="text-sm text-muted-foreground">Nenhum plano publicado.</p>
          )}
        </article>
        <article className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">Comprar crÃƒÆ’Ã‚Â©ditos</h2>
          {offers.data?.packs.map(
            (p: {
              id: string;
              name: string;
              description: string;
              credits: number;
              price_cents: number;
            }) => (
              <div key={p.id} className="flex items-center justify-between gap-3 border-t pt-3">
                <div>
                  <p className="font-medium">
                    {p.name} Ãƒâ€šÃ‚Â· {p.credits} crÃƒÆ’Ã‚Â©ditos
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.description} Ãƒâ€šÃ‚Â· R$ {(p.price_cents / 100).toFixed(2)}
                  </p>
                </div>
                <button
                  className="rounded-md border px-3 py-2 text-sm"
                  onClick={() => void checkout(() => startCredits({ data: { packId: p.id } }))}
                >
                  Comprar
                </button>
              </div>
            ),
          )}
          {!offers.isLoading && !offers.data?.packs.length && (
            <p className="text-sm text-muted-foreground">Nenhum pacote disponÃƒÆ’Ã‚Â­vel.</p>
          )}
        </article>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-lg border p-4">
          <h2 className="font-semibold">Plano e assinatura</h2>
          <p className="mt-2">{plan?.name ?? "Sem plano contratado"}</p>
          <p className="text-sm text-muted-foreground">
            SituaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o: {data.subscription?.status ?? "nÃƒÆ’Ã‚Â£o contratada"}
          </p>
          {data.subscription?.status === "active" && (
            <button
              className="mt-3 rounded-md border px-3 py-2 text-sm"
              onClick={() => void action(() => cancelPlan({ data: {} }))}
            >
              Solicitar cancelamento
            </button>
          )}
          {plan?.monthly_price_cents != null && (
            <p>R$ {(plan.monthly_price_cents / 100).toFixed(2)} / mÃƒÆ’Ã‚Âªs</p>
          )}
          <p className="text-sm">
            PrÃƒÆ’Ã‚Â³xima renovaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o:{" "}
            {data.subscription?.next_renewal_at
              ? new Date(data.subscription.next_renewal_at).toLocaleDateString("pt-BR")
              : "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"}
          </p>
          {data.subscription?.status === "past_due" && (
            <p role="status" className="mt-2 text-sm text-destructive">
              Pagamento pendente desde{" "}
              {data.subscription.delinquent_since
                ? new Date(data.subscription.delinquent_since).toLocaleDateString("pt-BR")
                : "data não informada"}
              . Prazo de regularização até{" "}
              {data.subscription.grace_ends_at
                ? new Date(data.subscription.grace_ends_at).toLocaleDateString("pt-BR")
                : "agora"}
              . Consulte os pagamentos abaixo para regularizar.
            </p>
          )}
          {data.subscription?.status === "suspended" && (
            <p role="status" className="mt-2 text-sm text-destructive">
              Uso comercial suspenso por inadimplência. O painel financeiro e a consulta de
              pagamentos permanecem disponíveis para regularização.
            </p>
          )}
        </article>
        <article className="rounded-lg border p-4">
          <h2 className="font-semibold">Trial</h2>
          <p className="mt-2">
            {data.trial
              ? `${data.trial.status} Ãƒâ€šÃ‚Â· atÃƒÆ’Ã‚Â© ${new Date(data.trial.ends_at).toLocaleDateString("pt-BR")}`
              : "Nenhum trial registrado"}
          </p>
          <p className="text-sm text-muted-foreground">
            CobranÃƒÆ’Ã‚Â§a {data.billingEnabled ? "habilitada" : "desativada"} para esta conta
          </p>
        </article>
        <article className="rounded-lg border p-4">
          <h2 className="font-semibold">Consumo do ciclo</h2>
          <p className="mt-2">
            Franquia: {data.currentUsage.included} Ãƒâ€šÃ‚Â· consumidas:{" "}
            {data.currentUsage.consumed}
          </p>
          <p>
            Reservadas: {data.currentUsage.reserved} Ãƒâ€šÃ‚Â· disponÃƒÆ’Ã‚Â­veis:{" "}
            {data.currentUsage.available}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.venueCount} estabelecimento(s) vinculado(s)
          </p>
        </article>
        <article className="rounded-lg border p-4">
          <h2 className="font-semibold">Carteira de crÃƒÆ’Ã‚Â©ditos</h2>
          <p className="mt-2">Saldo: {data.walletBalance}</p>
          <p className="text-sm text-muted-foreground">MovimentaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Âµes financeiras</p>
        </article>
      </section>
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold">HistÃƒÆ’Ã‚Â³rico de crÃƒÆ’Ã‚Â©ditos</h2>
        {data.movements.length ? (
          <ul className="mt-3 divide-y">
            {data.movements.map(
              (entry: {
                id: string;
                quantity: number;
                entry_type: string;
                created_at: string;
                reason: string | null;
              }) => (
                <li key={entry.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span>
                    {entry.entry_type}
                    {entry.reason ? ` Ãƒâ€šÃ‚Â· ${entry.reason}` : ""}
                  </span>
                  <span>
                    {entry.quantity > 0 ? "+" : ""}
                    {entry.quantity} Ãƒâ€šÃ‚Â·{" "}
                    {new Date(entry.created_at).toLocaleDateString("pt-BR")}
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhuma movimentaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o registrada.
          </p>
        )}
      </section>
      <p className="text-sm text-muted-foreground">
        AlteraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Âµes de plano sÃƒÆ’Ã‚Â£o programadas para o prÃƒÆ’Ã‚Â³ximo ciclo, sem
        cobranÃƒÆ’Ã‚Â§a proporcional. ContrataÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o e compra de crÃƒÆ’Ã‚Â©ditos
        ficarÃƒÆ’Ã‚Â£o disponÃƒÆ’Ã‚Â­veis apÃƒÆ’Ã‚Â³s configuraÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o do catÃƒÆ’Ã‚Â¡logo
        e do provedor de pagamentos.
      </p>
    </main>
  );
}
