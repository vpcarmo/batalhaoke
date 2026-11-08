/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase schema types do not yet include migrations 0030-0032. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function ownerAccount(db: any, userId: string) {
  const { data, error } = await db
    .from("account_members")
    .select("account_id, accounts(id,name,type)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (error || !data)
    throw new Error("Somente o proprietÃ¡rio da conta pode acessar o financeiro.");
  return data;
}

async function checkoutConfig(db: any, accountId: string) {
  const { data, error } = await db
    .from("commercial_settings")
    .select("billing_enabled")
    .eq("id", true)
    .single();
  if (error || !data?.billing_enabled)
    throw new Error("ContrataÃ§Ãµes estÃ£o temporariamente indisponÃ­veis.");
  const { data: accountSettings } = await db
    .from("commercial_account_settings")
    .select("billing_enabled")
    .eq("account_id", accountId)
    .maybeSingle();
  if (!accountSettings?.billing_enabled)
    throw new Error("CobranÃ§a nÃ£o estÃ¡ habilitada para esta conta.");
}

function publicUrl(path: string) {
  const origin = process.env["APP_URL"];
  if (!origin) throw new Error("APP_URL nÃ£o configurada no servidor.");
  return new URL(path, origin).toString();
}

/** Financial data is account-scoped and only the account owner may read it. */
export const getAccountCommercialOverviewFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The generated Supabase types predate the commercial migration.

    const db = supabaseAdmin as any;
    const { data: membership, error: memberError } = await db
      .from("account_members")
      .select("account_id, role, accounts(id, name, type)")
      .eq("user_id", context.userId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();
    if (memberError) throw new Error("NÃ£o foi possÃ­vel validar a conta.");
    if (!membership) throw new Error("Somente o proprietÃ¡rio da conta pode acessar o financeiro.");

    const accountId = membership.account_id as string;
    const [settings, subscription, trial, venues, credits, walletEntries, periods, purchases] =
      await Promise.all([
        db
          .from("commercial_account_settings")
          .select("billing_enabled")
          .eq("account_id", accountId)
          .maybeSingle(),
        db
          .from("account_subscriptions")
          .select(
            "id, status, plan_snapshot, current_period_start, current_period_end, next_renewal_at, payment_status, pending_plan_id, cancellation_requested_at, external_id, delinquent_since, grace_ends_at, suspended_at",
          )
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("account_trials")
          .select("starts_at, ends_at, status")
          .eq("account_id", accountId)
          .maybeSingle(),
        db.from("venues").select("id", { count: "exact", head: true }).eq("account_id", accountId),
        db
          .from("credit_wallet_ledger")
          .select("id, quantity, entry_type, source, created_at, expires_at, reason")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("credit_wallet_ledger").select("quantity, expires_at").eq("account_id", accountId),
        db
          .from("account_billing_periods")
          .select("id, starts_at, ends_at, included_executions")
          .eq("account_id", accountId)
          .order("starts_at", { ascending: false })
          .limit(12),
        db
          .from("commercial_orders")
          .select(
            "id, status, amount_cents, kind, created_at, paid_at, external_payment_id, external_reference",
          )
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
    for (const result of [
      settings,
      subscription,
      trial,
      venues,
      credits,
      walletEntries,
      periods,
      purchases,
    ]) {
      if (result.error) throw new Error("NÃ£o foi possÃ­vel carregar os dados comerciais.");
    }
    const periodList = periods.data ?? [];
    const current = periodList.find(
      (item: { starts_at: string; ends_at: string }) =>
        Date.parse(item.starts_at) <= Date.now() && Date.parse(item.ends_at) > Date.now(),
    );
    const [usage, reservations] = current
      ? await Promise.all([
          db
            .from("account_usage_ledger")
            .select("id", { count: "exact", head: true })
            .eq("account_id", accountId)
            .eq("billing_period_id", current.id)
            .eq("entry_type", "qualified_performance"),
          db
            .from("execution_reservations")
            .select("performance_id", { count: "exact", head: true })
            .eq("account_id", accountId)
            .eq("billing_period_id", current.id)
            .eq("source", "quota")
            .eq("status", "reserved"),
        ])
      : [
          { count: 0, error: null },
          { count: 0, error: null },
        ];
    if (usage.error || reservations.error)
      throw new Error("NÃ£o foi possÃ­vel carregar o consumo.");
    const walletBalance = (walletEntries.data ?? []).reduce(
      (sum: number, item: { quantity: number; expires_at: string | null }) =>
        sum + (item.expires_at && Date.parse(item.expires_at) <= Date.now() ? 0 : item.quantity),
      0,
    );
    return {
      account: membership.accounts,
      billingEnabled: settings.data?.billing_enabled ?? false,
      subscription: subscription.data ?? null,
      trial: trial.data ?? null,
      venueCount: venues.count ?? 0,
      walletBalance,
      movements: credits.data ?? [],
      periods: periodList,
      payments: purchases.data ?? [],
      currentUsage: {
        included: current?.included_executions ?? 0,
        consumed: usage.count ?? 0,
        reserved: reservations.count ?? 0,
        available: Math.max(
          0,
          (current?.included_executions ?? 0) - (usage.count ?? 0) - (reservations.count ?? 0),
        ),
      },
    };
  });

export const listCommercialOffersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const db = supabaseAdmin as any;
    const membership = await ownerAccount(db, context.userId);
    const [plans, packs] = await Promise.all([
      db
        .from("commercial_plans")
        .select(
          "id,code,account_type,name,description,monthly_price_cents,included_executions,venue_limit,version",
        )
        .eq("status", "active")
        .eq("account_type", membership.accounts.type)
        .order("display_order"),
      db
        .from("credit_packs")
        .select("id,name,description,credits,price_cents,validity_days")
        .eq("active", true)
        .order("display_order"),
    ]);
    if (plans.error || packs.error) throw new Error("NÃ£o foi possÃ­vel consultar as ofertas.");
    return { plans: plans.data ?? [], packs: packs.data ?? [] };
  });

