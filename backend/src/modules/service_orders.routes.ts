import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const serviceOrdersRouter = Router();

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

const ESTADOS = ["recibido", "diagnostico", "reparacion", "listo", "entregado", "cancelado"] as const;

const crearSchema = z.object({
  negocioId: z.string().min(1),
  clienteNombre: z.string().min(1).max(120),
  clienteTelefono: z.string().max(20).optional(),
  equipo: z.string().min(1).max(200),
  problema: z.string().max(1000).optional(),
  costoEstimado: z.coerce.number().min(0).optional(),
});

serviceOrdersRouter.get("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const ordenes = await prisma.ordenServicio.findMany({ where: { negocioId }, orderBy: { createdAt: "desc" } });
  res.json({ ordenes });
}));

serviceOrdersRouter.post("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = crearSchema.parse(req.body);
  await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
  const orden = await prisma.ordenServicio.create({
    data: {
      negocioId: d.negocioId, clienteNombre: d.clienteNombre, clienteTelefono: d.clienteTelefono ?? null,
      equipo: d.equipo, problema: d.problema ?? null, costoEstimado: d.costoEstimado ?? null,
    },
  });
  res.status(201).json({ orden });
}));

const actualizarSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  diagnostico: z.string().max(1000).optional(),
  costoEstimado: z.coerce.number().min(0).optional(),
  costoFinal: z.coerce.number().min(0).optional(),
});

serviceOrdersRouter.patch("/:id", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const o = await prisma.ordenServicio.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!o) throw NotFound("Orden no encontrada");
  await assertDueno(o.negocioId, req.user!.sub, req.user!.rol);
  const d = actualizarSchema.parse(req.body);
  const orden = await prisma.ordenServicio.update({ where: { id: req.params.id }, data: d });
  res.json({ orden });
}));
