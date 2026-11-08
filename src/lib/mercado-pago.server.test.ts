import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getAuthorizedPayment,
  getChargeback,
  getPaymentRefund,
  validateMpSignature,
} from "./mercado-pago.server";

describe("Mercado Pago webhook signature", () => {
  const secret = "test-secret";
  const resourceId = "98765";
  const requestId = "req-123";
  const ts = "1700000000";
  const manifest = `id:${resourceId};request-id:${requestId};ts:${ts};`;
  const digest = createHmac("sha256", secret).update(manifest).digest("hex");

  it("accepts a correctly signed manifest", () => {
    expect(
      validateMpSignature({ signature: `ts=${ts},v1=${digest}`, requestId, resourceId, secret }),
    ).toBe(true);
  });
  it("rejects tampered data and missing signature parts", () => {
    expect(
      validateMpSignature({
        signature: `ts=${ts},v1=${digest}`,
        requestId,
        resourceId: "other",
        secret,
      }),
    ).toBe(false);
    expect(validateMpSignature({ signature: `ts=${ts}`, requestId, resourceId, secret })).toBe(
      false,
    );
  });
  it("rejects when the secret is absent", () => {
    expect(
      validateMpSignature({
        signature: `ts=${ts},v1=${digest}`,
        requestId,
        resourceId,
        secret: "",
      }),
    ).toBe(false);
  });
  it("requires the x-request-id used by Mercado Pago's manifest", () => {
    expect(
      validateMpSignature({
        signature: `ts=${ts},v1=${digest}`,
        requestId: null,
        resourceId,
        secret,
      }),
    ).toBe(false);
  });
});

describe("Mercado Pago recurring invoice provider", () => {
  it("fetches authorized payment invoices from the subscription endpoint", async () => {
    const originalToken = process.env["MERCADO_PAGO_ACCESS_TOKEN"];
    const originalMode = process.env["MERCADO_PAGO_MODE"];
    const originalFetch = globalThis.fetch;
    process.env["MERCADO_PAGO_ACCESS_TOKEN"] = "TEST-token";
    process.env["MERCADO_PAGO_MODE"] = "sandbox";
    let called = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      called = String(input);
      return new Response(JSON.stringify({ id: 123, status: "approved" }), { status: 200 });
    }) as typeof fetch;
    try {
      await getAuthorizedPayment("123");
      expect(called).toBe("https://api.mercadopago.com/authorized_payments/123");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env["MERCADO_PAGO_ACCESS_TOKEN"];
      else process.env["MERCADO_PAGO_ACCESS_TOKEN"] = originalToken;
      if (originalMode === undefined) delete process.env["MERCADO_PAGO_MODE"];
      else process.env["MERCADO_PAGO_MODE"] = originalMode;
    }
  });
  it("uses the Checkout Pro refund and chargeback resource endpoints", async () => {
    const originalToken = process.env["MERCADO_PAGO_ACCESS_TOKEN"];
    const originalMode = process.env["MERCADO_PAGO_MODE"];
    const originalFetch = globalThis.fetch;
    process.env["MERCADO_PAGO_ACCESS_TOKEN"] = "TEST-token";
    process.env["MERCADO_PAGO_MODE"] = "sandbox";
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ id: 8, status: "approved" }), { status: 200 });
    }) as typeof fetch;
    try {
      await getPaymentRefund("123", "456");
      await getChargeback("789");
      expect(urls).toEqual([
        "https://api.mercadopago.com/v1/payments/123/refunds/456",
        "https://api.mercadopago.com/v1/chargebacks/789",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env["MERCADO_PAGO_ACCESS_TOKEN"];
      else process.env["MERCADO_PAGO_ACCESS_TOKEN"] = originalToken;
      if (originalMode === undefined) delete process.env["MERCADO_PAGO_MODE"];
      else process.env["MERCADO_PAGO_MODE"] = originalMode;
    }
  });
});
