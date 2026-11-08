import { createHmac, timingSafeEqual } from "node:crypto";

const apiBase = "https://api.mercadopago.com";
export type MpMode = "sandbox" | "production";
export type MpResource = Record<string, unknown> & { id?: string | number; status?: string };

function config() {
  const token = process.env["MERCADO_PAGO_ACCESS_TOKEN"];
  if (!token) throw new Error("Mercado Pago não configurado.");
  const configuredMode = process.env["MERCADO_PAGO_MODE"] as MpMode | undefined;
  if (configuredMode !== "sandbox" && configuredMode !== "production")
    throw new Error("MERCADO_PAGO_MODE deve be sandbox or production.");
  if (
    (configuredMode === "sandbox" && !token.startsWith("TEST-")) ||
    (configuredMode === "production" && !token.startsWith("APP_USR-"))
  )
    throw new Error("Credential does not match Mercado Pago mode.");
  return {
    token,
    mode: configuredMode,
  };
}

async function request<T extends MpResource>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = config();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[mercado-pago] request failed", { path, status: response.status });
    throw new Error(`Mercado Pago indisponível (${response.status}).`);
  }
  return (await response.json()) as T;
}

export function mercadoPagoMode(): MpMode {
  return config().mode;
}

export async function createCreditCheckout(input: {
  orderId: string;
  title: string;
  amountCents: number;
  externalReference: string;
  payerEmail?: string;
  notificationUrl: string;
  backUrl: string;
}) {
  if (input.amountCents <= 0) throw new Error("Preço do pacote inválido.");
  return request<MpResource>("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          id: input.orderId,
          title: input.title,
          quantity: 1,
          currency_id: "BRL",
          unit_price: input.amountCents / 100,
        },
      ],
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
      auto_return: "approved",
      ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
    }),
  });
}

export async function createRecurringSubscription(input: {
  reason: string;
  amountCents: number;
  externalReference: string;
  payerEmail: string;
  backUrl: string;
}) {
  if (input.amountCents <= 0) throw new Error("Preço do plano inválido.");
  return request<MpResource>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      back_url: input.backUrl,
      status: "pending",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: input.amountCents / 100,
        currency_id: "BRL",
      },
    }),
  });
}

export function validateMpSignature(input: {
  signature: string | null;
  requestId: string | null;
  resourceId: string;
  secret?: string;
}) {
  const secret = input.secret ?? process.env["MERCADO_PAGO_WEBHOOK_SECRET"];
  if (!secret || !input.signature || !input.resourceId || !input.requestId) return false;
  const fields = Object.fromEntries(
    input.signature.split(",").map((entry) => {
      const i = entry.indexOf("=");
      return i > -1 ? [entry.slice(0, i).trim(), entry.slice(i + 1).trim()] : ["", ""];
    }),
  );
  const ts = fields["ts"];
  const received = fields["v1"];
  if (!ts || !received) return false;
  const manifest = `id:${input.resourceId};request-id:${input.requestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const getPayment = (id: string) =>
  request<MpResource>(`/v1/payments/${encodeURIComponent(id)}`);
export async function findPaymentByExternalReference(reference: string) {
  const result = await request<MpResource>(
    `/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc&limit=10`,
  );
  const rows = result["results"];
  return Array.isArray(rows) ? (rows as MpResource[]) : [];
}
export const getSubscription = (id: string) =>
  request<MpResource>(`/preapproval/${encodeURIComponent(id)}`);
export const getAuthorizedPayment = (id: string) =>
  request<MpResource>(`/authorized_payments/${encodeURIComponent(id)}`);
export const getChargeback = (id: string) =>
  request<MpResource>(`/v1/chargebacks/${encodeURIComponent(id)}`);
export async function listPaymentRefunds(paymentId: string) {
  const result = await request<MpResource>(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`);
  return Array.isArray(result) ? (result as MpResource[]) : [];
}
export const getPaymentRefund = (paymentId: string, refundId: string) =>
  request<MpResource>(
    `/v1/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}`,
  );
export async function listAuthorizedPayments(preapprovalId: string) {
  const result = await request<MpResource>(
    `/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}&sort=date_created&criteria=desc&limit=100`,
  );
  const rows = result["results"];
  return Array.isArray(rows) ? (rows as MpResource[]) : [];
}
export const cancelSubscription = (id: string) =>
  request<MpResource>(`/preapproval/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
