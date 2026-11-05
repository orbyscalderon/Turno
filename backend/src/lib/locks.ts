import type { Prisma } from "@prisma/client";

/**
 * Locks de asesoramiento (advisory locks) a nivel de transacción.
 *
 * Por qué no basta `SELECT ... FOR UPDATE`: esa consulta NO bloquea nada cuando
 * todavía no hay filas para ese profesional y fecha (no hay filas que bloquear),
 * que es justo el caso de la primera reserva del día. Dos peticiones simultáneas
 * superaban las dos la comprobación de colisión y se creaba una doble reserva.
 *
 * `pg_advisory_xact_lock` bloquea una CLAVE (exista o no la fila) y se libera
 * automáticamente al cerrar la transacción, sin riesgo de lock huérfano.
 */
export async function lockAgenda(
  tx: Prisma.TransactionClient,
  peluqueroId: number,
  fechaISOStr: string,
): Promise<void> {
  const clave = `agenda:${peluqueroId}:${fechaISOStr}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
}

/** Lock por negocio (límites de plantilla, cambios de suscripción...). */
export async function lockNegocio(
  tx: Prisma.TransactionClient,
  negocioId: string,
): Promise<void> {
  const clave = `negocio:${negocioId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
}
