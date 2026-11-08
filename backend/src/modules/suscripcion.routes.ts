import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { stripeClient } from "./pagos.provider.js";
import { LIMITES_PLAN } from "../lib/planes.js";
import { estaVigente, diasRestantes } from "../lib/suscripcion.js";
import { marcarEventoNuevo } from "../lib/webhooks.js";
import { auditar } from "../lib/audit.js";
import { logger } from "../lib/logger.js";

export const suscripcionRouter = Router();

// Catálogo de planes (anual = 10x mensual = 2 meses gratis).
export const PLANES = {
  basico: { nombre: "Básico", mensualUsd: 25, anualUsd: 250 },
  pro: { nombre: "Pro", mensualUsd: 50, anualUsd: 500 },
} as const;
type PlanId = keyof typeof PLANES;
type Intervalo = "mensual" | "anual";

async function assertDueno(negocioId: string, usuarioId: number, rol?: string) {
  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId !== usuarioId && rol !== "superadmin") {
    throw Forbidden("No eres dueño de este negocio");
  }
  return negocio;
}

// ---------- Catálogo público de planes (para mostrar precios en el panel) ----------
suscripcionRouter.get(
  "/planes",
  asyncHandler(async (_req, res) => {
    res.json({
      planes: (Object.keys(PLANES) as PlanId[]).map((id) => {
        const p = PLANES[id];
        return {
          id,
          nombre: p.nombre,
          mensualUsd: p.mensualUsd,
          anualUsd: p.anualUsd,
          anualPorMes: Number((p.anualUsd / 12).toFixed(2)),
          ahorroAnualUsd: p.mensualUsd * 12 - p.anualUsd, // 2 meses gratis
          // Límites del plan (mostrados en las tarjetas).
          maxNegocios: LIMITES_PLAN[id].negocios,
          maxPeluqueros: LIMITES_PLAN[id].peluqueros,
        };
      }),
    });
  }),
);

// ---------- Iniciar/renovar la suscripción del SaaS (plan + intervalo) ----------
const checkoutSchema = z.object({
  negocioId: z.string().min(1),
  plan: z.enum(["basico", "pro"]).default("basico"),
  intervalo: z.enum(["mensual", "anual"]).default("mensual"),
});

