// Límites de cada plan de suscripción. Centralizados aquí para ajustarlos fácil.
// El plan es POR NEGOCIO (cada negocio tiene su suscripción).
export const LIMITES_PLAN = {
  prueba: { peluqueros: 5, negocios: 1 },
  basico: { peluqueros: 3, negocios: 1 },
  pro: { peluqueros: 10, negocios: 5 },
} as const;

/**
 * Máximo de profesionales activos permitidos en un negocio según su plan/estado.
 * - En prueba: tope de prueba (para que puedan probar).
 * - Con plan activo: el tope del plan.
 * - Sin plan/estado raro: tope conservador (Básico).
 */
export function limitePeluqueros(plan: string | null | undefined, estadoSuscripcion: string): number {
  if (estadoSuscripcion === "prueba") return LIMITES_PLAN.prueba.peluqueros;
  if (plan === "pro") return LIMITES_PLAN.pro.peluqueros;
  if (plan === "basico") return LIMITES_PLAN.basico.peluqueros;
  return LIMITES_PLAN.basico.peluqueros;
}

/**
 * Máximo de negocios que un dueño puede tener, según su MEJOR plan activo.
 * Si tiene algún negocio Pro activo, sube al tope Pro; si no, tope Básico.
 * (El primer negocio siempre entra porque el tope Básico es 1.)
 */
export function limiteNegocios(
  negocios: { plan: string | null; estadoSuscripcion: string }[],
): number {
  const tienePro = negocios.some((n) => n.plan === "pro" && n.estadoSuscripcion === "activo");
  return tienePro ? LIMITES_PLAN.pro.negocios : LIMITES_PLAN.basico.negocios;
}
