import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  latestInvoice,
  verifyLatestInvoice,
  withCommercialCronLock,
} from "./commercial-cron.server";
import { commercialPlaybackError, createPlaybackPermit } from "./commercial-playback";
import { requireCommercialPlayback } from "./commercial-playback.server";
import type { SupabaseClient } from "@supabase/supabase-js";

const invoice = (id: string, date: string) => ({ payment: { id }, date_created: date });
const current = invoice("new", "2026-11-08T12:00:00Z");
const previous = invoice("old", "2026-10-08T12:00:00Z");
function fixture(status = "approved") {
  return {
    invoices: [current, previous],
    delinquentSince: "2026-11-08T00:00:00Z",
    billingCycleStart: "2026-11-08T00:00:00Z",
    externalReference: "order-1",
    getPayment: vi.fn(async (id: string) => ({
      id,
      status: id === "new" ? status : "approved",
      date_approved: "2026-11-08T12:10:00Z",
      transaction_amount: 50,
    })),
    applyPayment: vi.fn(async () => {}),
  };
}

describe("commercial cron invoice regressions", () => {
  it.each(["rejected", "pending"])("keeps latest %s despite older approval", async (status) => {
    const input = fixture(status);
    expect(await verifyLatestInvoice(input)).toBe(status);
    expect(input.getPayment).toHaveBeenCalledExactlyOnceWith("new");
    expect(input.applyPayment).not.toHaveBeenCalled();
  });
  it("selects by provider dates even when the response order changes", () => {
    expect(latestInvoice([previous, current])).toBe(current);
    expect(
      latestInvoice([{ ...previous, debit_date: "2026-12-01T00:00:00Z" }, current]),
    ).toMatchObject(previous);
  });
  it("applies the latest approved payment through the existing idempotent RPC arguments", async () => {
    const input = fixture();
    expect(await verifyLatestInvoice(input)).toBe("approved");
    expect(input.applyPayment).toHaveBeenCalledWith({
      p_external_reference: "order-1",
      p_payment_id: "new",
      p_status: "approved",
      p_paid_at: "2026-11-08T12:10:00Z",
      p_amount_cents: 5000,
    });
  });
  it("does not invent a state for an empty list", async () => {
    const input = { ...fixture(), invoices: [] };
    expect(await verifyLatestInvoice(input)).toBeNull();
    expect(input.getPayment).not.toHaveBeenCalled();
    expect(input.applyPayment).not.toHaveBeenCalled();
  });
  it("repeated approvals retain the same payment idempotency identity", async () => {
    const input = fixture();
    await verifyLatestInvoice(input);
    await verifyLatestInvoice(input);
    expect(input.applyPayment.mock.calls[0]).toEqual(input.applyPayment.mock.calls[1]);
    const sql = readFileSync("drizzle/migrations/0032_commercial_lifecycle.sql", "utf8");
    expect(sql).toContain("IF s.last_payment_id=p_payment_id THEN RETURN; END IF;");
    expect(sql).toContain("ON CONFLICT(provider_payment_id)");
  });
  it("never clears current delinquency from an approved previous cycle", async () => {
    const input = { ...fixture(), invoices: [previous] };
    input.getPayment.mockResolvedValueOnce({
      id: "old",
      status: "approved",
      date_approved: "2026-10-08T12:10:00Z",
      transaction_amount: 50,
    });
    expect(await verifyLatestInvoice(input)).toBeNull();
    expect(input.applyPayment).not.toHaveBeenCalled();
  });
  it("does not clear the current cycle when a historical invoice is approved late", async () => {
    const input = { ...fixture(), invoices: [previous] };
    expect(await verifyLatestInvoice(input)).toBeNull();
    expect(input.applyPayment).not.toHaveBeenCalled();
  });
  it("accepts a current-cycle approval even if delinquency was recorded later", async () => {
    const input = { ...fixture(), delinquentSince: "2026-11-08T14:00:00Z" };
    expect(await verifyLatestInvoice(input)).toBe("approved");
    expect(input.applyPayment).toHaveBeenCalledTimes(1);
  });
  it("propagates provider and payment application errors", async () => {
    const input = fixture();
    input.getPayment.mockRejectedValueOnce(new Error("provider_unavailable"));
    await expect(verifyLatestInvoice(input)).rejects.toThrow("provider_unavailable");
    input.applyPayment.mockRejectedValueOnce(new Error("rpc_failed"));
    await expect(verifyLatestInvoice(input)).rejects.toThrow("rpc_failed");
  });
  it("rejects missing dates, payment ids, status and amount instead of fabricating them", async () => {
    expect(() => latestInvoice([{}])).toThrow("invoice_date_missing");
    expect(() => latestInvoice([current, current])).toThrow("invoice_date_ambiguous");
    await expect(
      verifyLatestInvoice({ ...fixture(), invoices: [{ ...current, payment: undefined }] }),
    ).rejects.toThrow("invoice_payment_missing");
    const input = fixture();
    input.getPayment.mockResolvedValueOnce({
      id: "new",
      status: "",
      date_approved: "",
      transaction_amount: 0,
    });
    await expect(verifyLatestInvoice(input)).rejects.toThrow("payment_status_missing");
    input.getPayment.mockResolvedValueOnce({
      id: "new",
      status: "approved",
      date_approved: "2026-11-08T12:10:00Z",
      transaction_amount: NaN,
    });
    await expect(verifyLatestInvoice(input)).rejects.toThrow("approved_payment_unmapped");
  });
});

