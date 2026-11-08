import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// PayPal sin credenciales de sandbox no se puede probar contra la API real, así
// que aquí se simula la API con las respuestas que PayPal documenta (Orders v2 y
// verify-webhook-signature) y se ejercita el proveedor de punta a punta: oauth,
// crear orden, capturar, verificar webhook y reembolsar, incluidos los fallos.
//
// Esto NO sustituye una prueba en sandbox (no valida credenciales, ni permisos,
// ni el formato real de la firma), pero sí que el código hace lo que debe con
// las respuestas correctas y que no se cae con las incorrectas.

// Las credenciales se definen ANTES de importar el módulo: env se lee al cargar.
process.env.PAYPAL_CLIENT_ID = "test-client-id";
process.env.PAYPAL_SECRET = "test-secret";
process.env.PAYPAL_MODE = "sandbox";
process.env.PAYPAL_WEBHOOK_ID = "WH-TEST-123";

type Llamada = { url: string; init: RequestInit };
let llamadas: Llamada[] = [];
let respuestas: Map<string, { status: number; cuerpo: unknown }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PayPalProvider: any;

function respuestaPara(url: string) {
  for (const [patron, r] of respuestas) if (url.includes(patron)) return r;
  return { status: 404, cuerpo: { name: "RESOURCE_NOT_FOUND" } };
}

beforeAll(async () => {
  ({ PayPalProvider } = await import("../src/modules/pagos.provider.js"));

  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    llamadas.push({ url: String(url), init });
    const { status, cuerpo } = respuestaPara(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(cuerpo),
      json: async () => cuerpo,
    };
  });
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  llamadas = [];
  respuestas = new Map<string, { status: number; cuerpo: unknown }>([
    ["/v1/oauth2/token", { status: 200, cuerpo: { access_token: "A21AA-token", expires_in: 32400 } }],
  ]);
});

describe("PayPal: crear la orden", () => {
  it("manda el importe y las URLs de retorno, y devuelve el enlace de aprobación", async () => {
    respuestas.set("/v2/checkout/orders", {
      status: 201,
      cuerpo: {
        id: "5O190127TN364715T",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T", rel: "self" },
          { href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action" },
        ],
      },
    });

    const proveedor = new PayPalProvider();
    const intento = await proveedor.crearIntento({
      reservaId: 42,
      montoUsd: 2.09,
      clienteEmail: "cliente@turno.test",
    });

    expect(intento.transaccionId).toBe("5O190127TN364715T");
    expect(intento.provider).toBe("paypal");
    // Clave para el frontend: PayPal es por redirección, no por formulario.
    expect(intento.redirigir).toBe(true);
    expect(intento.clientSecret).toContain("checkoutnow");

    const orden = llamadas.find((l) => l.url.endsWith("/v2/checkout/orders"))!;
    const cuerpo = JSON.parse(String(orden.init.body));
    expect(cuerpo.intent).toBe("CAPTURE");
    // El importe va con dos decimales: "2.1" lo rechaza PayPal.
    expect(cuerpo.purchase_units[0].amount.value).toBe("2.09");
    // custom_id es lo que permite reconciliar el webhook con la reserva.
    expect(cuerpo.purchase_units[0].custom_id).toBe("42");
    expect(cuerpo.payment_source.paypal.experience_context.return_url).toContain("/pago/paypal/42");
    // Idempotencia del alta de orden.
    expect((orden.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("reserva-42");
  });

  it("apunta a la URL de sandbox, no a la de producción", async () => {
    respuestas.set("/v2/checkout/orders", { status: 201, cuerpo: { id: "X", links: [] } });
    await new PayPalProvider().crearIntento({
      reservaId: 1,
      montoUsd: 2,
      clienteEmail: "a@b.c",
    });
    expect(llamadas.every((l) => l.url.startsWith("https://api-m.sandbox.paypal.com"))).toBe(true);
  });

  it("reutiliza el access token entre llamadas", async () => {
    respuestas.set("/v2/checkout/orders", { status: 201, cuerpo: { id: "X", links: [] } });
    const proveedor = new PayPalProvider();
    await proveedor.crearIntento({ reservaId: 1, montoUsd: 2, clienteEmail: "a@b.c" });
    await proveedor.crearIntento({ reservaId: 2, montoUsd: 2, clienteEmail: "a@b.c" });
    // Un oauth, dos órdenes: si pidiera token en cada llamada, PayPal nos limitaría.
    expect(llamadas.filter((l) => l.url.includes("oauth2/token"))).toHaveLength(1);
  });

  it("falla con un mensaje útil si PayPal rechaza el oauth", async () => {
    respuestas.set("/v1/oauth2/token", { status: 401, cuerpo: { error: "invalid_client" } });
    await expect(
      new PayPalProvider().crearIntento({ reservaId: 1, montoUsd: 2, clienteEmail: "a@b.c" }),
    ).rejects.toThrow(/oauth 401/);
  });

  it("propaga el error si la creación de la orden falla", async () => {
    respuestas.set("/v2/checkout/orders", {
      status: 422,
      cuerpo: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "CURRENCY_NOT_SUPPORTED" }] },
    });
    await expect(
      new PayPalProvider().crearIntento({ reservaId: 1, montoUsd: 2, clienteEmail: "a@b.c" }),
    ).rejects.toThrow(/422/);
  });
});