suscripcionRouter.post(
  "/checkout",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const { negocioId, plan, intervalo } = checkoutSchema.parse(req.body);
    const negocio = await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    // --- Modo mock: activa la suscripción sin cobrar realmente ---
    if (env.paymentProvider !== "stripe" || !stripeClient) {
      const dias = intervalo === "anual" ? 365 : 30;
      const actualizado = await prisma.negocio.update({
        where: { id: negocioId },
        data: {
          estadoSuscripcion: "activo",
          plan,
          intervaloPlan: intervalo,
          suscripcionHasta: new Date(Date.now() + dias * 24 * 60 * 60 * 1000),
        },
      });
      const precio = intervalo === "anual" ? PLANES[plan].anualUsd : PLANES[plan].mensualUsd;
      return res.json({
        modo: "mock",
        checkoutUrl: null,
        mensaje: `Plan ${PLANES[plan].nombre} ${intervalo} activado (simulado, $${precio}) por ${dias} días`,
        negocio: {
          id: actualizado.id,
          estadoSuscripcion: actualizado.estadoSuscripcion,
          plan,
          intervaloPlan: intervalo,
        },
      });
    }

    // --- Modo Stripe: Checkout Session con el price del plan+intervalo ---
    const priceId = env.stripePrices[plan as PlanId][intervalo as Intervalo];
    if (!priceId) throw BadRequest(`Falta el price de Stripe para ${plan}/${intervalo}`);

    let customerId = negocio.stripeCustomerId;
    if (!customerId) {
      const dueno = await prisma.usuario.findUnique({
        where: { id: negocio.duenoId },
        select: { email: true, nombre: true },
      });
      const customer = await stripeClient.customers.create({
        name: negocio.nombreComercial,
        // Sin email, Stripe no puede enviar recibos ni avisos de pago fallido.
        email: dueno?.email,
        metadata: { negocioId, duenoId: String(negocio.duenoId) },
      });
      customerId = customer.id;
      await prisma.negocio.update({
        where: { id: negocioId },
        data: { stripeCustomerId: customerId },
      });
    }
    // Guarda el plan elegido (se confirma como activo al pagar, vía webhook).
    await prisma.negocio.update({
      where: { id: negocioId },
      data: { plan, intervaloPlan: intervalo },
    });

    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.appUrl}/?suscripcion=ok`,
      cancel_url: `${env.appUrl}/?suscripcion=cancel`,
      client_reference_id: negocioId,
      metadata: { negocioId, plan, intervalo },
      subscription_data: { metadata: { negocioId, plan, intervalo } },
      // Impuestos (IVA y equivalentes) calculados por Stripe Tax según la
      // dirección del negocio. Hay que activarlo también en el panel de Stripe.
      // Sin esto se factura sin impuestos, que es lo que había antes.
      ...(env.stripeTaxActivo
        ? {
            automatic_tax: { enabled: true },
            // Para calcular el impuesto Stripe necesita la dirección, y para
            // facturar a empresas, su NIF/VAT (con inversión del sujeto pasivo
            // cuando corresponda).
            billing_address_collection: "required" as const,
            tax_id_collection: { enabled: true },
            customer_update: { address: "auto" as const, name: "auto" as const },
          }
        : {}),
    });

    res.json({ modo: "stripe", checkoutUrl: session.url });
  }),
);

// ---------- Portal de facturación de Stripe ----------
// Imprescindible para que el negocio pueda cambiar de plan, actualizar la tarjeta,
// descargar facturas y CANCELAR por sí mismo (Stripe lo exige para suscripciones).
suscripcionRouter.post(
  "/portal",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const { negocioId } = z.object({ negocioId: z.string().min(1) }).parse(req.body);
    const negocio = await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    if (env.paymentProvider !== "stripe" || !stripeClient) {
      return res.json({
        modo: "mock",
        portalUrl: null,
        mensaje: "El portal de facturación solo existe con Stripe configurado.",
      });
    }
    if (!negocio.stripeCustomerId) {
      throw BadRequest("Este negocio todavía no tiene una suscripción de pago", "SIN_SUSCRIPCION");
    }

    const sesion = await stripeClient.billingPortal.sessions.create({
      customer: negocio.stripeCustomerId,
      return_url: `${env.appUrl}/?suscripcion=portal`,
    });
    res.json({ modo: "stripe", portalUrl: sesion.url });
  }),
);

// ---------- Cancelar la suscripción (al final del periodo ya pagado) ----------
suscripcionRouter.post(
  "/cancelar",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const { negocioId } = z.object({ negocioId: z.string().min(1) }).parse(req.body);
    const negocio = await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    if (env.paymentProvider === "stripe" && stripeClient && negocio.stripeSubscriptionId) {
      await stripeClient.subscriptions.update(negocio.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      await auditar(req.user!.sub, "suscripcion_cancelada", `negocio=${negocioId}`);
      return res.json({
        ok: true,
        mensaje: "La suscripción no se renovará. Mantienes el servicio hasta el final del periodo.",
      });
    }

    // Modo mock: se respeta el periodo ya "pagado" y simplemente no se renueva.
    await auditar(req.user!.sub, "suscripcion_cancelada_mock", `negocio=${negocioId}`);
    res.json({
      ok: true,
      mensaje: "Suscripción marcada para no renovarse (modo simulado).",
    });
  }),
);

// ---------- Webhook de suscripciones de Stripe ----------
// Usa su PROPIO secreto: Stripe genera un whsec_ distinto por endpoint, así que
// compartir el del webhook de pagos hacía fallar la firma de uno de los dos.
suscripcionRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (!stripeClient || !env.stripeWebhookSecretSuscripcion) {
      throw BadRequest("Webhook de suscripción no configurado");
    }
    const rawBody = req.rawBody ?? "";
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature) throw BadRequest("Falta firma");

    let event;
    try {
      event = stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        env.stripeWebhookSecretSuscripcion,
      );
    } catch {
      throw BadRequest("Firma inválida", "WEBHOOK_INVALIDO");
    }

    // Idempotencia: Stripe reintenta y puede repetir el mismo evento.
    const nuevo = await marcarEventoNuevo("stripe-suscripcion", event.id, event.type);
    if (!nuevo) return res.json({ received: true, duplicado: true });

    /** Fin del periodo pagado según Stripe (fuente de verdad para la vigencia). */
    async function finDePeriodo(subscriptionId?: string | null): Promise<Date | null> {
      if (!subscriptionId || !stripeClient) return null;
      try {
        const sub = await stripeClient.subscriptions.retrieve(subscriptionId);
        const fin = (sub as unknown as { current_period_end?: number }).current_period_end;
        return fin ? new Date(fin * 1000) : null;
      } catch (e) {
        logger.warn({ err: e, subscriptionId }, "no se pudo leer la suscripción de Stripe");
        return null;
      }
    }

    const obj = event.data.object as {
      customer?: string;
      subscription?: string;
      id?: string;
      status?: string;
      current_period_end?: number;
    };
    const customerId = obj.customer;
    if (!customerId) return res.json({ received: true, ignorado: "sin customer" });

    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const subId = obj.subscription ?? null;
      const negocio = await prisma.negocio.findFirst({ where: { stripeCustomerId: customerId } });
      // La fecha la pone Stripe; el cálculo "31 días" era solo una aproximación.
      const hasta =
        (await finDePeriodo(subId)) ??
        new Date(Date.now() + (negocio?.intervaloPlan === "anual" ? 366 : 31) * 86_400_000);

      await prisma.negocio.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          estadoSuscripcion: "activo",
          suscripcionHasta: hasta,
          ...(subId ? { stripeSubscriptionId: subId } : {}),
        },
      });
      await auditar(
        null,
        "suscripcion_pagada",
        `customer=${customerId} hasta=${hasta.toISOString()}`,
      );
    } else if (event.type === "customer.subscription.updated") {
      // Sincroniza estado y fin de periodo ante cualquier cambio (plan, impago, cancelación programada).
      const estado = obj.status ?? "";
      const activo = ["active", "trialing", "past_due"].includes(estado);
      const hasta = obj.current_period_end ? new Date(obj.current_period_end * 1000) : undefined;
      await prisma.negocio.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          estadoSuscripcion: activo ? "activo" : "vencido",
          ...(hasta ? { suscripcionHasta: hasta } : {}),
          ...(obj.id ? { stripeSubscriptionId: obj.id } : {}),
        },
      });
    } else if (
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_failed"
    ) {
      await prisma.negocio.updateMany({
        where: { stripeCustomerId: customerId },
        data: { estadoSuscripcion: "vencido" },
      });
      await auditar(
        null,
        "suscripcion_vencida_stripe",
        `customer=${customerId} evento=${event.type}`,
      );
    }

    res.json({ received: true });
  }),
);

// ---------- Consultar estado de suscripción ----------
suscripcionRouter.get(
  "/estado/:negocioId",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocio = await assertDueno(req.params.negocioId, req.user!.sub, req.user!.rol);
    res.json({
      estadoSuscripcion: negocio.estadoSuscripcion,
      plan: negocio.plan,
      intervaloPlan: negocio.intervaloPlan,
      suscripcionHasta: negocio.suscripcionHasta,
      // Estado efectivo (la fecha manda sobre el enum) y cuenta atrás para el panel.
      vigente: estaVigente(negocio),
      diasRestantes: diasRestantes(negocio.suscripcionHasta),
      tienePortal: env.paymentProvider === "stripe" && !!negocio.stripeCustomerId,
    });
  }),
);
