import { crearApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { iniciarMonitor, cerrarMonitor, reportError } from "./lib/monitor.js";
import { iniciarJobExpiracion, detenerJobExpiracion } from "./jobs/expirarReservas.js";
import { iniciarJobRecordatorios, detenerJobRecordatorios } from "./jobs/recordatorios.js";
import { iniciarJobSuscripciones, detenerJobSuscripciones } from "./jobs/vencerSuscripciones.js";

// Monitorización antes que nada, para capturar también fallos de arranque.
iniciarMonitor();

const app = crearApp();

const server = app.listen(env.port, () => {
  logger.info(
    `🟢 Turno API en http://localhost:${env.port} | ${env.nodeEnv} | pago:${env.paymentProvider} | email:${env.emailTransport} | tz:${env.timezoneDefecto}`,
  );
});

// Jobs en segundo plano.
iniciarJobExpiracion(); // libera slots de reservas impagas
iniciarJobRecordatorios(); // recordatorios de 24 h y de pocas horas antes
iniciarJobSuscripciones(); // vence pruebas y suscripciones caducadas

// Cualquier fallo no capturado queda registrado (y en Sentry si está configurado).
process.on("unhandledRejection", (razon) => reportError(razon, { tipo: "unhandledRejection" }));
process.on("uncaughtException", (err) => {
  reportError(err, { tipo: "uncaughtException" });
  // Un estado inconsistente no se "sigue usando": se cierra ordenadamente.
  void shutdown("uncaughtException", 1);
});

// Cierre ordenado: deja de aceptar conexiones, termina las en curso y suelta la BD.
let cerrando = false;
async function shutdown(senal: string, codigo = 0) {
  if (cerrando) return;
  cerrando = true;
  logger.info(`${senal} recibido, cerrando...`);

  detenerJobExpiracion();
  detenerJobRecordatorios();
  detenerJobSuscripciones();

  // Red de seguridad: si algo se queda colgado, salimos de todas formas.
  const forzar = setTimeout(() => {
    logger.warn("cierre forzado tras 10s");
    process.exit(codigo || 1);
  }, 10_000);
  forzar.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect().catch(() => {});
  await cerrarMonitor().catch(() => {});
  clearTimeout(forzar);
  process.exit(codigo);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
