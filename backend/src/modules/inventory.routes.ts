import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const inventoryRouter = Router();

// El negocio debe ser del usuario (el superadmin queda exento).
async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

const productoSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(150),
  sku: z.string().max(60).optional(),
  categoria: z.string().max(60).optional(),
  unidad: z.string().max(12).default("UND"),
  precioVenta: z.coerce.number().min(0),
  impuestoPct: z.coerce.number().min(0).max(100).default(0),
  costo: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().default(0),
  stockMinimo: z.coerce.number().min(0).default(0),
});

// Listar productos de un negocio.
inventoryRouter.get(
  "/",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    await assertDueno(negocioId, req.user!.sub, req.user!.rol);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const productos = await prisma.producto.findMany({
      where: {
        negocioId,
        ...(q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { nombre: "asc" },
    });
    res.json({ productos });
  }),
);

// Crear producto.
inventoryRouter.post(
  "/",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const d = productoSchema.parse(req.body);
    await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
    const producto = await prisma.producto.create({
      data: {
        negocioId: d.negocioId, nombre: d.nombre, sku: d.sku ?? null, categoria: d.categoria ?? null,
        unidad: d.unidad, precioVenta: d.precioVenta, impuestoPct: d.impuestoPct, costo: d.costo ?? null,
        stock: d.stock, stockMinimo: d.stockMinimo,
      },
    });
    // Movimiento inicial de stock si arranca con existencias.
    if (d.stock !== 0) {
      await prisma.movimientoStock.create({ data: { productoId: producto.id, tipo: "entrada", cantidad: d.stock, motivo: "Stock inicial" } });
    }
    res.status(201).json({ producto });
  }),
);

// Actualizar producto (sin tocar stock; para eso está /stock).
inventoryRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const p = await prisma.producto.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
    if (!p) throw NotFound("Producto no encontrado");
    await assertDueno(p.negocioId, req.user!.sub, req.user!.rol);
    const d = productoSchema.partial().omit({ negocioId: true, stock: true }).parse(req.body);
    const producto = await prisma.producto.update({ where: { id: req.params.id }, data: d });
    res.json({ producto });
  }),
);

// Ajustar stock (entrada / salida / ajuste absoluto) con registro en el ledger.
const stockSchema = z.object({
  tipo: z.enum(["entrada", "salida", "ajuste"]),
  cantidad: z.coerce.number(),
  motivo: z.string().max(200).optional(),
});
inventoryRouter.post(
  "/:id/stock",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const d = stockSchema.parse(req.body);
    const p = await prisma.producto.findUnique({ where: { id: req.params.id } });
    if (!p) throw NotFound("Producto no encontrado");
    await assertDueno(p.negocioId, req.user!.sub, req.user!.rol);

    const stockActual = Number(p.stock);
    let nuevoStock: number;
    let delta: number;
    if (d.tipo === "ajuste") { nuevoStock = d.cantidad; delta = d.cantidad - stockActual; }
    else if (d.tipo === "entrada") { delta = Math.abs(d.cantidad); nuevoStock = stockActual + delta; }
    else { delta = -Math.abs(d.cantidad); nuevoStock = stockActual + delta; }

    const [producto] = await prisma.$transaction([
      prisma.producto.update({ where: { id: p.id }, data: { stock: nuevoStock } }),
      prisma.movimientoStock.create({ data: { productoId: p.id, tipo: d.tipo, cantidad: delta, motivo: d.motivo ?? null } }),
    ]);
    res.json({ producto });
  }),
);
