import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const purchasingRouter = Router();
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

const compraSchema = z.object({
  negocioId: z.string().min(1),
  proveedor: z.string().max(120).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lineas: z.array(z.object({
    productoId: z.string().optional(),
    nombre: z.string().min(1).max(150),
    cantidad: z.coerce.number().positive(),
    costoUnit: z.coerce.number().min(0),
  })).min(1),
});

// Registra una compra y SUMA stock a los productos vinculados (entrada al ledger).
purchasingRouter.post("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = compraSchema.parse(req.body);
  await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
  const total = round2(d.lineas.reduce((s, l) => s + l.cantidad * l.costoUnit, 0));

  const compra = await prisma.$transaction(async (tx) => {
    const c = await tx.compra.create({
      data: {
        negocioId: d.negocioId, proveedor: d.proveedor ?? null, fecha: new Date(`${d.fecha}T00:00:00`), total,
        lineas: { create: d.lineas.map((l) => ({ productoId: l.productoId ?? null, nombre: l.nombre, cantidad: l.cantidad, costoUnit: l.costoUnit })) },
      },
      include: { lineas: true },
    });
    for (const l of d.lineas) {
      if (!l.productoId) continue;
      await tx.producto.update({ where: { id: l.productoId }, data: { stock: { increment: l.cantidad }, costo: l.costoUnit } });
      await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "entrada", cantidad: Math.abs(l.cantidad), motivo: `Compra ${c.id.slice(-6)}` } });
    }
    return c;
  });
  res.status(201).json({ compra });
}));

purchasingRouter.get("/", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const compras = await prisma.compra.findMany({ where: { negocioId }, include: { lineas: true }, orderBy: { fecha: "desc" }, take: 100 });
  res.json({ compras });
}));