describe("distributed cron ownership (mock RPC, not PostgreSQL concurrency)", () => {
  it("a busy lock runs no work or provider requests", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const work = vi.fn();
    expect(await withCommercialCronLock({ rpc }, work)).toEqual({ busy: true });
    expect(work).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("releases in finally with the acquiring token on failure", async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: true,
      error: null,
    }));
    await expect(
      withCommercialCronLock({ rpc }, async (renew) => {
        await renew();
        throw new Error("worker_failed");
      }),
    ).rejects.toThrow("worker_failed");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "acquire_commercial_cron_lock",
      "renew_commercial_cron_lock",
      "release_commercial_cron_lock",
    ]);
    expect(rpc.mock.calls[0]?.[1]).toEqual(rpc.mock.calls[2]?.[1]);
  });
  it("stops on expired ownership and still attempts token-scoped release", async () => {
    const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: true,
      error: null,
    }));
    rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    await expect(withCommercialCronLock({ rpc }, async (renew) => renew())).rejects.toThrow(
      "commercial_cron_lock_lost",
    );
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});

describe("commercial playback authorization", () => {
  afterEach(() => vi.useRealTimers());
  it("trusts only an explicit server boolean and fails closed for unavailable authorization", async () => {
    const rpc = vi.fn(async () => ({
      data: true as unknown,
      error: null as null | { message: string },
    }));
    const db = { rpc } as unknown as SupabaseClient;
    expect(await requireCommercialPlayback(db, "performance")).toBe(true);
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await requireCommercialPlayback(db, "performance")).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(requireCommercialPlayback(db, "performance")).rejects.toThrow(
      "Reprodução bloqueada",
    );
    rpc.mockResolvedValueOnce({ data: false, error: { message: "commercial_quota_exhausted" } });
    await expect(requireCommercialPlayback(db, "performance")).rejects.toThrow("Cota esgotada");
  });
  it("blocks quota errors with an actionable operator message", () => {
    expect(commercialPlaybackError(new Error("commercial_quota_exhausted"))).toMatch(
      /Cota esgotada.*créditos/,
    );
    expect(commercialPlaybackError(new Error("network"))).toContain("Reprodução bloqueada");
    expect(commercialPlaybackError({ message: "commercial_quota_exhausted" })).toContain(
      "Cota esgotada",
    );
    expect(
      commercialPlaybackError(
        new Error(commercialPlaybackError({ message: "commercial_quota_exhausted" })),
      ),
    ).toContain("Cota esgotada");
  });
  it("does not revive failed authorization when a late acquisition resolves", () => {
    vi.useFakeTimers();
    const blocked = vi.fn();
    const permit = createPlaybackPermit(blocked);
    permit.revoke(new Error("commercial_quota_exhausted"));
    expect(permit.confirm()).toBe(false);
    expect(blocked).toHaveBeenCalledTimes(1);
  });
  it("stops on loss of confirmation before the 15-second server lease expires", () => {
    vi.useFakeTimers();
    const blocked = vi.fn();
    const permit = createPlaybackPermit(blocked);
    expect(permit.confirm()).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(permit.confirm()).toBe(true);
    vi.advanceTimersByTime(12_000);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(permit.confirm()).toBe(false);
  });
  it("does not extend a lease by the duration of a delayed network response", () => {
    vi.useFakeTimers();
    const blocked = vi.fn();
    const permit = createPlaybackPermit(blocked);
    expect(permit.confirm(0)).toBe(false);
    expect(blocked).toHaveBeenCalledTimes(1);
  });
  it("keeps explicitly unmetered playback independent of heartbeat failures", () => {
    vi.useFakeTimers();
    const blocked = vi.fn();
    const permit = createPlaybackPermit(blocked);
    permit.unmetered();
    vi.advanceTimersByTime(60_000);
    expect(blocked).not.toHaveBeenCalled();
    permit.close();
    expect(permit.confirm()).toBe(false);
  });
});

