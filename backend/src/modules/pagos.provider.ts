import { env } from "../config/env.js";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { logger } from "../lib/logger.js";

// Abstracción de la pasarela de pagos. Permite intercambiar mock <-> Stripe <-> PayPal
// sin tocar la lógica de reservas.

export interface IntentoPago {
  transaccionId: string;
  clientSecret: string; // Stripe: client_secret. PayPal: URL de aprobación.
  provider: string;
  montoUsd: number;
  /** true si el cliente debe ser redirigido a `clientSecret` (flujo PayPal). */
  redirigir?: boolean;
}

export interface EventoWebhook {
  transaccionId: string;
  pagado: boolean;
  // Identificador único del evento en la pasarela (Stripe: evt_...). Permite
  // descartar reintentos duplicados antes de volver a confirmar la reserva.
  eventoId?: string;
  tipo?: string;
}

export interface Reembolso {
  reembolsoId: string;
  ok: boolean;
}

export interface IntentoParams {
  reservaId: number;
  montoUsd: number;
  clienteEmail: string;
  // Split (Stripe Connect): si el negocio tiene cobros activos, se enruta su parte.
  destinoConnectId?: string;
  comisionUsd?: number; // parte que retiene la plataforma
}

export interface PaymentProvider {
  /** Crea el intento de cobro de la fianza. No confirma la cita todavía. */
  crearIntento(params: IntentoParams): Promise<IntentoPago>;
  /** Verifica un webhook entrante; devuelve el evento normalizado o null si es inválido. */
  verificarWebhook(
    rawBody: string,
    signature: string | undefined,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<EventoWebhook | null>;
  /** Reembolsa un pago de fianza. */
  reembolsar(transaccionId: string): Promise<Reembolso>;
  /** Captura un pago previamente aprobado por el cliente (solo flujos con redirección). */
  capturar?(transaccionId: string): Promise<{ pagado: boolean }>;
}

// --- Proveedor MOCK: para desarrollo/pruebas sin claves reales ---
class MockProvider implements PaymentProvider {
  async crearIntento(params: IntentoParams): Promise<IntentoPago> {
    const transaccionId = `mock_${randomUUID()}`;
    return {
      transaccionId,
      clientSecret: `secret_${transaccionId}`,
      provider: "mock",
      montoUsd: params.montoUsd,
    };
  }

  async verificarWebhook(rawBody: string): Promise<EventoWebhook | null> {
    try {
      const payload = JSON.parse(rawBody) as {
        transaccionId?: string;
        pagado?: boolean;
        eventoId?: string;
      };
      if (!payload.transaccionId) return null;
      return {
        transaccionId: payload.transaccionId,
        pagado: payload.pagado !== false,
        eventoId: payload.eventoId,
        tipo: "mock.pago",
      };
    } catch {
      return null;
    }
  }

  async reembolsar(transaccionId: string): Promise<Reembolso> {
    return { reembolsoId: `refund_${transaccionId}`, ok: true };
  }
}

// --- Proveedor STRIPE real ---
class StripeProvider implements PaymentProvider {
  private stripe: Stripe;
  constructor() {
    this.stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2025-01-27.acacia" as never });
  }

  async crearIntento(params: IntentoParams): Promise<IntentoPago> {
    const intentData: Stripe.PaymentIntentCreateParams = {
      amount: Math.round(params.montoUsd * 100), // en centavos
      currency: "usd",
      metadata: { reservaId: String(params.reservaId) },
      receipt_email: params.clienteEmail,
      automatic_payment_methods: { enabled: true },
    };
    // Split: destination charge — el resto va a la cuenta conectada del negocio,
    // la plataforma retiene application_fee_amount (comisión).
    if (params.destinoConnectId) {
      intentData.transfer_data = { destination: params.destinoConnectId };
      intentData.application_fee_amount = Math.round((params.comisionUsd ?? 0) * 100);
    }
    const intent = await this.stripe.paymentIntents.create(intentData, {
      // Si la petición se reintenta, Stripe no crea un segundo cobro.
      idempotencyKey: `reserva_${params.reservaId}`,
    });
    return {
      transaccionId: intent.id,
      clientSecret: intent.client_secret ?? "",
      provider: "stripe",
      montoUsd: params.montoUsd,
    };
  }

  async verificarWebhook(
    rawBody: string,
    signature: string | undefined,
  ): Promise<EventoWebhook | null> {
    if (!signature || !env.stripeWebhookSecretPagos) return null;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecretPagos);
    } catch {
      return null; // firma inválida
    }
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return { transaccionId: pi.id, pagado: true, eventoId: event.id, tipo: event.type };
    }
    if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return { transaccionId: pi.id, pagado: false, eventoId: event.id, tipo: event.type };
    }
    return null;
  }

  async reembolsar(transaccionId: string): Promise<Reembolso> {
    const refund = await this.stripe.refunds.create({ payment_intent: transaccionId });
    return { reembolsoId: refund.id, ok: refund.status === "succeeded" || refund.status === "pending" };
  }
}