export const startCreditCheckoutFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ packId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const db = supabaseAdmin as any;
    const member = await ownerAccount(db, context.userId);
    await checkoutConfig(db, member.account_id);
    const { data: pack, error } = await db
      .from("credit_packs")
      .select("id,name,credits,price_cents,validity_days")
      .eq("id", data.packId)
      .eq("active", true)
      .single();
    if (error || !pack) throw new Error("Pacote indisponÃ­vel.");
    const reference = crypto.randomUUID();
    const creditExpiresAt = pack.validity_days
      ? new Date(Date.now() + pack.validity_days * 86400000).toISOString()
      : null;
    const { data: order, error: insertError } = await db
      .from("commercial_orders")
      .insert({
        account_id: member.account_id,
        pack_id: pack.id,
        kind: "credits",
        amount_cents: pack.price_cents,
        credits: pack.credits,
        credit_expires_at: creditExpiresAt,
        external_reference: reference,
      })
      .select("id")
      .single();
    if (insertError || !order) throw new Error("NÃ£o foi possÃ­vel iniciar o pedido.");
    try {
      const { createCreditCheckout } = await import("./mercado-pago.server");
      const checkout = await createCreditCheckout({
        orderId: order.id,
        title: pack.name,
        amountCents: pack.price_cents,
        externalReference: reference,
        notificationUrl: publicUrl("/api/mercado-pago/webhook"),
        backUrl: publicUrl("/financeiro"),
      });
      const { error: updateError } = await db
        .from("commercial_orders")
        .update({ external_preference_id: checkout.id })
        .eq("id", order.id);
      if (updateError || typeof checkout["init_point"] !== "string")
        throw new Error("Resposta de checkout invÃ¡lida.");
      return { checkoutUrl: checkout["init_point"] };
    } catch (e) {
      await db.from("commercial_orders").update({ status: "cancelled" }).eq("id", order.id);
      throw e;
    }
  });

export const startSubscriptionCheckoutFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const db = supabaseAdmin as any;
    const member = await ownerAccount(db, context.userId);
    await checkoutConfig(db, member.account_id);
    const { data: plan, error } = await db
      .from("commercial_plans")
      .select("*")
      .eq("id", data.planId)
      .eq("status", "active")
      .eq("account_type", member.accounts.type)
      .single();
    if (error || !plan || plan.monthly_price_cents <= 0) throw new Error("Plano indisponÃ­vel.");
    const { data: existing } = await db
      .from("account_subscriptions")
      .select("id")
      .eq("account_id", member.account_id)
      .in("status", ["pending_payment", "active", "past_due", "cancel_requested", "suspended"])
      .limit(1)
      .maybeSingle();
    if (existing) throw new Error("A conta jÃ¡ possui uma assinatura em andamento.");
    const snapshot = {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      account_type: plan.account_type,
      monthly_price_cents: plan.monthly_price_cents,
      included_executions: plan.included_executions,
      venue_limit: plan.venue_limit,
      version: plan.version,
    };
    const { data: sub, error: subError } = await db
      .from("account_subscriptions")
      .insert({
        account_id: member.account_id,
        plan_id: plan.id,
        plan_version: plan.version,
        plan_snapshot: snapshot,
        status: "pending_payment",
      })
      .select("id")
      .single();
    if (subError || !sub) throw new Error("NÃ£o foi possÃ­vel iniciar a assinatura.");
    const reference = crypto.randomUUID();
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(
      context.userId,
    );
    const payerEmail = authUser?.user?.email;
    if (authError || !payerEmail) {
      await db.from("account_subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
      throw new Error("NÃ£o foi possÃ­vel confirmar o e-mail do proprietÃ¡rio.");
    }
    const { data: order, error: orderError } = await db
      .from("commercial_orders")
      .insert({
        account_id: member.account_id,
        subscription_id: sub.id,
        kind: "subscription",
        amount_cents: plan.monthly_price_cents,
        external_reference: reference,
      })
      .select("id")
      .single();
    if (orderError || !order) {
      await db.from("account_subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
      throw new Error("NÃ£o foi possÃ­vel iniciar o pedido.");
    }
    try {
      const { createRecurringSubscription } = await import("./mercado-pago.server");
      const provider = await createRecurringSubscription({
        reason: `BatalhaOkÃª - ${plan.name}`,
        amountCents: plan.monthly_price_cents,
        externalReference: reference,
        payerEmail,
        backUrl: publicUrl("/financeiro"),
      });
      if (typeof provider["init_point"] !== "string" || !provider.id)
        throw new Error("Resposta de checkout invÃ¡lida.");
      await db
        .from("account_subscriptions")
        .update({ external_id: String(provider.id) })
        .eq("id", sub.id);
      await db
        .from("commercial_orders")
        .update({ external_preference_id: String(provider.id) })
        .eq("id", order.id);
      return { checkoutUrl: provider["init_point"] };
    } catch (e) {
      await db.from("commercial_orders").update({ status: "cancelled" }).eq("id", order.id);
      await db.from("account_subscriptions").update({ status: "cancelled" }).eq("id", sub.id);
      throw e;
    }
  });

// Commercial administration shares the existing live SuperAdmin authorization.
async function commercialAdmin(userId: string) {
  const [{ supabaseAdmin }, { assertPlatformAdmin }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./auth.server"),
  ]);
  await assertPlatformAdmin(supabaseAdmin, userId);

  return supabaseAdmin as any;
}

async function loadAllCommercialRows(db: any, table: string, select: string, orderColumn: string) {
  const all: any[] = [];
  for (let page = 0; ; page++) {
    const result = await db
      .from(table)
      .select(select)
      .order(orderColumn, { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (result.error) throw new Error("Falha ao carregar o histórico comercial.");
    all.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return all;
  }
}

export const getCommercialAdminDataFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await commercialAdmin(context.userId);
    const results = await Promise.all([
      db.from("commercial_settings").select("*").eq("id", true).single(),
      db.from("commercial_plans").select("*").order("display_order"),
      db.from("credit_packs").select("*").order("display_order"),
      db
        .from("account_trials")
        .select("*, accounts(id,name,type)")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("account_subscriptions")
        .select("*, accounts(id,name,type)")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("commercial_orders")
        .select("*, accounts(id,name,type)")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("mercado_pago_events")
        .select(
          "id,event_id,resource_id,topic,signature_valid,status,received_at,processed_at,attempts,last_attempt_at,last_error,reprocess_requested_by,reprocess_requested_at,reprocessed_at,payload,mercado_pago_event_attempts(*)",
        )
        .order("received_at", { ascending: false })
        .limit(200),
      db
        .from("commercial_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("commercial_reconciliation_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("accounts")
        .select("id,name,type,account_members(user_id,role)")
        .order("created_at", { ascending: false })
        .limit(200),
      db.from("commercial_account_settings").select("account_id,billing_enabled"),
    ]);
    if (results.some((r: any) => r.error))
      throw new Error("Falha ao carregar dados comerciais administrativos.");
    const [
      settings,
      plans,
      packs,
      trials,
      subscriptions,
      orders,
      _recentEvents,
      audit,
      reconciliation,
      _firstAccounts,
      accountSettings,
    ] = results.map((r: any) => r.data);
    const [events, accounts] = await Promise.all([
      loadAllCommercialRows(
        db,
        "mercado_pago_events",
        "*,mercado_pago_event_attempts(*)",
        "received_at",
      ),
      loadAllCommercialRows(
        db,
        "accounts",
        "id,name,type,created_at,account_members(user_id,role)",
        "created_at",
      ),
    ]);
    const { data: problemEvents, error: problemEventsError } = await db
      .from("mercado_pago_events")
      .select("account_id,status")
      .not("account_id", "is", null)
      .in("status", ["received", "failed", "reprocess_requested"]);
    if (problemEventsError) throw new Error("Falha ao consultar eventos pendentes.");
    return {
      settings,
      plans,
      packs,
      trials,
      subscriptions,
      orders,
      events,
      audit,
      reconciliation,
      accounts,
      accountSettings,
      problemEvents: problemEvents ?? [],
    };
  });

export const manageCommercialTrialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        accountId: z.string().uuid(),
        operation: z.enum(["adjusted", "extended", "revoked"]),
        endsAt: z.string().datetime().nullable(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const { data: id, error } = await db.rpc("manage_commercial_trial", {
      p_account_id: data.accountId,
      p_operation: data.operation,
      p_ends_at: data.endsAt,
      p_reason: data.reason,
      p_actor: context.userId,
    });
    if (error) throw new Error("Não foi possível alterar o trial ativo.");
    return { id };
  });

