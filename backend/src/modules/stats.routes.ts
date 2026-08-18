import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const statsRouter = Router();

// Estadísticas públicas agregadas (no sensibles) para la prueba social de la portada.
statsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [negocios, profesionales, reservas, reservasHoy] = await Promise.all([
      prisma.negocio.count({ where: { estadoSuscripcion: { in: ["activo", "prueba"] } } }),
      prisma.peluqueroEquipo.count({ where: { estadoAprobacion: "aceptado" } }),
      prisma.reservacion.count({ where: { estadoCita: { in: ["confirmada", "completada"] } } }),
      prisma.reservacion.count({
        where: {
          estadoCita: { in: ["confirmada", "completada"] },
          createdAt: { gte: new Date(new Date().toISOString().slice(0, 10) + "T00:00:00") },
        },
      }),
    ]);
    res.json({ negocios, profesionales, reservas, reservasHoy });
  }),
);
