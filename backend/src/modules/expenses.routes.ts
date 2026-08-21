import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const expensesRouter = Router();
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

// Lista los gastos de un mes (YYYY-MM) con total.
expensesRouter.get("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const mes = typeof req.query.mes === "string" && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : new Date().toISOString().slice(0, 7);
  const desde = new Date(`${mes}-01T00:00:00`);
  const hasta = new Date(desde); hasta.setMonth(hasta.getMonth() + 1);
  const gastos = await prisma.gasto.findMany({ where: { negocioId, fecha: { gte: desde, lt: hasta } }, orderBy: { fecha: "desc" } });
  const total = round2(gastos.reduce((s, g) => s + Number(g.monto), 0));
  res.json({ gastos, total, mes });
}));

const gastoSchema = z.object({
  negocioId: z.string().min(1),
  categoria: z.string().max(60).optional(),
  descripcion: z.string().min(1).max(200),
  monto: z.coerce.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
expensesRouter.post("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = gastoSchema.parse(req.body);
  await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
  const gasto = await prisma.gasto.create({ data: { negocioId: d.negocioId, categoria: d.categoria ?? null, descripcion: d.descripcion, monto: d.monto, fecha: new Date(`${d.fecha}T00:00:00`) } });
  res.status(201).json({ gasto });
}));

expensesRouter.delete("/:id", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const g = await prisma.gasto.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!g) throw NotFound("Gasto no encontrado");
  await assertDueno(g.negocioId, req.user!.sub, req.user!.rol);
  await prisma.gasto.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));