// --- Proveedor PAYPAL (Orders v2) ---
// Flujo: crearIntento() crea la orden y devuelve el enlace de aprobación; el cliente
// aprueba en PayPal y vuelve a la app, que llama a /reservas/:id/capturar para cobrar.
// El webhook PAYMENT.CAPTURE.COMPLETED confirma de forma asíncrona (fuente de verdad).
//
// Limitación conocida: PayPal no tiene equivalente al "destination charge" de Stripe
// Connect, así que el reparto de la fianza con el negocio no se enruta automáticamente
// (el cobro entra íntegro en la cuenta de la plataforma y se liquida aparte).
// Exportada para poder probarla con la API de PayPal simulada: sin credenciales
// de sandbox es la única forma de ejercitar oauth, crear, capturar, reembolsar y
// la verificación de firma de principio a fin.
export class PayPalProvider implements PaymentProvider {
  private base: string;
  private token: { valor: string; expira: number } | null = null;

  constructor() {
    this.base =
      env.paypalMode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expira > Date.now() + 30_000) return this.token.valor;
    if (!env.paypalClientId || !env.paypalSecret) {
      throw new Error("PayPal sin credenciales: define PAYPAL_CLIENT_ID y PAYPAL_SECRET");
    }
    const auth = Buffer.from(`${env.paypalClientId}:${env.paypalSecret}`).toString("base64");
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`PayPal oauth ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { valor: data.access_token, expira: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  private async api<T>(ruta: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${ruta}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string>),
      },
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(`PayPal ${ruta} -> ${res.status}: ${texto}`);
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  async crearIntento(params: IntentoParams): Promise<IntentoPago> {
    const orden = await this.api<{
      id: string;
      links: { href: string; rel: string }[];
    }>("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": `reserva-${params.reservaId}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: String(params.reservaId),
            description: "Fianza de reserva - Turno",
            amount: { currency_code: "USD", value: params.montoUsd.toFixed(2) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              return_url: `${env.appUrl}/pago/paypal/${params.reservaId}`,
              cancel_url: `${env.appUrl}/?pago=cancelado`,
            },
          },
        },
      }),
    });

    const approve = orden.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
    return {
      transaccionId: orden.id,
      clientSecret: approve?.href ?? "",
      provider: "paypal",
      montoUsd: params.montoUsd,
      redirigir: true,
    };
  }

  /** Captura la orden aprobada por el cliente. */
  async capturar(transaccionId: string): Promise<{ pagado: boolean }> {
    const res = await this.api<{ status: string }>(
      `/v2/checkout/orders/${transaccionId}/capture`,
      { method: "POST", body: "{}" },
    );
    return { pagado: res.status === "COMPLETED" };
  }

  async verificarWebhook(
    rawBody: string,
    _signature: string | undefined,
    headers?: Record<string, string | string[] | undefined>,
  ): Promise<EventoWebhook | null> {
    if (!env.paypalWebhookId || !headers) return null;
    const h = (n: string) => String(headers[n] ?? headers[n.toLowerCase()] ?? "");
    let evento: {
      id?: string;
      event_type?: string;
      resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
    };
    try {
      evento = JSON.parse(rawBody);
    } catch {
      return null;
    }

    // PayPal valida la firma en su propia API (no hay HMAC local).
    try {
      const v = await this.api<{ verification_status: string }>(
        "/v1/notifications/verify-webhook-signature",
        {
          method: "POST",
          body: JSON.stringify({
            auth_algo: h("paypal-auth-algo"),
            cert_url: h("paypal-cert-url"),
            transmission_id: h("paypal-transmission-id"),
            transmission_sig: h("paypal-transmission-sig"),
            transmission_time: h("paypal-transmission-time"),
            webhook_id: env.paypalWebhookId,
            webhook_event: evento,
          }),
        },
      );
      if (v.verification_status !== "SUCCESS") return null;
    } catch (e) {
      logger.warn({ err: e }, "no se pudo verificar el webhook de PayPal");
      return null;
    }

    // El id de la orden es el que guardamos como idTransaccionPasarela.
    const ordenId = evento.resource?.supplementary_data?.related_ids?.order_id ?? evento.resource?.id;
    if (!ordenId) return null;

    const exito = evento.event_type === "PAYMENT.CAPTURE.COMPLETED";
    const fallo =
      evento.event_type === "PAYMENT.CAPTURE.DENIED" ||
      evento.event_type === "PAYMENT.CAPTURE.REVERSED" ||
      evento.event_type === "CHECKOUT.ORDER.VOIDED";
    if (!exito && !fallo) return null;

    return {
      transaccionId: ordenId,
      pagado: exito,
      eventoId: evento.id,
      tipo: evento.event_type,
    };
  }

  async reembolsar(transaccionId: string): Promise<Reembolso> {
    // De la orden hay que llegar a la captura: el reembolso se hace sobre ella.
    const orden = await this.api<{
      purchase_units?: { payments?: { captures?: { id: string }[] } }[];
    }>(`/v2/checkout/orders/${transaccionId}`);
    const capturaId = orden.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!capturaId) return { reembolsoId: "", ok: false };

    const refund = await this.api<{ id: string; status: string }>(
      `/v2/payments/captures/${capturaId}/refund`,
      { method: "POST", body: "{}" },
    );
    return {
      reembolsoId: refund.id,
      ok: refund.status === "COMPLETED" || refund.status === "PENDING",
    };
  }
}

export const paymentProvider: PaymentProvider =
  env.paymentProvider === "stripe"
    ? new StripeProvider()
    : env.paymentProvider === "paypal"
      ? new PayPalProvider()
      : new MockProvider();

// Cliente Stripe expuesto para el módulo de suscripciones SaaS (solo si está configurado).
export const stripeClient: Stripe | null =
  env.paymentProvider === "stripe" && env.stripeSecretKey
    ? new Stripe(env.stripeSecretKey, { apiVersion: "2025-01-27.acacia" as never })
    : null;