export const settleCommercialDebtFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        accountId: z.string().uuid(),
        amount: z.number().int().positive(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const { data: settled, error } = await db.rpc("settle_commercial_chargeback_debt", {
      p_account_id: data.accountId,
      p_amount: data.amount,
      p_reason: data.reason,
      p_actor: context.userId,
    });
    if (error) throw new Error("Não foi possível regularizar a obrigação financeira.");
    return { settled };
  });

export const getCommercialAccountDetailFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const tables = [
      "accounts",
      "account_members",
      "venues",
      "commercial_account_settings",
      "account_trials",
      "commercial_trial_history",
      "account_subscriptions",
      "account_billing_periods",
      "account_usage_ledger",
      "execution_reservations",
      "credit_wallet_ledger",
      "commercial_chargeback_debts",
      "commercial_orders",
      "commercial_payment_adjustments",
      "commercial_subscription_payments",
      "mercado_pago_events",
      "commercial_reconciliation_log",
      "commercial_audit_log",
    ];
    const [{ data: accountSubs }, { data: accountOrders }] = await Promise.all([
      db.from("account_subscriptions").select("id").eq("account_id", data.accountId),
      db.from("commercial_orders").select("id").eq("account_id", data.accountId),
    ]);
    const subscriptionIds = (accountSubs ?? []).map((x: any) => x.id);
    const orderIds = (accountOrders ?? []).map((x: any) => x.id);
    const results = await Promise.all(
      tables.map(async (table) => {
        const rows: any[] = [];
        for (let page = 0; ; page++) {
          let q = db
            .from(table)
            .select(table === "mercado_pago_events" ? "*,mercado_pago_event_attempts(*)" : "*");
          if (table === "commercial_subscription_payments") {
            if (!subscriptionIds.length) return [];
            q = q.in("subscription_id", subscriptionIds);
          } else if (table === "commercial_reconciliation_log") {
            if (!subscriptionIds.length && !orderIds.length) return [];
            const [byOrder, bySub] = await Promise.all([
              orderIds.length
                ? db.from(table).select("*").in("order_id", orderIds)
                : { data: [], error: null },
              subscriptionIds.length
                ? db.from(table).select("*").in("subscription_id", subscriptionIds)
                : { data: [], error: null },
            ]);
            if (byOrder.error || bySub.error)
              throw new Error("Falha ao carregar reconciliações da conta.");
            return [
              ...new Map(
                [...(byOrder.data ?? []), ...(bySub.data ?? [])].map((x: any) => [x.id, x]),
              ).values(),
            ];
          } else q = q.eq(table === "accounts" ? "id" : "account_id", data.accountId);
          if (table !== "accounts" && table !== "commercial_account_settings")
            q = q.order(
              table === "mercado_pago_events"
                ? "received_at"
                : table === "execution_reservations"
                  ? "reserved_at"
                  : "created_at",
              {
                ascending: false,
              },
            );
          const batch = await q.range(page * 1000, page * 1000 + 999);
          if (batch.error) throw new Error("Falha ao carregar a conta comercial.");
          rows.push(...(batch.data ?? []));
          if ((batch.data?.length ?? 0) < 1000) break;
        }
        return rows;
      }),
    );
    return Object.fromEntries(tables.map((table, i) => [table, results[i]]));
  });

