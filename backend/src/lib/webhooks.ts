import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

/**
 * Idempotencia de webhooks.
 *
 * Stripe reintenta cada evento hasta recibir un 2xx, y puede entregar el mismo
 * evento más de una vez incluso tras un éxito. Sin control, un reintento de
 * `payment_intent.succeeded` volvía a confirmar la reserva y reenviaba el email
 * de confirmación y el WhatsApp al cliente.
 *
 * Devuelve true si el evento es NUEVO (hay que procesarlo), false si ya se
 * procesó. La unicidad la garantiza el índice (proveedor, evento_id) en BD, así
 * que es seguro incluso con varias instancias del backend en paralelo.
 */
export async function marcarEventoNuevo(
  proveedor: string,
  eventoId: string,
  tipo: string,
): Promise<boolean> {
  try {
    await prisma.webhookEvento.create({ data: { proveedor, eventoId, tipo } });
    return true;
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002") {
      logger.info({ proveedor, eventoId, tipo }, "webhook duplicado: ignorado");
      return false;
    }
    throw e;
  }
}

/** Limpia eventos antiguos (el historial solo sirve para la ventana de reintentos). */
export async function purgarEventosAntiguos(dias = 30): Promise<number> {
  const { count } = await prisma.webhookEvento.deleteMany({
    where: { procesadoEn: { lt: new Date(Date.now() - dias * 24 * 60 * 60 * 1000) } },
  });
  return count;
}
