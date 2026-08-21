import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const tablesRouter = Router();

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

async function recalcularTotal(comandaId: string) {
  const lineas = await prisma.lineaComanda.findMany({ where: { comandaId } });
  const total = round2(lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precioUnit), 0));
  await prisma.comanda.update({ where: { id: comandaId }, data: { total } });
  return total;
}

// ---------- MESAS ----------
tablesRouter.get("/mesas", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const mesas = await prisma.mesa.findMany({
    where: { negocioId },
    include: { comandas: { where: { estado: "abierta" }, include: { lineas: true } } },
    orderBy: { nombre: "asc" },
  });
  res.json({ mesas });
}));

tablesRouter.post("/mesas", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const { negocioId, nombre } = z.object({ negocioId: z.string().min(1), nombre: z.string().min(1).max(40) }).parse(req.body);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const mesa = await prisma.mesa.create({ data: { negocioId, nombre } });
  res.status(201).json({ mesa });
}));

// ---------- COMANDAS ----------
// Abre una comanda (en una mesa o para llevar) y marca la mesa como ocupada.
tablesRouter.post("/comandas", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const { negocioId, mesaId } = z.object({ negocioId: z.string().min(1), mesaId: z.string().optional() }).parse(req.body);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const comanda = await prisma.comanda.create({ data: { negocioId, mesaId: mesaId ?? null } });
  if (mesaId) await prisma.mesa.update({ where: { id: mesaId }, data: { estado: "ocupada" } });
  res.status(201).json({ comanda });
}));

tablesRouter.get("/comandas/:id", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const c = await prisma.comanda.findUnique({ where: { id: req.params.id }, include: { lineas: true, mesa: true } });
  if (!c) throw NotFound("Comanda no encontrada");
  await assertDueno(c.negocioId, req.user!.sub, req.user!.rol);
  res.json({ comanda: c });
}));

const lineaSchema = z.object({ nombre: z.string().min(1).max(150), cantidad: z.coerce.number().positive(), precioUnit: z.coerce.number().min(0), notas: z.string().max(200).optional() });
tablesRouter.post("/comandas/:id/lineas", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = lineaSchema.parse(req.body);
  const c = await prisma.comanda.findUnique({ where: { id: req.params.id }, select: { negocioId: true, estado: true } });
  if (!c) throw NotFound("Comanda no encontrada");
  await assertDueno(c.negocioId, req.user!.sub, req.user!.rol);
  if (c.estado !== "abierta") throw BadRequest("La comanda no está abierta");
  await prisma.lineaComanda.create({ data: { comandaId: req.params.id, nombre: d.nombre, cantidad: d.cantidad, precioUnit: d.precioUnit, notas: d.notas ?? null } });
  const total = await recalcularTotal(req.params.id);
  const comanda = await prisma.comanda.findUnique({ where: { id: req.params.id }, include: { lineas: true } });
  res.status(201).json({ comanda, total });
}));

tablesRouter.delete("/comandas/:id/lineas/:lineaId", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const c = await prisma.comanda.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!c) throw NotFound("Comanda no encontrada");
  await assertDueno(c.negocioId, req.user!.sub, req.user!.rol);
  await prisma.lineaComanda.deleteMany({ where: { id: req.params.lineaId, comandaId: req.params.id } });
  const total = await recalcularTotal(req.params.id);
  res.json({ ok: true, total });
}));

// Cobrar (cierra la comanda y libera la mesa).
tablesRouter.post("/comandas/:id/cobrar", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const c = await prisma.comanda.findUnique({ where: { id: req.params.id } });
  if (!c) throw NotFound("Comanda no encontrada");
  await assertDueno(c.negocioId, req.user!.sub, req.user!.rol);
  if (c.estado !== "abierta") throw BadRequest("La comanda ya está cerrada");
  const total = await recalcularTotal(req.params.id);
  const comanda = await prisma.comanda.update({ where: { id: req.params.id }, data: { estado: "cerrada" } });
  if (c.mesaId) await prisma.mesa.update({ where: { id: c.mesaId }, data: { estado: "libre" } });
  res.json({ comanda, total });
}));
