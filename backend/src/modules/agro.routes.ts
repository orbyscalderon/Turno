import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const agroRouter = Router();

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

async function assertDueno(negocioId: string, userId: number, rol: string) {
  if (rol === "superadmin") return;
  const n = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!n) throw NotFound("Negocio no encontrado");
  if (n.duenoId !== userId) throw Forbidden("Este negocio no es tuyo");
}

interface RegLite { mortalidad: number; alimentoKg: unknown; pesoPromedioG: unknown; produccion: number; fecha: Date }
function metricas(lote: { cantidadInicial: number; fechaInicio: Date; tipoProduccion: string; registros: RegLite[] }) {
  const mortalidadTotal = lote.registros.reduce((s, r) => s + r.mortalidad, 0);
  const avesVivas = Math.max(0, lote.cantidadInicial - mortalidadTotal);
  const alimentoTotalKg = round2(lote.registros.reduce((s, r) => s + Number(r.alimentoKg), 0));
  const produccionTotal = lote.registros.reduce((s, r) => s + r.produccion, 0);
  const conPeso = lote.registros.filter((r) => r.pesoPromedioG != null).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const ultimoPesoG = conPeso[0] ? Number(conPeso[0].pesoPromedioG) : null;
  const edadDias = Math.max(0, Math.floor((Date.now() - lote.fechaInicio.getTime()) / 86_400_000));
  // Conversión alimenticia (FCR) para carne: alimento / biomasa viva.
  let fcr: number | null = null;
  if (lote.tipoProduccion === "meat" && ultimoPesoG && avesVivas > 0) {
    const biomasaKg = (avesVivas * ultimoPesoG) / 1000;
    if (biomasaKg > 0) fcr = round2(alimentoTotalKg / biomasaKg);
  }
  return {
    mortalidadTotal,
    avesVivas,
    mortalidadPct: lote.cantidadInicial > 0 ? round2((mortalidadTotal / lote.cantidadInicial) * 100) : 0,
    alimentoTotalKg,
    produccionTotal,
    ultimoPesoG,
    edadDias,
    fcr,
  };
}

const loteSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(120),
  especie: z.enum(["broiler", "layer"]).default("broiler"),
  tipoProduccion: z.enum(["meat", "eggs"]).default("meat"),
  cantidadInicial: z.coerce.number().int().positive(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costoInicial: z.coerce.number().min(0).optional(),
  notas: z.string().max(500).optional(),
});

agroRouter.get("/lotes", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await assertDueno(negocioId, req.user!.sub, req.user!.rol);
  const lotes = await prisma.loteBiologico.findMany({
    where: { negocioId },
    include: { registros: { select: { mortalidad: true, alimentoKg: true, pesoPromedioG: true, produccion: true, fecha: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ lotes: lotes.map((l) => ({ id: l.id, nombre: l.nombre, especie: l.especie, tipoProduccion: l.tipoProduccion, cantidadInicial: l.cantidadInicial, fechaInicio: l.fechaInicio, estado: l.estado, ...metricas(l) })) });
}));

agroRouter.post("/lotes", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = loteSchema.parse(req.body);
  await assertDueno(d.negocioId, req.user!.sub, req.user!.rol);
  const lote = await prisma.loteBiologico.create({
    data: {
      negocioId: d.negocioId, nombre: d.nombre, especie: d.especie, tipoProduccion: d.tipoProduccion,
      cantidadInicial: d.cantidadInicial, fechaInicio: new Date(`${d.fechaInicio}T00:00:00`),
      costoInicial: d.costoInicial ?? null, notas: d.notas ?? null,
    },
  });
  res.status(201).json({ lote });
}));

agroRouter.get("/lotes/:id", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, include: { registros: { orderBy: { fecha: "desc" } } } });
  if (!lote) throw NotFound("Lote no encontrado");
  await assertDueno(lote.negocioId, req.user!.sub, req.user!.rol);
  res.json({ lote, metricas: metricas(lote) });
}));

const registroSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mortalidad: z.coerce.number().int().min(0).default(0),
  alimentoKg: z.coerce.number().min(0).default(0),
  pesoPromedioG: z.coerce.number().min(0).optional(),
  produccion: z.coerce.number().int().min(0).default(0),
  notas: z.string().max(200).optional(),
});

// Registro diario (idempotente por fecha: si ya existe, lo actualiza).
agroRouter.post("/lotes/:id/registros", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const d = registroSchema.parse(req.body);
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await assertDueno(lote.negocioId, req.user!.sub, req.user!.rol);
  const fecha = new Date(`${d.fecha}T00:00:00`);
  const registro = await prisma.registroAgro.upsert({
    where: { loteId_fecha: { loteId: req.params.id, fecha } },
    create: { loteId: req.params.id, fecha, mortalidad: d.mortalidad, alimentoKg: d.alimentoKg, pesoPromedioG: d.pesoPromedioG ?? null, produccion: d.produccion, notas: d.notas ?? null },
    update: { mortalidad: d.mortalidad, alimentoKg: d.alimentoKg, pesoPromedioG: d.pesoPromedioG ?? null, produccion: d.produccion, notas: d.notas ?? null },
  });
  res.status(201).json({ registro });
}));

agroRouter.post("/lotes/:id/cerrar", requireAuth, requireRole("admin_negocio"), asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await assertDueno(lote.negocioId, req.user!.sub, req.user!.rol);
  const actualizado = await prisma.loteBiologico.update({ where: { id: req.params.id }, data: { estado: "cerrado" } });
  res.json({ lote: actualizado });
}));
