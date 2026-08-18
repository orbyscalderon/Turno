import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { stripeClient } from "./pagos.provider.js";

// Stripe Connect: el dueño del negocio conecta su cuenta para recibir su parte de la fianza.
export const connectRouter = Router();

async function assertDueno(negocioId: string, usuarioId: number) {
  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId !== usuarioId) throw Forbidden("No eres dueño de este negocio");
  return negocio;
}

// Construye el objeto de calendario de payouts para Stripe.
function scheduleFor(intervalo: string, anchor: number) {
  if (intervalo === "monthly") return { interval: "monthly" as const, monthly_anchor: anchor };
  if (intervalo === "weekly") return { interval: "weekly" as const, weekly_anchor: "monday" as const };
  return { interval: "daily" as const };
}

// ---------- Iniciar/continuar el onboarding de cobros ----------
connectRouter.post(
  "/onboard",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const { negocioId } = z.object({ negocioId: z.string().min(1) }).parse(req.body);
    const negocio = await assertDueno(negocioId, req.user!.sub);

    // --- Modo mock: simula que el negocio ya puede recibir cobros ---
    if (env.paymentProvider !== "stripe" || !stripeClient) {
      await prisma.negocio.update({
        where: { id: negocioId },
        data: { cobrosActivos: true, stripeConnectAccountId: `acct_mock_${negocioId.slice(0, 8)}` },
      });
      return res.json({ modo: "mock", onboardingUrl: null, mensaje: "Cobros activados (simulado)" });
    }

    // --- Modo Stripe: crea cuenta Express (si no existe) y el link de onboarding ---
    // Calendario de depósitos del negocio (si lo eligió) o el de la plataforma por defecto.
    const intervalo = negocio.payoutInterval ?? env.payoutInterval;
    const anchor = negocio.payoutAnchor ?? env.payoutAnchor;
    const schedule = scheduleFor(intervalo, anchor);

    let accountId = negocio.stripeConnectAccountId;
    if (!accountId) {
      const account = await stripeClient.accounts.create({
        type: "express",
        metadata: { negocioId },
        business_profile: { name: negocio.nombreComercial },
        settings: { payouts: { schedule } },
      });
      accountId = account.id;
      await prisma.negocio.update({ where: { id: negocioId }, data: { stripeConnectAccountId: accountId } });
    } else {
      // Reaplica el calendario por si cambió la configuración.
      await stripeClient.accounts.update(accountId, { settings: { payouts: { schedule } } });
    }

    const link = await stripeClient.accountLinks.create({
      account: accountId,
      refresh_url: `${env.appUrl}/?connect=refresh`,
      return_url: `${env.appUrl}/?connect=ok`,
      type: "account_onboarding",
    });
    res.json({ modo: "stripe", onboardingUrl: link.url });
  }),
);

// ---------- Cambiar el calendario de depósitos (payouts) del negocio ----------
connectRouter.post(
  "/payout-schedule",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const { negocioId, intervalo, anchor } = z
      .object({
        negocioId: z.string().min(1),
        intervalo: z.enum(["daily", "weekly", "monthly"]),
        anchor: z.coerce.number().int().min(1).max(31).default(1),
      })
      .parse(req.body);
    const negocio = await assertDueno(negocioId, req.user!.sub);

    await prisma.negocio.update({ where: { id: negocioId }, data: { payoutInterval: intervalo, payoutAnchor: anchor } });

    // Si ya está conectado a Stripe real, aplica el cambio en la cuenta.
    if (env.paymentProvider === "stripe" && stripeClient && negocio.stripeConnectAccountId) {
      try {
        await stripeClient.accounts.update(negocio.stripeConnectAccountId, {
          settings: { payouts: { schedule: scheduleFor(intervalo, anchor) } },
        });
      } catch {
        /* si falla, el cambio queda guardado y se reaplica en el próximo onboarding */
      }
    }
    res.json({ ok: true, intervalo, anchor });
  }),
);

// ---------- Estado de cobros del negocio ----------
connectRouter.get(
  "/estado/:negocioId",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocio = await assertDueno(req.params.negocioId, req.user!.sub);

    const payout = {
      intervalo: negocio.payoutInterval ?? env.payoutInterval,
      anchor: negocio.payoutAnchor ?? env.payoutAnchor,
    };

    // En Stripe real, refresca el estado consultando la cuenta.
    if (env.paymentProvider === "stripe" && stripeClient && negocio.stripeConnectAccountId) {
      try {
        const acct = await stripeClient.accounts.retrieve(negocio.stripeConnectAccountId);
        const activos = !!acct.charges_enabled;
        if (activos !== negocio.cobrosActivos) {
          await prisma.negocio.update({ where: { id: negocio.id }, data: { cobrosActivos: activos } });
        }
        return res.json({ conectado: true, cobrosActivos: activos, payout });
      } catch {
        /* si falla, devuelve el estado guardado */
      }
    }

    res.json({
      conectado: !!negocio.stripeConnectAccountId,
      cobrosActivos: negocio.cobrosActivos,
      payout,
    });
  }),
);