export const reprocessCommercialEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const got = await db
      .from("mercado_pago_events")
      .select("*,mercado_pago_event_attempts(*)")
      .eq("id", data.eventId)
      .single();
    if (got.error || !got.data) throw new Error("Evento não encontrado.");
    const event = got.data;
    if (
      !event.signature_valid ||
      !event.resource_id ||
      ![
        "payment",
        "subscription_authorized_payment",
        "subscription_preapproval",
        "topic_chargebacks_wh",
        "chargebacks",
      ].includes(event.topic)
    )
      throw new Error("Evento sem assinatura e referência verificáveis.");
    const lockKey = `${event.topic}:${event.resource_id}`;
    await db
      .from("commercial_provider_resource_locks")
      .delete()
      .lt("acquired_at", new Date(Date.now() - 15 * 60_000).toISOString());
    const lock = await db
      .from("commercial_provider_resource_locks")
      .insert({ resource_key: lockKey, event_id: event.id })
      .select("resource_key")
      .maybeSingle();
    if (lock.error || !lock.data) throw new Error("Este recurso já está sendo processado.");
    const requested = await db
      .from("mercado_pago_events")
      .update({
        status: "reprocess_requested",
        reprocess_requested_by: context.userId,
        reprocess_requested_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .in("status", ["failed", "received", "validated", "processed", "reprocessed"])
      .select("id")
      .maybeSingle();
    if (!requested.data) {
      await db.from("commercial_provider_resource_locks").delete().eq("resource_key", lockKey);
      throw new Error("Event is currently processing.");
    }
    const claim = await db
      .from("mercado_pago_events")
      .update({
        status: "processing",
        attempts: Number(event.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("status", "reprocess_requested")
      .select("id")
      .maybeSingle();
    if (!claim.data) {
      await db.from("commercial_provider_resource_locks").delete().eq("resource_key", lockKey);
      throw new Error("Evento já está sendo processado.");
    }
    const attemptNumber = Number(event.attempts ?? 0) + 1;
    await db.from("mercado_pago_event_attempts").insert({
      event_id: event.id,
      attempt: attemptNumber,
      initiated_by: context.userId,
      status: "processing",
    });
    try {
      const mp = await import("./mercado-pago.server");
      if (event.topic === "subscription_preapproval") {
        const remote = await mp.getSubscription(event.resource_id);
        if (remote.status === "cancelled")
          await db
            .from("account_subscriptions")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("external_id", event.resource_id);
      } else if (event.topic === "topic_chargebacks_wh" || event.topic === "chargebacks") {
        const dispute: any = await mp.getChargeback(event.resource_id);
        const paymentId = String(dispute.payment_id ?? "");
        if (!paymentId) throw new Error("Contestação sem pagamento associado.");
        const payment: any = await mp.getPayment(paymentId);
        if (
          ["charged_back", "refunded"].includes(String(dispute.status)) ||
          ["charged_back", "refunded"].includes(String(payment.status))
        ) {
          const cents = Math.round(Number(dispute.amount ?? payment.transaction_amount) * 100);
          const r = await db.rpc("apply_commercial_reversal", {
            p_payment_id: paymentId,
            p_adjustment_id: event.resource_id,
            p_kind: "chargeback",
            p_amount_cents: cents,
            p_currency: String(payment.currency_id ?? "BRL"),
            p_status: String(dispute.status ?? payment.status),
          });
          if (r.error) throw r.error;
        }
      } else {
        const invoice: any =
          event.topic === "subscription_authorized_payment"
            ? await mp.getAuthorizedPayment(event.resource_id)
            : null;
        const payment: any = invoice
          ? (invoice.payment as Record<string, any> | undefined)
          : await mp.getPayment(event.resource_id);
        const paymentId = String(payment?.id ?? invoice?.id ?? event.resource_id);
        const ref = invoice?.external_reference ?? payment?.external_reference;
        const status = String(payment?.status ?? invoice?.summarized ?? "");
        const cents = Math.round(
          Number(payment?.transaction_amount ?? invoice?.transaction_amount) * 100,
        );
        for (const refund of (await mp.listPaymentRefunds(paymentId)) as any[]) {
          if (
            !refund.id ||
            !Number.isFinite(Number(refund.amount)) ||
            String(refund.status) !== "approved"
          )
            continue;
          const r = await db.rpc("apply_commercial_reversal", {
            p_payment_id: paymentId,
            p_adjustment_id: String(refund.id),
            p_kind: "refund",
            p_amount_cents: Math.round(Number(refund.amount) * 100),
            p_currency: String(payment?.currency_id ?? "BRL"),
            p_status: "approved",
          });
          if (r.error) throw r.error;
        }
        if (!ref || !Number.isFinite(cents))
          throw new Error("Pagamento sem referência ou valor verificável.");
        const r = await db.rpc("apply_commercial_payment", {
          p_external_reference: ref,
          p_payment_id: paymentId,
          p_status: status,
          p_paid_at: payment?.date_approved ?? new Date().toISOString(),
          p_amount_cents: cents,
        });
        if (r.error) throw r.error;
      }
      await db
        .from("mercado_pago_events")
        .update({
          status: "reprocessed",
          processed_at: new Date().toISOString(),
          reprocessed_at: new Date().toISOString(),
          last_error: null,
          claim_token: null,
          claimed_at: null,
        })
        .eq("id", event.id);
      await db
        .from("mercado_pago_event_attempts")
        .update({ status: "processed", result: { outcome: "authoritative_resource_applied" } })
        .eq("event_id", event.id)
        .eq("attempt", attemptNumber);
      await db.from("commercial_audit_log").insert({
        actor_user_id: context.userId,
        operation: "provider_event_reprocessed",
        reason: `Reprocessamento confirmado: ${event.id}`,
        after_state: { event_id: event.id, topic: event.topic, resource_id: event.resource_id },
      });
      return { status: "reprocessed" };
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 500) : "Falha desconhecida";
      await db
        .from("mercado_pago_events")
        .update({
          status: "failed",
          last_error: message,
          processing_error: message,
          claim_token: null,
          claimed_at: null,
        })
        .eq("id", event.id);
      await db
        .from("mercado_pago_event_attempts")
        .update({ status: "failed", error: message })
        .eq("event_id", event.id)
        .eq("attempt", attemptNumber);
      throw new Error(
        "O Mercado Pago não confirmou o reprocessamento. Consulte as tentativas do evento.",
      );
    } finally {
      await db.from("commercial_provider_resource_locks").delete().eq("resource_key", lockKey);
    }
  });

const planInput = z.object({
  id: z.string().uuid().optional(),
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  account_type: z.enum(["individual", "business"]),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  monthly_price_cents: z.number().int().min(0),
  included_executions: z.number().int().min(0),
  venue_limit: z.number().int().min(0),
  status: z.enum(["draft", "active", "inactive"]),
  display_order: z.number().int().min(0),
});
export const saveCommercialPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => planInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    let previous = null;
    if (data.id) {
      const got = await db.from("commercial_plans").select("*").eq("id", data.id).single();
      if (got.error) throw new Error("Plano não encontrado.");
      previous = got.data;
    }
    const version = (previous?.version ?? 0) + 1;
    const values = { ...data, version, updated_at: new Date().toISOString() };
    delete (values as any).id;
    const saved = data.id
      ? await db.from("commercial_plans").update(values).eq("id", data.id).select("*").single()
      : await db.from("commercial_plans").insert(values).select("*").single();
    if (saved.error) throw new Error("Falha ao salvar plano.");
    await db
      .from("commercial_plan_versions")
      .insert({ plan_id: saved.data.id, version, snapshot: values });
    await db.from("commercial_audit_log").insert({
      actor_user_id: context.userId,
      operation: data.id ? "plan_updated" : "plan_created",
      before_state: previous,
      after_state: saved.data,
    });
    return saved.data;
  });

const packInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  credits: z.number().int().positive(),
  price_cents: z.number().int().min(0),
  validity_days: z.number().int().positive().nullable(),
  active: z.boolean(),
  display_order: z.number().int().min(0),
});
export const saveCreditPackFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => packInput.parse(d))
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const prior = data.id
      ? await db.from("credit_packs").select("*").eq("id", data.id).maybeSingle()
      : { data: null, error: null };
    if (prior.error) throw new Error("Falha ao consultar pacote.");
    const values = { ...data, updated_at: new Date().toISOString() };
    delete (values as any).id;
    const result = data.id
      ? await db.from("credit_packs").update(values).eq("id", data.id).select("*").single()
      : await db.from("credit_packs").insert(values).select("*").single();
    if (result.error) throw new Error("Falha ao salvar pacote.");
    await db.from("commercial_audit_log").insert({
      actor_user_id: context.userId,
      operation: data.id ? "pack_updated" : "pack_created",
      before_state: prior.data,
      after_state: result.data,
    });
    return result.data;
  });

export const updateCommercialSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        billing_enabled: z.boolean().optional(),
        trial_duration_days: z.number().int().positive().nullable().optional(),
        delinquency_grace_days: z.number().int().min(0).max(90).optional(),
      })
      .refine((v) => Object.keys(v).length > 0)
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const old = await db.from("commercial_settings").select("*").eq("id", true).single();
    if (old.error) throw new Error("Configuração não encontrada.");
    const r = await db
      .from("commercial_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select("*")
      .single();
    if (r.error) throw new Error("Falha ao atualizar configuração.");
    await db.from("commercial_audit_log").insert({
      actor_user_id: context.userId,
      operation: "settings_updated",
      before_state: old.data,
      after_state: r.data,
    });
    return r.data;
  });

