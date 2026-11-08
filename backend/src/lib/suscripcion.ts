import type { Prisma } from "@prisma/client";

/**
 * Vigencia de la suscripción de un negocio.
 *
 * Antes solo se miraba `estadoSuscripcion`, nunca `suscripcionHasta`: un negocio
 * que terminaba la prueba de 14 días seguía apareciendo y aceptando reservas para
 * siempre. Ahora la fecha manda, de modo que el corte es inmediato aunque el job
 * de vencimiento todavía no haya pasado.
 */
export function estaVigente(negocio: {
  estadoSuscripcion: string;
  suscripcionHasta?: Date | null;
}): boolean {
  if (negocio.estadoSuscripcion === "vencido") return false;
  if (!negocio.suscripcionHasta) return negocio.estadoSuscripcion === "activo";
  return negocio.suscripcionHasta.getTime() > Date.now();
}

/**
 * Filtro Prisma equivalente, para usarlo en consultas (listados públicos, validación
 * de reservas...). Un negocio activo sin fecha se considera vigente (plan gestionado
 * por Stripe, que la refresca en cada `invoice.paid`).
 */
export function filtroNegocioVigente(): Prisma.NegocioWhereInput {
  return {
    estadoSuscripcion: { in: ["activo", "prueba"] },
    OR: [{ suscripcionHasta: null }, { suscripcionHasta: { gt: new Date() } }],
  };
}

/** Días que quedan de suscripción (negativo si ya venció). */
export function diasRestantes(suscripcionHasta?: Date | null): number | null {
  if (!suscripcionHasta) return null;
  return Math.ceil((suscripcionHasta.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}
