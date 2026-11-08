import { randomUUID } from "node:crypto";

type Resource = Record<string, unknown>;
type RpcResult = { data: unknown; error: unknown };
export interface CronDatabase {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

/** Unknown dates cannot safely establish which billing cycle is current. */
export function latestInvoice(invoices: Resource[]): Resource | null {
  if (!invoices.length) return null;
  const dated = invoices.map((invoice) => {
    const raw = invoice["debit_date"] ?? invoice["date_created"];
    const time = typeof raw === "string" ? Date.parse(raw) : NaN;
    return { invoice, time };
  });
  if (dated.some(({ time }) => !Number.isFinite(time))) throw new Error("invoice_date_missing");
  dated.sort((a, b) => b.time - a.time);
  if (dated.length > 1 && dated[0]!.time === dated[1]!.time)
    throw new Error("invoice_date_ambiguous");
  return dated[0]!.invoice;
}

/** Only the current invoice can clear delinquency; historical approvals stay untouched. */
export async function verifyLatestInvoice(input: {
  invoices: Resource[];
  delinquentSince: string | null;
  billingCycleStart: string | null;
  externalReference: string | null;
  getPayment(id: string): Promise<Resource>;
  applyPayment(args: Record<string, unknown>): Promise<void>;
}): Promise<string | null> {
  const invoice = latestInvoice(input.invoices);
  if (!invoice) return null;
  const nested = invoice["payment"] as Resource | undefined;
  // authorized_payment.id identifies an invoice, not a /v1/payments resource.
  const paymentId = nested?.["id"];
  if (typeof paymentId !== "string" && typeof paymentId !== "number")
    throw new Error("invoice_payment_missing");
  const payment = await input.getPayment(String(paymentId));
  const status = payment["status"];
  if (typeof status !== "string" || !status) throw new Error("payment_status_missing");
  if (status !== "approved") return status;
  const paidAt = payment["date_approved"];
  const paidTime = typeof paidAt === "string" ? Date.parse(paidAt) : NaN;
  const since = input.delinquentSince ? Date.parse(input.delinquentSince) : NaN;
  const boundary = input.billingCycleStart ? Date.parse(input.billingCycleStart) : since;
  const cycle = Date.parse(String(invoice["debit_date"] ?? invoice["date_created"]));
  if (!Number.isFinite(paidTime) || !Number.isFinite(since) || !Number.isFinite(boundary))
    throw new Error("payment_cycle_unconfirmed");
  if (cycle < boundary || paidTime < boundary) return null;
  const reference =
    payment["external_reference"] ?? invoice["external_reference"] ?? input.externalReference;
  const rawAmount = payment["transaction_amount"];
  const amount =
    typeof rawAmount === "number" || typeof rawAmount === "string" ? Number(rawAmount) : NaN;
  if (typeof reference !== "string" || !reference || !Number.isFinite(amount) || amount <= 0)
    throw new Error("approved_payment_unmapped");
  await input.applyPayment({
    p_external_reference: reference,
    p_payment_id: String(payment["id"] ?? paymentId),
    p_status: "approved",
    p_paid_at: paidAt,
    p_amount_cents: Math.round(amount * 100),
  });
  return status;
}

export async function withCommercialCronLock<T>(
  db: CronDatabase,
  work: (renew: () => Promise<void>, token: string) => Promise<T>,
): Promise<{ busy: true } | { busy: false; result: T }> {
  const token = randomUUID();
  const acquired = await db.rpc("acquire_commercial_cron_lock", { p_token: token });
  if (acquired.error) throw acquired.error;
  if (acquired.data === false) return { busy: true };
  if (acquired.data !== true) throw new Error("commercial_cron_lock_unconfirmed");
  const renew = async () => {
    const result = await db.rpc("renew_commercial_cron_lock", { p_token: token });
    if (result.error || result.data !== true) throw new Error("commercial_cron_lock_lost");
  };
  try {
    return { busy: false, result: await work(renew, token) };
  } finally {
    const released = await db.rpc("release_commercial_cron_lock", { p_token: token });
    if (released.error) console.error("[commercial-cron] lock release failed", released.error);
  }
}
