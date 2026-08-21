import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const customersRouter = Router();

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

customersRouter.get("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const clientes = await prisma.clienteNegocio.findMany({
    where: { negocioId, ...(q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { telefono: { contains: q } }] } : {}) },
    orderBy: { nombre: "asc" },
  });
  res.json({ clientes });
}));

const clienteSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(120),
  telefono: z.string().max(20).optional(),
  email: z.string().email().max(150).optional().or(z.literal("")),
  direccion: z.string().max(200).optional(),
  notas: z.string().max(300).optional(),
});
customersRouter.post("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = clienteSchema.parse(req.body);
  await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
  const cliente = await prisma.clienteNegocio.create({
    data: { negocioId: d.negocioId, nombre: d.nombre, telefono: d.telefono ?? null, email: d.email || null, direccion: d.direccion ?? null, notas: d.notas ?? null },
  });
  res.status(201).json({ cliente });
}));

customersRouter.patch("/:id", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const c = await prisma.clienteNegocio.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!c) throw NotFound("Cliente no encontrado");
  await assertDueno(c.negocioId, req.user!.sub, req.user!.rol);
  const d = clienteSchema.partial().omit({ negocioId: true }).parse(req.body);
  const cliente = await prisma.clienteNegocio.update({ where: { id: req.params.id }, data: { ...d, email: d.email === "" ? null : d.email } });
  res.json({ cliente });
}));
