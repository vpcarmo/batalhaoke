import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/mercado-pago/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          getPayment,
          getAuthorizedPayment,
          getSubscription,
          getChargeback,
          listPaymentRefunds,
          validateMpSignature,
        } = await import("@/lib/mercado-pago.server");
        const url = new URL(request.url);
        const body = (await request.json().catch(() => null)) as null | {
          id?: string | number;
          type?: string;
          action?: string;
          date_created?: string;
          data?: { id?: string | number; payment_id?: string | number };
        };
        const resourceId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? "");
        const eventId = String(body?.id ?? request.headers.get("x-request-id") ?? "");
        const type = String(body?.type ?? url.searchParams.get("type") ?? "");
        const valid = validateMpSignature({
          signature: request.headers.get("x-signature"),
          requestId: request.headers.get("x-request-id"),
          resourceId,
        });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const eventInsert = await db
          .from("mercado_pago_events")
          .insert({
            event_id: eventId || null,
            resource_id: resourceId || "unknown",
            topic: type,
            signature_valid: valid,
            status: valid ? "validated" : "ignored",
            payload: body
              ? {
                  id: body.id ?? null,
                  type,
                  action: body.action ?? null,
                  data: { id: resourceId },
                  date_created: body.date_created ?? null,
                }
              : null,
          })
          .select("id,attempts")
          .maybeSingle();
        let event = eventInsert.data;
        if (eventInsert.error && eventId) {
          const prior = await db
            .from("mercado_pago_events")
            .select("id,attempts")
            .eq("event_id", eventId)
            .maybeSingle();
          event = prior.data;
        }
        if (!valid) return Response.json({ error: "invalid_signature" }, { status: 401 });
        if (
          !resourceId ||
          ![
            "payment",
            "subscription_authorized_payment",
            "subscription_preapproval",
            "topic_chargebacks_wh",
            "chargebacks",
          ].includes(type)
        ) {
          if (event?.id)
            await db
              .from("mercado_pago_events")
              .update({ status: "ignored", processed_at: new Date().toISOString() })
              .eq("id", event.id);
          return Response.json({ received: true });
        }
        const resourceLockKey = `${type}:${resourceId}`;
        let currentAttempt = 1;
        try {
          await db
            .from("commercial_provider_resource_locks")
            .delete()
            .lt("acquired_at", new Date(Date.now() - 15 * 60_000).toISOString());
          const resourceLock = await db
            .from("commercial_provider_resource_locks")
            .insert({ resource_key: resourceLockKey, event_id: event?.id ?? null })
            .select("resource_key")
            .maybeSingle();
          if (resourceLock.error || !resourceLock.data)
            return Response.json({ received: true, processing: true });
          if (event?.id) {
            const claimed = await db
              .from("mercado_pago_events")
              .update({
                status: "received",
                attempts: Number(event.attempts ?? 0) + 1,
                last_attempt_at: new Date().toISOString(),
                claim_token: crypto.randomUUID(),
                claimed_at: new Date().toISOString(),
              })
              .eq("id", event.id)
              .in("status", ["received", "validated", "failed"])
              .select("id")
              .maybeSingle();
            if (!claimed.data) {
              await db
                .from("commercial_provider_resource_locks")
                .delete()
                .eq("resource_key", resourceLockKey);
              return Response.json({ received: true, duplicate: true });
            }
            currentAttempt = Number(event.attempts ?? 0) + 1;
            await db
              .from("mercado_pago_event_attempts")
              .insert({ event_id: event.id, attempt: currentAttempt, status: "processing" });
          }
          if (type === "subscription_preapproval") {
            const subscription = await getSubscription(resourceId);
            const { data: local, error: lookupError } = await db
              .from("account_subscriptions")
              .select("id,status,account_id")
              .eq("external_id", resourceId)
              .maybeSingle();
            if (lookupError) throw lookupError;
            if (local && subscription.status === "cancelled") {
              const { error } = await db
                .from("account_subscriptions")
                .update({
                  status: "cancelled",
                  cancelled_at: new Date().toISOString(),
                  payment_status: "cancelled",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", local.id);
              if (error) throw error;
              await db.from("commercial_audit_log").insert({
                account_id: local.account_id,
                operation: "provider_subscription_cancelled",
                after_state: { subscription_id: local.id, external_id: resourceId },
              });
            }
          } else if (type === "topic_chargebacks_wh" || type === "chargebacks") {
            const dispute = await getChargeback(resourceId);
            const paymentId = String(dispute["payment_id"] ?? body?.data?.payment_id ?? "");
            if (!paymentId) throw new Error("unmapped_chargeback");
            const payment = await getPayment(paymentId);
            const status = String(dispute.status ?? "");
            if (
              ["charged_back", "refunded"].includes(String(payment.status)) ||
              ["charged_back", "refunded"].includes(status)
            ) {
              const amount = Number(
                dispute["amount"] ?? dispute["transaction_amount"] ?? payment["transaction_amount"],
              );
              if (!Number.isFinite(amount)) throw new Error("invalid_chargeback_amount");
              const { error } = await db.rpc("apply_commercial_reversal", {
                p_payment_id: paymentId,
                p_adjustment_id: resourceId,
                p_kind: "chargeback",
                p_amount_cents: Math.round(amount * 100),
                p_currency: String(payment["currency_id"] ?? "BRL"),
                p_status: status || String(payment.status),
              });
              if (error) throw error;
            }
          } else {
            const invoice =
              type === "subscription_authorized_payment"
                ? await getAuthorizedPayment(resourceId)
                : null;
            const payment = invoice
              ? (invoice["payment"] as Record<string, unknown> | undefined)
              : await getPayment(resourceId);
            const reference = invoice?.["external_reference"] ?? payment?.["external_reference"];
            const paymentId = payment?.["id"] ?? invoice?.["id"] ?? resourceId;
            const status = payment?.["status"] ?? invoice?.["summarized"];
            const amount = payment?.["transaction_amount"] ?? invoice?.["transaction_amount"];
            const amountValue =
              typeof amount === "number"
                ? amount
                : typeof amount === "string"
                  ? Number(amount)
                  : Number.NaN;
            if (
              typeof reference !== "string" ||
              typeof status !== "string" ||
              !Number.isFinite(amountValue)
            )
              throw new Error("unmapped_payment");
            {
              // Partial refunds can leave the payment itself approved. Query the
              // authoritative refund collection on every payment notification.
              const refunds = await listPaymentRefunds(String(paymentId));
              for (const refund of refunds) {
                const refundId = String(refund.id ?? "");
                const amount = Number(refund["amount"]);
                if (!refundId || !Number.isFinite(amount) || String(refund.status) !== "approved")
                  continue;
                const result = await db.rpc("apply_commercial_reversal", {
                  p_payment_id: String(paymentId),
                  p_adjustment_id: refundId,
                  p_kind: "refund",
                  p_amount_cents: Math.round(amount * 100),
                  p_currency: String(payment?.["currency_id"] ?? "BRL"),
                  p_status: "approved",
                });
                if (result.error) throw result.error;
              }
            }
            const { error } = await db.rpc("apply_commercial_payment", {
              p_external_reference: reference,
              p_payment_id: String(paymentId),
              p_status: status,
              p_paid_at:
                typeof payment?.["date_approved"] === "string"
                  ? payment["date_approved"]
                  : new Date().toISOString(),
              p_amount_cents: Math.round(amountValue * 100),
            });
            if (error) throw error;
          }
          let accountId: string | null = null;
          if (type === "subscription_preapproval") {
            const found = await db
              .from("account_subscriptions")
              .select("account_id")
              .eq("external_id", resourceId)
              .maybeSingle();
            accountId = found.data?.account_id ?? null;
          } else {
            const paymentReference =
              type === "topic_chargebacks_wh" || type === "chargebacks"
                ? String(body?.data?.payment_id ?? "")
                : resourceId;
            if (paymentReference) {
              const order = await db
                .from("commercial_orders")
                .select("account_id")
                .eq("external_payment_id", paymentReference)
                .maybeSingle();
              accountId = order.data?.account_id ?? null;
              if (!accountId) {
                const invoice = await db
                  .from("commercial_subscription_payments")
                  .select("subscription_id")
                  .eq("provider_payment_id", paymentReference)
                  .maybeSingle();
                if (invoice.data?.subscription_id) {
                  const subscription = await db
                    .from("account_subscriptions")
                    .select("account_id")
                    .eq("id", invoice.data.subscription_id)
                    .maybeSingle();
                  accountId = subscription.data?.account_id ?? null;
                }
              }
            }
          }
          if (event?.id && accountId)
            await db
              .from("mercado_pago_events")
              .update({ account_id: accountId })
              .eq("id", event.id);
          if (event?.id)
            await db
              .from("mercado_pago_events")
              .update({
                status: "processed",
                processed_at: new Date().toISOString(),
                claim_token: null,
                claimed_at: null,
                last_error: null,
              })
              .eq("id", event.id);
          if (event?.id)
            await db
              .from("mercado_pago_event_attempts")
              .update({
                status: "processed",
                result: { outcome: "authoritative_resource_applied" },
              })
              .eq("event_id", event.id)
              .eq("attempt", currentAttempt);
          await db
            .from("commercial_provider_resource_locks")
            .delete()
            .eq("resource_key", resourceLockKey);
          return Response.json({ received: true });
        } catch (error) {
          console.error("[mercado-pago-webhook] processing failed", {
            eventId,
            type,
            resourceId,
            error: error instanceof Error ? error.message : "unknown",
          });
          if (event?.id)
            await db
              .from("mercado_pago_events")
              .update({
                status: "failed",
                attempts: 1,
                last_attempt_at: new Date().toISOString(),
                claim_token: null,
                claimed_at: null,
                processing_error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
                last_error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
                processed_at: new Date().toISOString(),
              })
              .eq("id", event.id);
          if (event?.id)
            await db
              .from("mercado_pago_event_attempts")
              .update({
                status: "failed",
                error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
              })
              .eq("event_id", event.id)
              .eq("attempt", currentAttempt);
          await db
            .from("commercial_provider_resource_locks")
            .delete()
            .eq("resource_key", resourceLockKey);
          return Response.json({ error: "processing_failed" }, { status: 500 });
        }
      },
    },
  },
});
