import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";
import { AppError } from "../lib/errors.js";
import { reportError } from "../lib/monitor.js";

// Manejador global de errores. Traduce excepciones conocidas a respuestas JSON coherentes.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Datos inválidos",
      code: "VALIDATION_ERROR",
      // Zod 4 renombró .errors a .issues (.errors se eliminó).
      detalles: err.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message })),
    });
  }

  // Subidas: tamaño o campo incorrectos son culpa del cliente, no un 500.
  if (err instanceof MulterError) {
    const mensajes: Record<string, string> = {
      LIMIT_FILE_SIZE: "La imagen supera el máximo de 3 MB",
      LIMIT_FILE_COUNT: "Solo se puede subir una imagen",
      LIMIT_UNEXPECTED_FILE: "Campo de archivo inesperado (usa 'imagen')",
    };
    return res.status(413).json({
      error: mensajes[err.code] ?? "Error al subir el archivo",
      code: err.code,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Registro duplicado", code: "DUPLICATE" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Registro no encontrado", code: "NOT_FOUND" });
    }
    if (err.code === "P2003") {
      return res
        .status(409)
        .json({ error: "Hay datos relacionados que impiden la operación", code: "FK_CONSTRAINT" });
    }
  }

  // Base de datos inaccesible: 503, no 500 (es temporal y reintentar tiene sentido).
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P1001")
  ) {
    reportError(err, { path: req.path, method: req.method });
    return res
      .status(503)
      .json({ error: "Servicio temporalmente no disponible", code: "DB_UNAVAILABLE" });
  }

  reportError(err, {
    path: req.path,
    method: req.method,
    usuarioId: req.user?.sub,
  });
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
