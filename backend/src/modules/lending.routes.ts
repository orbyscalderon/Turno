import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calcularAmortizacion } from "../lib/amortizacion.js";

export const lendingRouter = Router();

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// Verifica que el negocio pertenezca al usuario (el superadmin queda exento).
async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

interface CuotaLite { monto: unknown; montoPagado: unknown; pagada: boolean; fechaVencimiento: Date }
function resumen(p: { id: string; deudorNombre: string; deudorTelefono: string | null; capital: unknown; tasaInteresMensual: unknown; plazoCuotas: number; frecuencia: string; estado: string; fechaInicio: Date; cuotas: CuotaLite[] }) {
  const impagas = p.cuotas.filter((c) => !c.pagada).sort((a, b) => a.fechaVencimiento.getTime() - b.fechaVencimiento.getTime());
  const saldoPendiente = round2(p.cuotas.reduce((s, c) => s + (Number(c.monto) - Number(c.montoPagado)), 0));
  return {
    id: p.id,
    deudorNombre: p.deudorNombre,
    deudorTelefono: p.deudorTelefono,
    capital: Number(p.capital),
    tasaInteresMensual: Number(p.tasaInteresMensual),
    plazoCuotas: p.plazoCuotas,
    frecuencia: p.frecuencia,
    estado: p.estado,
    fechaInicio: p.fechaInicio,
    totalCuotas: p.cuotas.length,
    cuotasPagadas: p.cuotas.filter((c) => c.pagada).length,
    saldoPendiente,
    proximaCuota: impagas[0]?.fechaVencimiento ?? null,
    enMora: impagas.some((c) => c.fechaVencimiento < new Date()),
  };
}

const crearSchema = z.object({
  negocioId: z.string().min(1),
  deudorNombre: z.string().min(2).max(120),
  deudorTelefono: z.string().max(20).optional(),
  capital: z.coerce.number().positive(),
  tasaInteresMensual: z.coerce.number().min(0).max(100),
  plazoCuotas: z.coerce.number().int().min(1).max(360),
  frecuencia: z.enum(["semanal", "quincenal", "mensual"]).default("mensual"),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notas: z.string().max(500).optional(),
});

// Crear préstamo + generar cronograma de cuotas.
lendingRouter.post(
  "/",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const d = crearSchema.parse(req.body);
    await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
    const inicio = new Date(`${d.fechaInicio}T00:00:00`);
    const cuotas = calcularAmortizacion({
      capital: d.capital,
      tasaInteresMensual: d.tasaInteresMensual,
      plazoCuotas: d.plazoCuotas,
      frecuencia: d.frecuencia,
      fechaInicio: inicio,
    });
    const prestamo = await prisma.prestamo.create({
      data: {
        negocioId: d.negocioId,
        deudorNombre: d.deudorNombre,
        deudorTelefono: d.deudorTelefono ?? null,
        capital: d.capital,
        tasaInteresMensual: d.tasaInteresMensual,
        plazoCuotas: d.plazoCuotas,
        frecuencia: d.frecuencia,
        fechaInicio: inicio,
        notas: d.notas ?? null,
        cuotas: {
          create: cuotas.map((c) => ({
            numero: c.numero,
            fechaVencimiento: c.fechaVencimiento,
            monto: c.monto,
            capital: c.capital,
            interes: c.interes,
          })),
        },
      },
      include: { cuotas: { orderBy: { numero: "asc" } } },
    });
    res.status(201).json({ prestamo });
  }),
);

// Listar préstamos de un negocio (con resumen).
lendingRouter.get(
  "/",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    await assertDueno(negocioId, req.user!.sub, req.user!.rol);
    const prestamos = await prisma.prestamo.findMany({
      where: { negocioId },
      include: { cuotas: { select: { monto: true, montoPagado: true, pagada: true, fechaVencimiento: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ prestamos: prestamos.map(resumen) });
  }),
);

// Detalle con todas las cuotas.
lendingRouter.get(
  "/:id",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const p = await prisma.prestamo.findUnique({
      where: { id: req.params.id },
      include: { cuotas: { orderBy: { numero: "asc" } } },
    });
    if (!p) throw NotFound("Préstamo no encontrado");
    await assertDueno(p.negocioId, req.user!.sub, req.user!.rol);
    res.json({ prestamo: p });
  }),
);

// Registrar un pago: se aplica a las cuotas pendientes más antiguas (permite parciales).
lendingRouter.post(
  "/:id/pagar",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const { monto } = z.object({ monto: z.coerce.number().positive() }).parse(req.body);
    const p = await prisma.prestamo.findUnique({
      where: { id: req.params.id },
      include: { cuotas: { orderBy: { numero: "asc" } } },
    });
    if (!p) throw NotFound("Préstamo no encontrado");
    await assertDueno(p.negocioId, req.user!.sub, req.user!.rol);
    if (p.estado !== "activo") throw BadRequest("El préstamo no está activo");

    let restante = monto;
    const ahora = new Date();
    await prisma.$transaction(async (tx) => {
      for (const c of p.cuotas) {
        if (restante <= 0) break;
        if (c.pagada) continue;
        const pendiente = Number(c.monto) - Number(c.montoPagado);
        const aplica = Math.min(restante, pendiente);
        const nuevoPagado = round2(Number(c.montoPagado) + aplica);
        const pagada = nuevoPagado >= Number(c.monto) - 0.005;
        await tx.cuotaPrestamo.update({
          where: { id: c.id },
          data: { montoPagado: nuevoPagado, pagada, fechaPago: pagada ? ahora : c.fechaPago },
        });
        restante = round2(restante - aplica);
      }
      const pendientes = await tx.cuotaPrestamo.count({ where: { prestamoId: p.id, pagada: false } });
      if (pendientes === 0) await tx.prestamo.update({ where: { id: p.id }, data: { estado: "pagado" } });
    });

    const actualizado = await prisma.prestamo.findUnique({
      where: { id: p.id },
      include: { cuotas: { orderBy: { numero: "asc" } } },
    });
    res.json({ prestamo: actualizado, excedente: round2(restante) });
  }),
);
