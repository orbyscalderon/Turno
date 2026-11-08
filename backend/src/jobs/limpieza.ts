import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { purgarEventosAntiguos } from "../lib/webhooks.js";

// Limpieza periódica de las tablas que solo crecen. Sin esto, la analítica y la
// tabla de idempotencia de webhooks acaban siendo las más grandes de la base de
// datos y empiezan a costar dinero en un plan gestionado.

export async function limpiar(): Promise<{
  eventos: number;
  webhooks: number;
  esperas: number;
  tokens: number;
}> {
  const corteEventos = new Date(Date.now() - env.eventosRetencionDias * 24 * 60 * 60 * 1000);
  const { count: eventos } = await prisma.eventoProducto.deleteMany({
    where: { createdAt: { lt: corteEventos } },
  });

  const webhooks = await purgarEventosAntiguos(30);

  // Listas de espera de días que ya pasaron: no sirven para nada.
  const ayer = new Date();
  ayer.setUTCDate(ayer.getUTCDate() - 1);
  ayer.setUTCHours(0, 0, 0, 0);
  const { count: esperas } = await prisma.listaEspera.deleteMany({
    where: { fecha: { lt: ayer } },
  });

  // Tokens de un solo uso ya caducados (verificación de email y reset).
  const ahora = new Date();
  const [reset, verif, refresh] = await Promise.all([
    prisma.passwordResetToken.deleteMany({ where: { expiraEn: { lt: ahora } } }),
    prisma.emailVerificationToken.deleteMany({ where: { expiraEn: { lt: ahora } } }),
    prisma.refreshToken.deleteMany({ where: { expiraEn: { lt: ahora } } }),
  ]);
  const tokens = reset.count + verif.count + refresh.count;

  if (eventos || webhooks || esperas || tokens) {
    logger.info({ eventos, webhooks, esperas, tokens }, "limpieza periódica");
  }
  return { eventos, webhooks, esperas, tokens };
}

let temporizador: NodeJS.Timeout | null = null;

export function iniciarJobLimpieza(intervaloMs = 24 * 60 * 60 * 1000): void {
  if (temporizador) return;
  // La primera pasada se retrasa para no competir con el arranque.
  const arranque = setTimeout(() => void limpiar().catch(() => {}), 60_000);
  arranque.unref();
  temporizador = setInterval(() => void limpiar().catch(() => {}), intervaloMs);
  temporizador.unref();
}

export function detenerJobLimpieza(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
