import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { avisarListaEspera } from "../lib/espera.js";
import { zonaDelPeluquero } from "../modules/slots.service.js";

/**
 * Libera los slots de reservas cuyo pago no se completó dentro del tiempo de hold.
 * Marca como 'cancelada' toda reserva confirmada con pago 'pendiente' y expiraPagoEn vencido.
 * Devuelve cuántas liberó.
 */
export async function expirarReservasImpagas(): Promise<number> {
  const ahora = new Date();

  // Primero se leen y luego se actualizan: hace falta saber QUÉ huecos quedan
  // libres para avisar a la lista de espera de cada uno.
  const caducadas = await prisma.reservacion.findMany({
    where: {
      estadoCita: "confirmada",
      pagoReservaStatus: "pendiente",
      expiraPagoEn: { lt: ahora },
    },
    select: { id: true, peluqueroId: true, fecha: true, horaInicio: true, horaFin: true },
  });
  if (!caducadas.length) return 0;

  const { count } = await prisma.reservacion.updateMany({
    where: { id: { in: caducadas.map((r) => r.id) }, estadoCita: "confirmada" },
    data: {
      estadoCita: "cancelada",
      canceladaEn: ahora,
      canceladaPor: "sistema",
      motivoCancelacion: "Pago no completado en el tiempo de reserva",
    },
  });

  if (count > 0) {
    logger.info(`[job] ${count} reserva(s) impaga(s) expirada(s) y liberada(s)`);
    // La zona se cachea por profesional: varias reservas caducadas del mismo
    // profesional no deben provocar una consulta por cada una.
    const zonas = new Map<number, string>();
    for (const r of caducadas) {
      let tz = zonas.get(r.peluqueroId);
      if (!tz) {
        tz = await zonaDelPeluquero(r.peluqueroId);
        zonas.set(r.peluqueroId, tz);
      }
      await avisarListaEspera({
        peluqueroId: r.peluqueroId,
        fecha: r.fecha,
        horaInicio: r.horaInicio,
        horaFin: r.horaFin,
        tz,
      });
    }
  }
  return count;
}

let timer: NodeJS.Timeout | null = null;

/** Arranca el job periódico (cada `intervaloMs`, por defecto 60s). */
export function iniciarJobExpiracion(intervaloMs = 60_000) {
  if (timer) return;
  timer = setInterval(() => {
    expirarReservasImpagas().catch((e) =>
      logger.error({ err: e }, "[job] error expirando reservas"),
    );
  }, intervaloMs);
  // No mantener vivo el proceso solo por este timer.
  timer.unref?.();
}

export function detenerJobExpiracion() {
  if (timer) clearInterval(timer);
  timer = null;
}
