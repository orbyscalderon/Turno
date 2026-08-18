import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { toMinutes } from "../lib/time.js";

export const disponibilidadRouter = Router();

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora inválido (HH:MM)");

const rangoSchema = z.object({
  dia: z.enum(["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]),
  horaInicio: HHMM,
  horaFin: HHMM,
});

// Reemplaza toda la disponibilidad del peluquero por el conjunto enviado.
const bulkSchema = z.object({ rangos: z.array(rangoSchema).max(50) });

disponibilidadRouter.put(
  "/mia",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const { rangos } = bulkSchema.parse(req.body);
    const peluqueroId = req.user!.sub;

    for (const r of rangos) {
      if (toMinutes(r.horaInicio) >= toMinutes(r.horaFin)) {
        throw BadRequest(`Rango inválido en ${r.dia}: la hora de fin debe ser mayor a la de inicio`);
      }
    }

    await prisma.$transaction([
      prisma.disponibilidad.deleteMany({ where: { peluqueroId } }),
      prisma.disponibilidad.createMany({
        data: rangos.map((r) => ({ ...r, peluqueroId })),
      }),
    ]);

    const disponibilidad = await prisma.disponibilidad.findMany({ where: { peluqueroId } });
    res.json({ disponibilidad });
  }),
);

disponibilidadRouter.get(
  "/mia",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const disponibilidad = await prisma.disponibilidad.findMany({
      where: { peluqueroId: req.user!.sub },
    });
    res.json({ disponibilidad });
  }),
);

// ---------- Bloqueos de agenda (descansos, vacaciones, ausencias) ----------
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD");
const bloqueoSchema = z
  .object({
    fecha: FECHA,
    horaInicio: HHMM.optional(),
    horaFin: HHMM.optional(),
    motivo: z.string().max(120).optional(),
  })
  .refine((d) => (d.horaInicio && d.horaFin) || (!d.horaInicio && !d.horaFin), {
    message: "Indica ambas horas o ninguna (para bloquear el día completo)",
  })
  .refine((d) => !d.horaInicio || !d.horaFin || toMinutes(d.horaInicio) < toMinutes(d.horaFin), {
    message: "La hora de fin debe ser mayor a la de inicio",
  });

disponibilidadRouter.get(
  "/bloqueos",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const bloqueos = await prisma.bloqueo.findMany({
      where: { peluqueroId: req.user!.sub, fecha: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
      orderBy: { fecha: "asc" },
    });
    res.json({ bloqueos });
  }),
);

disponibilidadRouter.post(
  "/bloqueos",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const data = bloqueoSchema.parse(req.body);
    const bloqueo = await prisma.bloqueo.create({
      data: {
        peluqueroId: req.user!.sub,
        fecha: new Date(`${data.fecha}T00:00:00`),
        horaInicio: data.horaInicio ?? null,
        horaFin: data.horaFin ?? null,
        motivo: data.motivo ?? null,
      },
    });
    res.status(201).json({ bloqueo });
  }),
);

disponibilidadRouter.delete(
  "/bloqueos/:id",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b || b.peluqueroId !== req.user!.sub) return res.status(404).json({ error: "No encontrado" });
    await prisma.bloqueo.delete({ where: { id } });
    res.status(204).end();
  }),
);
