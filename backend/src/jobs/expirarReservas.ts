import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/**
 * Libera los slots de reservas cuyo pago no se completó dentro del tiempo de hold.
 * Marca como 'cancelada' toda reserva confirmada con pago 'pendiente' y expiraPagoEn vencido.
 * Devuelve cuántas liberó.
 */
export async function expirarReservasImpagas(): Promise<number> {
  const { count } = await prisma.reservacion.updateMany({
    where: {
      estadoCita: "confirmada",
      pagoReservaStatus: "pendiente",
      expiraPagoEn: { lt: new Date() },
    },
    data: { estadoCita: "cancelada" },
  });
  if (count > 0) {
    logger.info(`[job] ${count} reserva(s) impaga(s) expirada(s) y liberada(s)`);
  }
  return count;
}

let timer: NodeJS.Timeout | null = null;

/** Arranca el job periódico (cada `intervaloMs`, por defecto 60s). */
export function iniciarJobExpiracion(intervaloMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    expirarReservasImpagas().catch((e) => logger.error({ err: e }, "[job] error expirando reservas"));
  }, intervaloMs);
  // No mantener vivo el proceso solo por este timer.
  timer.unref?.();
}

export function detenerJobExpiracion() {
  if (timer) clearInterval(timer);
  timer = null;
}
