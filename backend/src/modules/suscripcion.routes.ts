import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { stripeClient } from "./pagos.provider.js";
import { LIMITES_PLAN } from "../lib/planes.js";

export const suscripcionRouter = Router();

// Catálogo de planes (anual = 10x mensual = 2 meses gratis).
export const PLANES = {
  basico: { nombre: "Básico", mensualUsd: 25, anualUsd: 250 },
  pro: { nombre: "Pro", mensualUsd: 50, anualUsd: 500 },
} as const;
type PlanId = keyof typeof PLANES;
type Intervalo = "mensual" | "anual";

async function assertDueno(negocioId: string, usuarioId: number) {
  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId !== usuarioId) throw Forbidden("No eres dueño de este negocio");
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
    const negocio = await assertDueno(negocioId, req.user!.sub);

    // --- Modo mock: activa la suscripción sin cobrar realmente ---
    if (env.paymentProvider === "mock" || !stripeClient) {
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
        negocio: { id: actualizado.id, estadoSuscripcion: actualizado.estadoSuscripcion, plan, intervaloPlan: intervalo },
      });
    }

    // --- Modo Stripe: Checkout Session con el price del plan+intervalo ---
    const priceId = env.stripePrices[plan as PlanId][intervalo as Intervalo];
    if (!priceId) throw BadRequest(`Falta el price de Stripe para ${plan}/${intervalo}`);

    let customerId = negocio.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeClient.customers.create({
        name: negocio.nombreComercial,
        metadata: { negocioId },
      });
      customerId = customer.id;
      await prisma.negocio.update({ where: { id: negocioId }, data: { stripeCustomerId: customerId } });
    }
    // Guarda el plan elegido (se confirma como activo al pagar, vía webhook).
    await prisma.negocio.update({ where: { id: negocioId }, data: { plan, intervaloPlan: intervalo } });

    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.appUrl}/?suscripcion=ok`,
      cancel_url: `${env.appUrl}/?suscripcion=cancel`,
      metadata: { negocioId, plan, intervalo },
    });

    res.json({ modo: "stripe", checkoutUrl: session.url });
  }),
);

// ---------- Webhook de suscripciones de Stripe ----------
// invoice.paid -> activo; customer.subscription.deleted / past_due -> vencido.
suscripcionRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    if (!stripeClient || !env.stripeWebhookSecret) {
      throw BadRequest("Webhook de suscripción no configurado");
    }
    const rawBody = (req as any).rawBody as string;
    const signature = req.headers["stripe-signature"] as string | undefined;
    if (!signature) throw BadRequest("Falta firma");

    let event;
    try {
      event = stripeClient.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
    } catch {
      throw BadRequest("Firma inválida", "WEBHOOK_INVALIDO");
    }

    if (event.type === "invoice.paid") {
      const inv = event.data.object as any;
      const customerId = inv.customer as string;
      // Extiende según el intervalo del plan guardado (anual ~366 días, mensual ~31).
      const negocio = await prisma.negocio.findFirst({ where: { stripeCustomerId: customerId } });
      const dias = negocio?.intervaloPlan === "anual" ? 366 : 31;
      await prisma.negocio.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          estadoSuscripcion: "activo",
          suscripcionHasta: new Date(Date.now() + dias * 24 * 60 * 60 * 1000),
          stripeSubscriptionId: (inv.subscription as string) ?? undefined,
        },
      });
    } else if (
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.payment_failed"
    ) {
      const obj = event.data.object as any;
      const customerId = obj.customer as string;
      await prisma.negocio.updateMany({
        where: { stripeCustomerId: customerId },
        data: { estadoSuscripcion: "vencido" },
      });
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
    const negocio = await assertDueno(req.params.negocioId, req.user!.sub);
    res.json({
      estadoSuscripcion: negocio.estadoSuscripcion,
      plan: negocio.plan,
      intervaloPlan: negocio.intervaloPlan,
      suscripcionHasta: negocio.suscripcionHasta,
    });
  }),
);
