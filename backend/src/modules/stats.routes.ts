import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { filtroNegocioVigente } from "../lib/suscripcion.js";
import { fechaISO, fechaUTC } from "../lib/time.js";

export const statsRouter = Router();

// Caché en memoria: esta ruta la pide CADA visita de la portada y son 4 COUNT
// sobre toda la tabla. Un minuto de desfase en un contador de prueba social no
// le importa a nadie y evita martillear la base de datos.
let cache: { datos: unknown; expira: number } | null = null;
const TTL_MS = 60_000;

// Estadísticas públicas agregadas (no sensibles) para la prueba social de la portada.
statsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    if (cache && cache.expira > Date.now()) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json(cache.datos);
    }

    const inicioDeHoy = fechaUTC(fechaISO(new Date()));
    const [negocios, profesionales, reservas, reservasHoy] = await Promise.all([
      prisma.negocio.count({ where: filtroNegocioVigente() }),
      prisma.peluqueroEquipo.count({ where: { estadoAprobacion: "aceptado" } }),
      prisma.reservacion.count({ where: { estadoCita: { in: ["confirmada", "completada"] } } }),
      prisma.reservacion.count({
        where: {
          estadoCita: { in: ["confirmada", "completada"] },
          createdAt: { gte: inicioDeHoy },
        },
      }),
    ]);

    const datos = { negocios, profesionales, reservas, reservasHoy };
    cache = { datos, expira: Date.now() + TTL_MS };
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json(datos);
  }),
);
