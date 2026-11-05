import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// Punto único de captura de errores no controlados.
// Con SENTRY_DSN definido, los 500 llegan a Sentry con contexto (ruta, método,
// usuario). Sin DSN, todo queda en el log estructurado y no se inicializa nada.

let activo = false;

export function iniciarMonitor(): void {
  if (activo || !env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: env.sentryTracesSampleRate,
    // No enviamos cuerpos de peticiones ni cookies: pueden contener contraseñas.
    sendDefaultPii: false,
  });
  activo = true;
  logger.info("Sentry inicializado");
}

export function reportError(err: unknown, contexto?: Record<string, unknown>): void {
  logger.error({ err, ...contexto }, "error no controlado");
  if (activo) {
    Sentry.captureException(err, contexto ? { extra: contexto } : undefined);
  }
}

/** Vacía la cola de Sentry antes de cerrar el proceso. */
export async function cerrarMonitor(ms = 2000): Promise<void> {
  if (activo) await Sentry.close(ms);
}
