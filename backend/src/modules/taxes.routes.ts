import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const taxesRouter = Router();
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

// Reporte de impuestos (ITBIS/IVA) cobrado en las ventas de un mes.
taxesRouter.get("/reporte", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const mes = typeof req.query.mes === "string" && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : new Date().toISOString().slice(0, 7);
  const desde = new Date(`${mes}-01T00:00:00`);
  const hasta = new Date(desde); hasta.setMonth(hasta.getMonth() + 1);
  const ventas = await prisma.venta.findMany({ where: { negocioId, createdAt: { gte: desde, lt: hasta } }, select: { subtotal: true, impuesto: true, total: true } });
  const subtotal = round2(ventas.reduce((s, v) => s + Number(v.subtotal), 0));
  const impuesto = round2(ventas.reduce((s, v) => s + Number(v.impuesto), 0));
  const total = round2(ventas.reduce((s, v) => s + Number(v.total), 0));
  res.json({ mes, conteo: ventas.length, subtotal, impuesto, total });
}));
