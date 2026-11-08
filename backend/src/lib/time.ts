// Utilidades de horarios ("HH:MM"), fechas de calendario y zonas horarias.
//
// REGLA IMPORTANTE DEL PROYECTO:
//  - Las columnas `fecha` son @db.Date (fecha de calendario, SIN hora ni zona).
//    Prisma las serializa usando la parte UTC del Date, así que SIEMPRE hay que
//    construirlas con Date.UTC (`fechaUTC`) y leerlas con `fechaISO`. Si se usa
//    `new Date("2026-01-05T00:00:00")` el día se desplaza en servidores con
//    desplazamiento positivo (p. ej. Europe/Madrid) y se guarda el día anterior.
//  - La hora "de pared" (lo que ve el cliente y el negocio) se interpreta en la
//    zona horaria del NEGOCIO (`Negocio.timezone`), nunca en la del servidor.

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
export function seSolapan(aInicio: number, aFin: number, bInicio: number, bFin: number): boolean {
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

/** Día de la semana (enum DiaSemana) de una fecha "YYYY-MM-DD". Determinista (UTC). */
export function diaSemanaDeFecha(fechaISOStr: string): string {
  const [y, m, d] = fechaISOStr.split("-").map(Number);
  return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// ---------------------------------------------------------------------------
// Fechas de calendario (columnas @db.Date)
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" -> Date a medianoche UTC, apto para columnas @db.Date. */
export function fechaUTC(fechaISOStr: string): Date {
  const [y, m, d] = fechaISOStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Date (de una columna @db.Date) -> "YYYY-MM-DD" sin desplazamiento de zona. */
export function fechaISO(fecha: Date): string {
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Suma (o resta) días a una fecha de calendario "YYYY-MM-DD". */
export function sumarDias(fechaISOStr: string, dias: number): string {
  const d = fechaUTC(fechaISOStr);
  d.setUTCDate(d.getUTCDate() + dias);
  return fechaISO(d);
}

// ---------------------------------------------------------------------------
// Zonas horarias
// ---------------------------------------------------------------------------

/** Comprueba que una zona IANA existe. */
export function zonaValida(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Zona utilizable: la indicada si es válida, UTC como refugio. */
export function zonaSegura(tz: string | null | undefined): string {
  return tz && zonaValida(tz) ? tz : "UTC";
}

function partesEnZona(instante: Date, tz: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const parte of dtf.formatToParts(instante)) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  // Algunos entornos devuelven "24" para la medianoche.
  if (p.hour === 24) p.hour = 0;
  return p;
}

/** Desplazamiento (minutos) de la zona respecto a UTC en ese instante. */
function offsetMinutos(instante: Date, tz: string): number {
  const p = partesEnZona(instante, tz);
  const comoUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (comoUTC - instante.getTime()) / 60000;
}

/**
 * Instante real (UTC) de una hora de pared en una zona concreta.
 * Dos pasadas para resolver bien los cambios de horario (DST).
 */
export function instanteEnZona(fechaISOStr: string, hhmm: string, tz: string): Date {
  const zona = zonaSegura(tz);
  const [y, m, d] = fechaISOStr.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const supuesto = Date.UTC(y, m - 1, d, h, min);
  const off1 = offsetMinutos(new Date(supuesto), zona);
  const off2 = offsetMinutos(new Date(supuesto - off1 * 60000), zona);
  return new Date(supuesto - off2 * 60000);
}

/** Fecha y minutos "de pared" actuales en una zona. */
export function ahoraEnZona(tz: string): { fechaISO: string; minutos: number } {
  const p = partesEnZona(new Date(), zonaSegura(tz));
  const fecha = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { fechaISO: fecha, minutos: p.hour * 60 + p.minute };
}

/** Horas que faltan (negativas si ya pasó) hasta una cita, en la zona del negocio. */
export function horasHasta(fechaISOStr: string, hhmm: string, tz: string): number {
  return (instanteEnZona(fechaISOStr, hhmm, tz).getTime() - Date.now()) / 3_600_000;
}