describe("PayPal: capturar", () => {
  it("COMPLETED cuenta como pagado", async () => {
    respuestas.set("/capture", { status: 201, cuerpo: { id: "ORDER-1", status: "COMPLETED" } });
    const res = await new PayPalProvider().capturar("ORDER-1");
    expect(res.pagado).toBe(true);
  });

  it("cualquier otro estado NO cuenta como pagado", async () => {
    respuestas.set("/capture", { status: 201, cuerpo: { id: "ORDER-1", status: "PENDING" } });
    expect((await new PayPalProvider().capturar("ORDER-1")).pagado).toBe(false);
  });
});

describe("PayPal: webhook", () => {
  const cabeceras = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "trans-1",
    "paypal-transmission-sig": "firma-base64",
    "paypal-transmission-time": "2026-11-07T20:00:00Z",
  };

  const eventoCaptura = {
    id: "WH-EVT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAPTURE-9",
      supplementary_data: { related_ids: { order_id: "ORDER-77" } },
    },
  };

  it("con firma válida devuelve el id de la ORDEN, no el de la captura", async () => {
    respuestas.set("verify-webhook-signature", {
      status: 200,
      cuerpo: { verification_status: "SUCCESS" },
    });
    const res = await new PayPalProvider().verificarWebhook(
      JSON.stringify(eventoCaptura),
      undefined,
      cabeceras,
    );
    // idTransaccionPasarela guarda el id de la orden: si devolviera el de la
    // captura, no encontraríamos la reserva.
    expect(res).toEqual({
      transaccionId: "ORDER-77",
      pagado: true,
      eventoId: "WH-EVT-1",
      tipo: "PAYMENT.CAPTURE.COMPLETED",
    });
  });

  it("rechaza el evento si PayPal no valida la firma", async () => {
    respuestas.set("verify-webhook-signature", {
      status: 200,
      cuerpo: { verification_status: "FAILURE" },
    });
    const res = await new PayPalProvider().verificarWebhook(
      JSON.stringify(eventoCaptura),
      undefined,
      cabeceras,
    );
    expect(res).toBeNull();
  });

  it("si la API de verificación falla, no se procesa el evento", async () => {
    respuestas.set("verify-webhook-signature", { status: 500, cuerpo: { name: "INTERNAL" } });
    const res = await new PayPalProvider().verificarWebhook(
      JSON.stringify(eventoCaptura),
      undefined,
      cabeceras,
    );
    expect(res).toBeNull();
  });

  it("un pago denegado se marca como no pagado", async () => {
    respuestas.set("verify-webhook-signature", {
      status: 200,
      cuerpo: { verification_status: "SUCCESS" },
    });
    const res = await new PayPalProvider().verificarWebhook(
      JSON.stringify({ ...eventoCaptura, event_type: "PAYMENT.CAPTURE.DENIED" }),
      undefined,
      cabeceras,
    );
    expect(res?.pagado).toBe(false);
    expect(res?.tipo).toBe("PAYMENT.CAPTURE.DENIED");
  });

  it("los eventos que no nos interesan se ignoran", async () => {
    respuestas.set("verify-webhook-signature", {
      status: 200,
      cuerpo: { verification_status: "SUCCESS" },
    });
    const res = await new PayPalProvider().verificarWebhook(
      JSON.stringify({ ...eventoCaptura, event_type: "CHECKOUT.ORDER.APPROVED" }),
      undefined,
      cabeceras,
    );
    expect(res).toBeNull();
  });

  it("un cuerpo que no es JSON no rompe nada", async () => {
    const res = await new PayPalProvider().verificarWebhook("<html>error</html>", undefined, cabeceras);
    expect(res).toBeNull();
  });

  it("sin cabeceras no se verifica nada", async () => {
    const res = await new PayPalProvider().verificarWebhook(JSON.stringify(eventoCaptura), undefined);
    expect(res).toBeNull();
  });
});

describe("PayPal: reembolso", () => {
  it("busca la captura dentro de la orden y la reembolsa", async () => {
    respuestas.set("/v2/checkout/orders/ORDER-77", {
      status: 200,
      cuerpo: {
        id: "ORDER-77",
        purchase_units: [{ payments: { captures: [{ id: "CAPTURE-9", status: "COMPLETED" }] } }],
      },
    });
    respuestas.set("/v2/payments/captures/CAPTURE-9/refund", {
      status: 201,
      cuerpo: { id: "REFUND-5", status: "COMPLETED" },
    });

    const res = await new PayPalProvider().reembolsar("ORDER-77");
    expect(res).toEqual({ reembolsoId: "REFUND-5", ok: true });
    // El reembolso va contra la CAPTURA, no contra la orden.
    expect(llamadas.some((l) => l.url.includes("/payments/captures/CAPTURE-9/refund"))).toBe(true);
  });

  it("PENDING también cuenta como reembolso aceptado", async () => {
    respuestas.set("/v2/checkout/orders/ORDER-77", {
      status: 200,
      cuerpo: { purchase_units: [{ payments: { captures: [{ id: "C1" }] } }] },
    });
    respuestas.set("/refund", { status: 201, cuerpo: { id: "R1", status: "PENDING" } });
    expect((await new PayPalProvider().reembolsar("ORDER-77")).ok).toBe(true);
  });

  it("una orden sin captura no se reembolsa (no revienta)", async () => {
    respuestas.set("/v2/checkout/orders/ORDER-77", {
      status: 200,
      cuerpo: { id: "ORDER-77", purchase_units: [{}] },
    });
    expect(await new PayPalProvider().reembolsar("ORDER-77")).toEqual({
      reembolsoId: "",
      ok: false,
    });
  });
});
