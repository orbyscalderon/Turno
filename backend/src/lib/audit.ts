import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

// Registra una acción sensible en el log de auditoría (best-effort: nunca rompe el flujo).
export async function auditar(actorId: number | null, accion: string, detalle?: string) {
  try {
    await prisma.auditLog.create({ data: { actorId: actorId ?? undefined, accion, detalle } });
  } catch (e) {
    logger.warn({ err: e }, "no se pudo registrar auditoría");
  }
}