export const grantCommercialTrialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        accountId: z.string().uuid(),
        days: z.number().int().positive().max(365),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const { data: id, error } = await db.rpc("grant_commercial_trial", {
      p_account_id: data.accountId,
      p_days: data.days,
      p_reason: data.reason,
      p_actor: context.userId,
    });
    if (error) throw new Error("Conta inelegível ou já utilizou trial.");
    return { id };
  });

export const grantCommercialCreditsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        accountId: z.string().uuid(),
        quantity: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((n) => n !== 0),
        reason: z.string().trim().min(3).max(500),
        idempotencyKey: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const { data: id, error } = await db.rpc("grant_commercial_credits", {
      p_account_id: data.accountId,
      p_quantity: data.quantity,
      p_reason: data.reason,
      p_actor: context.userId,
      p_idempotency_key: `admin:${data.idempotencyKey}`,
    });
    if (error) throw new Error("Falha no ajuste da carteira.");
    return { ledgerId: id };
  });

export const setAccountBillingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        accountId: z.string().uuid(),
        billing_enabled: z.boolean(),
        venue_limit_override: z.number().int().min(0).nullable().optional(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await commercialAdmin(context.userId);
    const old = await db
      .from("commercial_account_settings")
      .select("*")
      .eq("account_id", data.accountId)
      .maybeSingle();
    const values = {
      account_id: data.accountId,
      billing_enabled: data.billing_enabled,
      venue_limit_override: data.venue_limit_override ?? null,
      updated_at: new Date().toISOString(),
    };
    const r = await db.from("commercial_account_settings").upsert(values).select("*").single();
    if (r.error) throw new Error("Falha ao atualizar conta.");
    await db.from("commercial_audit_log").insert({
      actor_user_id: context.userId,
      account_id: data.accountId,
      operation: "account_billing_updated",
      reason: data.reason,
      before_state: old.data,
      after_state: r.data,
    });
    return r.data;
  });

export const reconcileCommercialFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const db = await commercialAdmin(context.userId);
    const { getPayment, findPaymentByExternalReference, getSubscription, listAuthorizedPayments } =
      await import("./mercado-pago.server");
    const runId = crypto.randomUUID();
    const orders = await db
      .from("commercial_orders")
      .select("id,external_reference,external_payment_id,subscription_id,status")
      .eq("status", "pending")
      .limit(100);
    if (orders.error) throw new Error("Falha ao buscar pedidos pendentes.");
    const outcomes: string[] = [];
    for (const order of orders.data ?? []) {
      try {
        const candidates = order.external_payment_id
          ? [await getPayment(String(order.external_payment_id))]
          : await findPaymentByExternalReference(order.external_reference);
        const p = candidates.sort((a, b) =>
          String(b["date_created"] ?? "").localeCompare(String(a["date_created"] ?? "")),
        )[0];
        if (!p) {
          await db.from("commercial_reconciliation_log").insert({
            run_id: runId,
            order_id: order.id,
            outcome: "still_pending",
            actor_user_id: context.userId,
          });
          continue;
        }
        const ref = p["external_reference"];
        const st = p.status;
        const amount = p["transaction_amount"];
        if (
          typeof ref !== "string" ||
          typeof st !== "string" ||
          (typeof amount !== "number" && typeof amount !== "string")
        )
          throw new Error("Resposta de pagamento inválida.");
        const amountNumber = Number(amount);
        if (!Number.isFinite(amountNumber)) throw new Error("Valor de pagamento inválido.");
        const applied = await db.rpc("apply_commercial_payment", {
          p_external_reference: ref,
          p_payment_id: String(p.id),
          p_status: st,
          p_paid_at:
            typeof p["date_approved"] === "string" ? p["date_approved"] : new Date().toISOString(),
          p_amount_cents: Math.round(amountNumber * 100),
        });
        if (applied.error) throw applied.error;
        outcomes.push(order.id);
        await db.from("commercial_reconciliation_log").insert({
          run_id: runId,
          order_id: order.id,
          outcome: `payment_${st}`,
          actor_user_id: context.userId,
        });
      } catch (e) {
        await db.from("commercial_reconciliation_log").insert({
          run_id: runId,
          order_id: order.id,
          outcome: "failed",
          detail: e instanceof Error ? e.message.slice(0, 500) : "unknown",
          actor_user_id: context.userId,
        });
      }
    }
    const subs = await db
      .from("account_subscriptions")
      .select("id,external_id,status")
      .in("status", ["active", "past_due", "cancel_requested"])
      .not("external_id", "is", null)
      .limit(100);
    for (const sub of subs.data ?? []) {
      try {
        const remote = await getSubscription(String(sub.external_id));
        if (remote.status === "cancelled" && sub.status !== "cancelled")
          await db
            .from("account_subscriptions")
            .update({
              status: "cancelled",
              cancelled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);
        const order = await db
          .from("commercial_orders")
          .select("external_reference")
          .eq("subscription_id", sub.id)
          .eq("kind", "subscription")
          .order("created_at", { ascending: true })
          .limit(1)
          .single();
        if (!order.error) {
          const invoices = await listAuthorizedPayments(String(sub.external_id));
          for (const invoice of invoices) {
            const payment = invoice["payment"] as Record<string, unknown> | undefined;
            const ref = invoice["external_reference"] ?? order.data.external_reference;
            const status = payment?.["status"] ?? invoice["summarized"];
            const amount = invoice["transaction_amount"] ?? payment?.["transaction_amount"];
            const amountNumber = Number(amount);
            if (
              typeof ref !== "string" ||
              typeof status !== "string" ||
              !Number.isFinite(amountNumber)
            )
              continue;
            const applied = await db.rpc("apply_commercial_payment", {
              p_external_reference: ref,
              p_payment_id: String(payment?.["id"] ?? invoice["id"]),
              p_status: status,
              p_paid_at:
                typeof payment?.["date_approved"] === "string"
                  ? payment["date_approved"]
                  : new Date().toISOString(),
              p_amount_cents: Math.round(amountNumber * 100),
            });
            if (applied.error) throw applied.error;
          }
        }
        await db.from("commercial_reconciliation_log").insert({
          run_id: runId,
          subscription_id: sub.id,
          outcome: `subscription_${String(remote.status ?? "unknown")}`,
          actor_user_id: context.userId,
        });
      } catch (e) {
        await db.from("commercial_reconciliation_log").insert({
          run_id: runId,
          subscription_id: sub.id,
          outcome: "failed",
          detail: e instanceof Error ? e.message.slice(0, 500) : "unknown",
          actor_user_id: context.userId,
        });
      }
    }
    return {
      runId,
      checkedOrders: orders.data?.length ?? 0,
      checkedSubscriptions: subs.data?.length ?? 0,
      processed: outcomes.length,
    };
  });