describe("0034 SQL contracts (static checks only)", () => {
  const sql = readFileSync("drizzle/migrations/0034_commercial_audit_fixes.sql", "utf8");
  it("uses paired valid dollar quotes for every PL/pgSQL body", () => {
    expect(sql).not.toMatch(/AS \$(?!\$)|END \$;/);
    expect(sql.match(/AS \$\$/g)?.length).toBe(sql.match(/END \$\$;/g)?.length);
    expect(sql.trim()).toMatch(/^--[^\n]*\nBEGIN;[\s\S]*COMMIT;$/);
  });
  it("keeps an account mutex and override > subscription > valid trial precedence", () => {
    const venue = sql.slice(
      sql.indexOf("public.enforce_commercial_venue_limit()"),
      sql.indexOf("public.confirm_commercial_execution()"),
    );
    expect(venue).toContain("WHERE id=NEW.account_id FOR UPDATE");
    expect(venue).toContain("IF v_limit IS NULL THEN");
    expect(venue).toContain("IF v_plan IS NOT NULL THEN");
    expect(venue).toContain("status='active' AND starts_at<=now() AND ends_at>now()");
    expect(sql).toContain("DEFAULT 1 CHECK(trial_venue_limit>=1)");
  });
  it("reserves atomically on activation and checks authorization server-side", () => {
    expect(sql).toContain("AFTER INSERT OR UPDATE OF status ON public.performances");
    expect(sql).toContain("PERFORM public.authorize_commercial_playback(NEW.id)");
    expect(sql).toContain("source<>'unmetered'");
    expect(sql).toContain("IF v_global=false OR v_account IS NULL THEN RETURN false");
  });
  it("allocates purchase/grant lots FIFO, excludes refunds and expired lots, and rolls back unavailable lots", () => {
    expect(sql).toContain("p.entry_type IN ('purchase','grant') AND p.quantity>0");
    expect(sql).toContain("ORDER BY p.created_at,p.id LIMIT 1 FOR UPDATE");
    expect(sql).toContain("p.expires_at>now()");
    expect(sql).toContain("ref.entry_type='refund'");
    expect(sql).toContain("commercial_credit_lot_unavailable");
    expect(sql).toContain("NEW.performance_id::text,v_lot.expires_at");
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM) public.credit_wallet_ledger/);
    expect(sql).toContain("IF r.status='consumed' THEN RETURN NEW");
  });
  it("protects expiring locks and lifecycle fencing with RLS and service-only grants", () => {
    expect(sql).toContain("commercial_cron_lock ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("public.commercial_cron_lock.expires_at<=clock_timestamp()");
    expect(sql).toContain(
      "DELETE FROM public.commercial_cron_lock WHERE id=true AND token=p_token",
    );
    expect(sql).toContain("token=p_token AND expires_at>clock_timestamp() FOR UPDATE");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated");
  });
  it("financial text is valid UTF-8 and free of known mojibake markers", () => {
    for (const file of ["src/routes/financeiro.tsx", "src/lib/commercial.functions.ts"]) {
      const bytes = readFileSync(file);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      expect(content).not.toMatch(/Ã|Â|â€|�/);
    }
  });
});
