import { prisma } from "../lib/prisma.js";
import { toMinutes, toHHMM, seSolapan, diaSemanaDeFecha } from "../lib/time.js";
import type { Prisma } from "@prisma/client";

// Granularidad con la que se ofrecen los inicios de cita (minutos). 15 min es el estándar del sector.
const SLOT_GRANULARITY = 15;

export interface Slot {
  inicio: string; // "HH:MM"
  fin: string; // "HH:MM"
}

/**
 * Calcula los bloques libres para un peluquero en una fecha, según:
 * - su disponibilidad configurada para ese día de la semana,
 * - la duración del servicio elegido,
 * - las reservaciones ya confirmadas (evitando solapamientos).
 *
 * Acepta opcionalmente un cliente transaccional (tx) para reusar la lógica
 * dentro de la transacción de creación de reserva.
 */
export async function calcularSlotsLibres(params: {
  peluqueroId: number;
  servicioId: number;
  fechaISO: string; // "YYYY-MM-DD"
  tx?: Prisma.TransactionClient;
}): Promise<{ duracionMinutos: number; slots: Slot[] }> {
  const db = params.tx ?? prisma;

  const servicio = await db.servicio.findUnique({ where: { id: params.servicioId } });
  if (!servicio || servicio.peluqueroId !== params.peluqueroId) {
    throw new Error("El servicio no pertenece al peluquero indicado");
  }
  const duracion = servicio.duracionMinutos;

  const dia = diaSemanaDeFecha(params.fechaISO) as
    | "lunes" | "martes" | "miercoles" | "jueves" | "viernes" | "sabado" | "domingo";

  const rangos = await db.disponibilidad.findMany({
    where: { peluqueroId: params.peluqueroId, dia },
  });
  if (rangos.length === 0) return { duracionMinutos: duracion, slots: [] };

  // Reservas confirmadas del día que bloquean horario.
  const fecha = new Date(`${params.fechaISO}T00:00:00`);
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

  const slots: Slot[] = [];
  for (const rango of rangos) {
    const rInicio = toMinutes(rango.horaInicio);
    const rFin = toMinutes(rango.horaFin);

    for (let inicio = rInicio; inicio + duracion <= rFin; inicio += SLOT_GRANULARITY) {
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

  return { duracionMinutos: duracion, slots: unicos };
}

/**
 * Verifica dentro de una transacción que un intervalo concreto siga libre.
 * Se usa antes de crear la reserva, tras bloquear las filas del peluquero.
 */
export function intervaloDisponible(
  inicioMin: number,
  finMin: number,
  bloqueos: { inicio: number; fin: number }[],
): boolean {
  return !bloqueos.some((b) => seSolapan(inicioMin, finMin, b.inicio, b.fin));
}
