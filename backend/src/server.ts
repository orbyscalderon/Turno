import { crearApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { iniciarJobExpiracion, detenerJobExpiracion } from "./jobs/expirarReservas.js";
import { iniciarJobRecordatorios, detenerJobRecordatorios } from "./jobs/recordatorios.js";

const app = crearApp();

const server = app.listen(env.port, () => {
  logger.info(`🟢 Turno API en http://localhost:${env.port} | ${env.nodeEnv} | pago:${env.paymentProvider} | email:${env.emailTransport}`);
});

// Jobs en segundo plano.
iniciarJobExpiracion();       // libera slots de reservas impagas
iniciarJobRecordatorios();    // recordatorios de citas del día siguiente

// Cierre ordenado.
async function shutdown(signal: string) {
  logger.info(`${signal} recibido, cerrando...`);
  detenerJobExpiracion();
  detenerJobRecordatorios();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
