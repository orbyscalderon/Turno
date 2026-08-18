import { logger } from "./logger.js";

// Punto único de captura de errores no controlados.
// En producción, aquí se conecta Sentry: si process.env.SENTRY_DSN existe,
//   Sentry.init({ dsn }) al arrancar y aquí Sentry.captureException(err).
export function reportError(err: unknown, contexto?: Record<string, unknown>) {
  logger.error({ err, ...contexto }, "error no controlado");
  // if (sentry) sentry.captureException(err, { extra: contexto });
}
