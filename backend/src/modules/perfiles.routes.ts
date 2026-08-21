import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { PERFILES, MODULO_LABELS, MODULOS_DISPONIBLES } from "../config/perfiles.js";

export const perfilesRouter = Router();

// Catálogo de rubros para el onboarding (público). Incluye qué módulos activa cada uno
// y cuáles ya están disponibles hoy vs. próximamente.
perfilesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({
      perfiles: PERFILES,
      moduloLabels: MODULO_LABELS,
      modulosDisponibles: MODULOS_DISPONIBLES,
    });
  }),
);
