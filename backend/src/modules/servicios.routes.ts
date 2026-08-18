import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const serviciosRouter = Router();

// ---------- Listado público de servicios de un peluquero ----------
serviciosRouter.get(
  "/peluquero/:peluqueroId",
  asyncHandler(async (req, res) => {
    const peluqueroId = Number(req.params.peluqueroId);
    const servicios = await prisma.servicio.findMany({
      where: { peluqueroId, activo: true },
      select: { id: true, nombreServicio: true, precio: true, moneda: true, duracionMinutos: true, imagenUrl: true },
      orderBy: { nombreServicio: "asc" },
    });
    res.json({ servicios });
  }),
);

// ---------- CRUD del peluquero sobre su propio catálogo ----------
// Monedas soportadas (código ISO 4217).
export const MONEDAS = ["USD", "EUR", "MXN", "COP", "ARS", "CLP", "PEN", "GBP", "BRL", "DOP"] as const;

const servicioSchema = z.object({
  nombreServicio: z.string().min(2).max(100),
  precio: z.number().nonnegative(),
  moneda: z.enum(MONEDAS).default("USD"),
  duracionMinutos: z.number().int().positive().max(600),
});

serviciosRouter.post(
  "/",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const data = servicioSchema.parse(req.body);
    const servicio = await prisma.servicio.create({
      data: { ...data, peluqueroId: req.user!.sub },
    });
    res.status(201).json({ servicio });
  }),
);

serviciosRouter.get(
  "/mios",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const servicios = await prisma.servicio.findMany({
      where: { peluqueroId: req.user!.sub },
      orderBy: { createdAt: "desc" },
    });
    res.json({ servicios });
  }),
);

serviciosRouter.put(
  "/:id",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = servicioSchema.partial().extend({ activo: z.boolean().optional() }).parse(req.body);

    const existente = await prisma.servicio.findUnique({ where: { id } });
    if (!existente) throw NotFound("Servicio no encontrado");
    if (existente.peluqueroId !== req.user!.sub) throw Forbidden("No es tu servicio");

    const servicio = await prisma.servicio.update({ where: { id }, data });
    res.json({ servicio });
  }),
);

serviciosRouter.delete(
  "/:id",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const existente = await prisma.servicio.findUnique({ where: { id } });
    if (!existente) throw NotFound("Servicio no encontrado");
    if (existente.peluqueroId !== req.user!.sub) throw Forbidden("No es tu servicio");

    // Baja lógica para no romper el historial de reservas.
    await prisma.servicio.update({ where: { id }, data: { activo: false } });
    res.status(204).end();
  }),
);
