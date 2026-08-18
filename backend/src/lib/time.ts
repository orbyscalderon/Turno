// Utilidades para manejo de horarios en formato "HH:MM" y cálculo de solapamientos.

/** Convierte "HH:MM" a minutos desde medianoche. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Convierte minutos desde medianoche a "HH:MM". */
export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Determina si dos intervalos [aInicio, aFin) y [bInicio, bFin) se solapan.
 * Fórmula correcta de colisión: aInicio < bFin && aFin > bInicio.
 * Se tratan como semiabiertos: una cita que termina 10:30 y otra que empieza 10:30 NO chocan.
 */
export function seSolapan(
  aInicio: number,
  aFin: number,
  bInicio: number,
  bFin: number,
): boolean {
  return aInicio < bFin && aFin > bInicio;
}

const DIAS: Record<number, string> = {
  0: "domingo",
  1: "lunes",
  2: "martes",
  3: "miercoles",
  4: "jueves",
  5: "viernes",
  6: "sabado",
};

/** Devuelve el día de la semana (enum DiaSemana) para una fecha "YYYY-MM-DD" en hora local. */
export function diaSemanaDeFecha(fechaISO: string): string {
  // Interpretamos la fecha como local a medianoche para evitar corrimientos por zona horaria.
  const [y, m, d] = fechaISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return DIAS[date.getDay()];
}
