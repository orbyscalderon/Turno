import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { PERFILES, MODULO_LABELS, MODULOS_DISPONIBLES } from "../config/perfiles.js";
import { env } from "../config/env.js";

export const perfilesRouter = Router();

// Catálogo de rubros para el onboarding (público). Incluye qué módulos activa cada uno
// y cuáles ya están disponibles hoy vs. próximamente.
// En modo "rubro fijo" solo se expone ese rubro.
perfilesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const perfiles = env.rubroFijo ? PERFILES.filter((p) => p.slug === env.rubroFijo) : PERFILES;
    res.json({
      perfiles,
      moduloLabels: MODULO_LABELS,
      modulosDisponibles: MODULOS_DISPONIBLES,
      rubroFijo: env.rubroFijo || null,
    });
  }),
);
