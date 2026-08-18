import { env } from "../config/env.js";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

// Abstracción de la pasarela de pagos. Permite intercambiar mock <-> Stripe sin tocar la lógica de reservas.

export interface IntentoPago {
  transaccionId: string;
  clientSecret: string; // dato que el frontend usaría para completar el pago
  provider: string;
  montoUsd: number;
}

export interface EventoWebhook {
  transaccionId: string;
  pagado: boolean;
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
  /** Verifica un webhook entrante y devuelve el id de transacción pagado, o null si es inválido. */
  verificarWebhook(rawBody: string, signature: string | undefined): EventoWebhook | null;
  /** Reembolsa un pago de fianza. */
  reembolsar(transaccionId: string): Promise<Reembolso>;
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

  verificarWebhook(rawBody: string): EventoWebhook | null {
    try {
      const payload = JSON.parse(rawBody) as { transaccionId?: string; pagado?: boolean };
      if (!payload.transaccionId) return null;
      return { transaccionId: payload.transaccionId, pagado: payload.pagado !== false };
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
    this.stripe = new Stripe(env.stripeSecretKey, { apiVersion: "2025-01-27.acacia" as any });
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
    const intent = await this.stripe.paymentIntents.create(intentData);
    return {
      transaccionId: intent.id,
      clientSecret: intent.client_secret ?? "",
      provider: "stripe",
      montoUsd: params.montoUsd,
    };
  }

  verificarWebhook(rawBody: string, signature: string | undefined): EventoWebhook | null {
    if (!signature || !env.stripeWebhookSecret) return null;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
    } catch {
      return null; // firma inválida
    }
    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return { transaccionId: pi.id, pagado: true };
    }
    if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
      const pi = event.data.object as Stripe.PaymentIntent;
      return { transaccionId: pi.id, pagado: false };
    }
    return null;
  }

  async reembolsar(transaccionId: string): Promise<Reembolso> {
    const refund = await this.stripe.refunds.create({ payment_intent: transaccionId });
    return { reembolsoId: refund.id, ok: refund.status === "succeeded" || refund.status === "pending" };
  }
}

// --- Proveedor PAYPAL (stub) ---
// Estructura lista para conectar la API de PayPal (Orders v2). No probado sin credenciales.
class PayPalProvider implements PaymentProvider {
  async crearIntento(params: IntentoParams): Promise<IntentoPago> {
    // TODO producción: crear una Order con la API de PayPal y devolver approve link + orderId.
    const transaccionId = `pp_${randomUUID()}`;
    return {
      transaccionId,
      clientSecret: `${env.appUrl}/pago/paypal/${transaccionId}`, // approve URL simulada
      provider: "paypal",
      montoUsd: params.montoUsd,
    };
  }
  verificarWebhook(rawBody: string): EventoWebhook | null {
    try {
      const p = JSON.parse(rawBody) as { transaccionId?: string; pagado?: boolean };
      if (!p.transaccionId) return null;
      return { transaccionId: p.transaccionId, pagado: p.pagado !== false };
    } catch {
      return null;
    }
  }
  async reembolsar(transaccionId: string): Promise<Reembolso> {
    // TODO producción: llamar a /v2/payments/captures/{id}/refund.
    return { reembolsoId: `pp_refund_${transaccionId}`, ok: true };
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
    ? new Stripe(env.stripeSecretKey, { apiVersion: "2025-01-27.acacia" as any })
    : null;
