import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import {
  toMinutes,
  toHHMM,
  seSolapan,
  diaSemanaDeFecha,
  fechaUTC,
  ahoraEnZona,
  zonaSegura,
} from "../lib/time.js";
import type { Prisma } from "@prisma/client";

// Granularidad con la que se ofrecen los inicios de cita (minutos). 15 min es el estándar del sector.
const SLOT_GRANULARITY = 15;

export interface Slot {
  inicio: string; // "HH:MM"
  fin: string; // "HH:MM"
}

/** Zona horaria del negocio al que pertenece el profesional (la primera membresía aceptada). */
export async function zonaDelPeluquero(
  peluqueroId: number,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const db = tx ?? prisma;
  const membresia = await db.peluqueroEquipo.findFirst({
    where: { usuarioId: peluqueroId, estadoAprobacion: "aceptado" },
    select: { negocio: { select: { timezone: true } } },
  });
  return zonaSegura(membresia?.negocio.timezone ?? env.timezoneDefecto);
}

/**
 * Calcula los bloques libres para un peluquero en una fecha, según:
 * - su disponibilidad configurada para ese día de la semana,
 * - la duración del servicio elegido,
 * - las reservaciones ya confirmadas (evitando solapamientos),
 * - los bloqueos de agenda (descansos, vacaciones),
 * - y la hora actual EN LA ZONA DEL NEGOCIO (no se ofrecen horas pasadas de hoy).
 *
 * Acepta opcionalmente un cliente transaccional (tx) para reusar la lógica
 * dentro de la transacción de creación de reserva.
 */
export async function calcularSlotsLibres(params: {
  peluqueroId: number;
  servicioId: number;
  fechaISO: string; // "YYYY-MM-DD"
  tz?: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ duracionMinutos: number; slots: Slot[]; timezone: string }> {
  const db = params.tx ?? prisma;
  const tz = params.tz ?? (await zonaDelPeluquero(params.peluqueroId, params.tx));

  const servicio = await db.servicio.findUnique({ where: { id: params.servicioId } });
  if (!servicio || servicio.peluqueroId !== params.peluqueroId) {
    throw new Error("El servicio no pertenece al peluquero indicado");
  }
  const duracion = servicio.duracionMinutos;

  const dia = diaSemanaDeFecha(params.fechaISO) as
    | "lunes"
    | "martes"
    | "miercoles"
    | "jueves"
    | "viernes"
    | "sabado"
    | "domingo";

  const rangos = await db.disponibilidad.findMany({
    where: { peluqueroId: params.peluqueroId, dia },
  });
  if (rangos.length === 0) return { duracionMinutos: duracion, slots: [], timezone: tz };

  // Reservas confirmadas del día que bloquean horario.
  const fecha = fechaUTC(params.fechaISO);
  const ocupadas = await db.reservacion.findMany({
    where: { peluqueroId: params.peluqueroId, fecha, estadoCita: "confirmada" },
    select: { horaInicio: true, horaFin: true },
  });
  const bloqueos = ocupadas.map((r) => ({
    inicio: toMinutes(r.horaInicio),
    fin: toMinutes(r.horaFin),
  }));

  // Bloqueos de agenda (descansos/vacaciones). Sin horas => todo el día.
  const bloqueosAgenda = await db.bloqueo.findMany({
    where: { peluqueroId: params.peluqueroId, fecha },
    select: { horaInicio: true, horaFin: true },
  });
  for (const b of bloqueosAgenda) {
    if (b.horaInicio && b.horaFin) {
      bloqueos.push({ inicio: toMinutes(b.horaInicio), fin: toMinutes(b.horaFin) });
    } else {
      bloqueos.push({ inicio: 0, fin: 24 * 60 }); // día completo
    }
  }

  // Suelo horario: si la fecha es HOY en la zona del negocio, no ofrecer horas
  // pasadas ni dentro de la antelación mínima configurada.
  const ahora = ahoraEnZona(tz);
  let minimoMinutos = -1;
  if (params.fechaISO === ahora.fechaISO) {
    minimoMinutos = ahora.minutos + env.antelacionMinimaHoras * 60;
  } else if (params.fechaISO < ahora.fechaISO) {
    return { duracionMinutos: duracion, slots: [], timezone: tz }; // día pasado
  }

  const slots: Slot[] = [];
  for (const rango of rangos) {
    const rInicio = toMinutes(rango.horaInicio);
    const rFin = toMinutes(rango.horaFin);

    for (let inicio = rInicio; inicio + duracion <= rFin; inicio += SLOT_GRANULARITY) {
      if (inicio < minimoMinutos) continue;
      const fin = inicio + duracion;
      const choca = bloqueos.some((b) => seSolapan(inicio, fin, b.inicio, b.fin));
      if (!choca) {
        slots.push({ inicio: toHHMM(inicio), fin: toHHMM(fin) });
      }
    }
  }

  // Ordena y elimina posibles duplicados si hubiera rangos superpuestos.
  const vistos = new Set<string>();
  const unicos = slots
    .sort((a, b) => toMinutes(a.inicio) - toMinutes(b.inicio))
    .filter((s) => {
      if (vistos.has(s.inicio)) return false;
      vistos.add(s.inicio);
      return true;
    });

  return { duracionMinutos: duracion, slots: unicos, timezone: tz };
}

/**
 * Verifica dentro de una transacción que un intervalo concreto siga libre.
 * Se usa antes de crear la reserva, tras tomar el lock de la agenda.
 */
export function intervaloDisponible(
  inicioMin: number,
  finMin: number,
  bloqueos: { inicio: number; fin: number }[],
): boolean {
  return !bloqueos.some((b) => seSolapan(inicioMin, finMin, b.inicio, b.fin));
}
