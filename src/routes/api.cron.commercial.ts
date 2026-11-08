import { verifyLatestInvoice, withCommercialCronLock } from "@/lib/commercial-cron.server";
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/cron/commercial")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["CRON_SECRET"];
        const supplied =
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          request.headers.get("x-cron-secret") ??
          "";
        if (!expected || !supplied)
          return Response.json({ error: "unauthorized" }, { status: 401 });
        const a = createHash("sha256").update(expected).digest();
        const b = createHash("sha256").update(supplied).digest();
        if (!timingSafeEqual(a, b))
          return Response.json({ error: "unauthorized" }, { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Commercial RPC is added by migration 0033; generated Supabase types predate it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const run = await withCommercialCronLock(db, async (renew, token) => {
          const overdue = await db
            .from("account_subscriptions")
            .select("id,external_id,delinquent_since,current_period_end")
            .eq("status", "past_due")
            .lte("grace_ends_at", new Date().toISOString())
            .not("external_id", "is", null)
            .limit(100);
          if (overdue.error) throw overdue.error;
          let providerChecks = 0;
          for (const sub of overdue.data ?? []) {
            try {
              const { listAuthorizedPayments, getPayment } =
                await import("@/lib/mercado-pago.server");
              await renew();
              const cleared = await db.rpc("write_locked_commercial_verification", {
                p_token: token,
                p_subscription_id: sub.id,
                p_remote_status: null,
              });
              if (cleared.error) throw cleared.error;
              await renew();
              const invoices = await listAuthorizedPayments(String(sub.external_id));
              const order = await db
                .from("commercial_orders")
                .select("external_reference")
                .eq("subscription_id", sub.id)
                .eq("kind", "subscription")
                .order("created_at", { ascending: true })
                .limit(1)
                .single();
              if (order.error) throw order.error;
              const latest = await verifyLatestInvoice({
                invoices,
                delinquentSince: sub.delinquent_since,
                billingCycleStart: sub.current_period_end,
                externalReference: order.data?.external_reference ?? null,
                getPayment: async (id) => {
                  await renew();
                  return getPayment(id);
                },
                applyPayment: async (args) => {
                  await renew();
                  const applied = await db.rpc("apply_locked_commercial_payment", {
                    ...args,
                    p_token: token,
                  });
                  if (applied.error) throw applied.error;
                },
              });
              if (latest !== null) {
                await renew();
                const verification = await db.rpc("write_locked_commercial_verification", {
                  p_token: token,
                  p_subscription_id: sub.id,
                  p_remote_status: latest,
                });
                if (verification.error) throw verification.error;
              }
              providerChecks++;
            } catch (error) {
              if (error instanceof Error && error.message === "commercial_cron_lock_lost")
                throw error;
              // Failed remote verification deliberately leaves no fresh clearance to suspend.
              console.error("[commercial-cron] payment verification failed", {
                subscriptionId: sub.id,
                error: error instanceof Error ? error.message : "unknown",
              });
            }
          }
          await renew();
          const { data, error } = await db.rpc("run_locked_commercial_lifecycle", {
            p_token: token,
            p_limit: 100,
          });
          if (error) {
            console.error("[commercial-cron] lifecycle failed", { code: error.code });
            return Response.json({ error: "lifecycle_failed" }, { status: 500 });
          }
          return Response.json({ ...data, providerChecks });
        });
        if (run.busy) return Response.json({ status: "already_running" }, { status: 409 });
        return run.result;
      },
    },
  },
});
