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
        const overdue = await db
          .from("account_subscriptions")
          .select("id,external_id")
          .eq("status", "past_due")
          .lte("grace_ends_at", new Date().toISOString())
          .not("external_id", "is", null)
          .limit(100);
        let providerChecks = 0;
        for (const sub of overdue.data ?? []) {
          try {
            const { listAuthorizedPayments, getPayment } =
              await import("@/lib/mercado-pago.server");
            const invoices = await listAuthorizedPayments(String(sub.external_id));
            const order = await db
              .from("commercial_orders")
              .select("external_reference")
              .eq("subscription_id", sub.id)
              .eq("kind", "subscription")
              .order("created_at", { ascending: true })
              .limit(1)
              .single();
            let latest = "not_approved";
            for (const invoice of invoices) {
              const nested = invoice["payment"] as Record<string, unknown> | undefined;
              const paymentId = nested?.["id"] ?? invoice["id"];
              if (!paymentId) continue;
              const payment = await getPayment(String(paymentId));
              if (payment.status === "approved") {
                latest = "approved";
                const reference =
                  payment["external_reference"] ??
                  invoice["external_reference"] ??
                  order.data?.external_reference;
                const amount = Number(payment["transaction_amount"]);
                if (typeof reference !== "string" || !Number.isFinite(amount))
                  throw new Error("approved_payment_unmapped");
                const applied = await db.rpc("apply_commercial_payment", {
                  p_external_reference: reference,
                  p_payment_id: String(payment.id ?? paymentId),
                  p_status: "approved",
                  p_paid_at: String(payment["date_approved"] ?? new Date().toISOString()),
                  p_amount_cents: Math.round(amount * 100),
                });
                if (applied.error) throw applied.error;
              } else latest = String(payment.status ?? latest);
            }
            await db.from("commercial_lifecycle_verifications").upsert({
              subscription_id: sub.id,
              remote_status: latest,
              checked_at: new Date().toISOString(),
            });
            providerChecks++;
          } catch (error) {
            // Failed remote verification deliberately leaves no fresh clearance to suspend.
            console.error("[commercial-cron] payment verification failed", {
              subscriptionId: sub.id,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
        }
        const { data, error } = await db.rpc("process_commercial_lifecycle", {
          p_limit: 100,
        });
        if (error) {
          console.error("[commercial-cron] lifecycle failed", { code: error.code });
          return Response.json({ error: "lifecycle_failed" }, { status: 500 });
        }
        return Response.json({ ...data, providerChecks });
      },
    },
  },
});
