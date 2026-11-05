import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { purgarEventosAntiguos } from "../lib/webhooks.js";

/**
 * Libera los slots de reservas cuyo pago no se completó dentro del tiempo de hold.
 * Marca como 'cancelada' toda reserva confirmada con pago 'pendiente' y expiraPagoEn vencido.
 * Devuelve cuántas liberó.
 */
export async function expirarReservasImpagas(): Promise<number> {
  const ahora = new Date();
  const { count } = await prisma.reservacion.updateMany({
    where: {
      estadoCita: "confirmada",
      pagoReservaStatus: "pendiente",
      expiraPagoEn: { lt: ahora },
    },
    data: {
      estadoCita: "cancelada",
      canceladaEn: ahora,
      canceladaPor: "sistema",
      motivoCancelacion: "Pago no completado en el tiempo de reserva",
    },
  });
  if (count > 0) {
    logger.info(`[job] ${count} reserva(s) impaga(s) expirada(s) y liberada(s)`);
  }
  return count;
}

let timer: NodeJS.Timeout | null = null;
let purgas = 0;

/** Arranca el job periódico (cada `intervaloMs`, por defecto 60s). */
export function iniciarJobExpiracion(intervaloMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    expirarReservasImpagas().catch((e) => logger.error({ err: e }, "[job] error expirando reservas"));
    // Una vez al día (cada 1440 pasadas de 60s), limpia el historial de webhooks.
    if (++purgas % 1440 === 0) {
      purgarEventosAntiguos().catch((e) => logger.warn({ err: e }, "[job] purga de webhooks"));
    }
  }, intervaloMs);
  // No mantener vivo el proceso solo por este timer.
  timer.unref?.();
}

export function detenerJobExpiracion() {
  if (timer) clearInterval(timer);
  timer = null;
}