export const requestPlanChangeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const member = await ownerAccount(db, context.userId);
    const [sub, plan] = await Promise.all([
      db
        .from("account_subscriptions")
        .select("*")
        .eq("account_id", member.account_id)
        .eq("status", "active")
        .single(),
      db.from("commercial_plans").select("*").eq("id", data.planId).eq("status", "active").single(),
    ]);
    if (
      sub.error ||
      plan.error ||
      !sub.data ||
      !plan.data ||
      plan.data.account_type !== member.accounts.type ||
      !sub.data.current_period_end
    )
      throw new Error("Alteração incompatível ou sem assinatura ativa.");
    const result = await db
      .from("account_subscriptions")
      .update({
        pending_plan_id: plan.data.id,
        pending_plan_version: plan.data.version,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.data.id)
      .select("id,pending_plan_id,pending_plan_version,current_period_end")
      .single();
    if (result.error) throw new Error("Não foi possível agendar a alteração.");
    await db.from("commercial_audit_log").insert({
      account_id: member.account_id,
      operation: "plan_change_scheduled",
      reason: `Efetiva no próximo ciclo (${sub.data.current_period_end})`,
      before_state: { plan_id: sub.data.plan_id },
      after_state: result.data,
    });
    return result.data;
  });

export const requestSubscriptionCancellationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const member = await ownerAccount(db, context.userId);
    const { data: sub, error } = await db
      .from("account_subscriptions")
      .select("id,external_id,status")
      .eq("account_id", member.account_id)
      .eq("status", "active")
      .single();
    if (error || !sub?.external_id) throw new Error("Assinatura ativa não encontrada.");
    const { cancelSubscription } = await import("./mercado-pago.server");
    const remote = await cancelSubscription(String(sub.external_id));
    const { error: updateError } = await db
      .from("account_subscriptions")
      .update({
        status: remote.status === "cancelled" ? "cancelled" : "cancel_requested",
        cancellation_requested_at: new Date().toISOString(),
        ...(remote.status === "cancelled" ? { cancelled_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);
    if (updateError)
      throw new Error(
        "Solicitação enviada, mas não foi possível registrar o resultado; execute reconciliação.",
      );
    await db.from("commercial_audit_log").insert({
      account_id: member.account_id,
      operation: "subscription_cancel_requested",
      after_state: { subscription_id: sub.id, provider_status: remote.status },
    });
    return { status: remote.status };
  });
