import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";
import { reportError } from "../lib/monitor.js";

// Manejador global de errores. Traduce excepciones conocidas a respuestas JSON coherentes.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Datos inválidos",
      code: "VALIDATION_ERROR",
      detalles: err.errors.map((e) => ({ campo: e.path.join("."), mensaje: e.message })),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Registro duplicado", code: "DUPLICATE" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Registro no encontrado", code: "NOT_FOUND" });
    }
  }

  reportError(err, { path: _req.path, method: _req.method });
  return res.status(500).json({ error: "Error interno del servidor", code: "INTERNAL" });
}

// Envuelve handlers async para que sus rechazos lleguen al errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
