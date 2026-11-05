import { prisma } from "../lib/prisma.js";
import { enviarEmail, emailRecordatorio } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { fechaISO, fechaUTC, horasHasta, sumarDias, ahoraEnZona } from "../lib/time.js";

/**
 * Recordatorios de citas. Dos avisos independientes:
 *   1. ~24 h antes  -> marca `recordatorioEnviadoEn`
 *   2. pocas horas antes (RECORDATORIO_CORTO_HORAS) -> marca `recordatorioCortoEn`
 *
 * Las horas restantes se calculan con la ZONA HORARIA DEL NEGOCIO, no con la del
 * servidor: antes se comparaba una fecha construida en hora local, de modo que el
 * aviso podía salir el día equivocado según dónde estuviera desplegado el backend.
 */
export async function enviarRecordatorios(): Promise<number> {
  // Ventana amplia por fecha de calendario (indexada) y filtro fino por zona después.
  const hoyUTC = fechaISO(new Date());
  const reservas = await prisma.reservacion.findMany({
    where: {
      fecha: { gte: fechaUTC(sumarDias(hoyUTC, -1)), lte: fechaUTC(sumarDias(hoyUTC, 2)) },
      estadoCita: "confirmada",
      pagoReservaStatus: "pagado",
      OR: [{ recordatorioEnviadoEn: null }, { recordatorioCortoEn: null }],
    },
    include: {
      cliente: { select: { nombre: true, email: true } },
      peluquero: {
        select: {
          nombre: true,
          membresias: {
            where: { estadoAprobacion: "aceptado" },
            select: { negocio: { select: { timezone: true } } },
            take: 1,
          },
        },
      },
      servicio: { select: { nombreServicio: true } },
    },
  });

  let enviados = 0;
  for (const r of reservas) {
    const tz = r.peluquero.membresias[0]?.negocio.timezone ?? env.timezoneDefecto;
    const fecha = fechaISO(r.fecha);
    const horas = horasHasta(fecha, r.horaInicio, tz);
    if (horas <= 0) continue; // ya pasó

    // 1) Recordatorio de 24 h (ventana 20-28 h para no depender del minuto exacto).
    const toca24 = !r.recordatorioEnviadoEn && horas <= 28 && horas >= 20;
    // 2) Recordatorio corto.
    const h = env.recordatorioCortoHoras;
    const tocaCorto = h > 0 && !r.recordatorioCortoEn && horas <= h;

    if (!toca24 && !tocaCorto) continue;

    const tpl = emailRecordatorio({
      nombre: r.cliente.nombre,
      profesional: r.peluquero.nombre,
      servicio: r.servicio.nombreServicio,
      fecha,
      hora: r.horaInicio,
      cuando: tocaCorto ? Math.max(1, Math.round(horas)) : "manana",
    });

    try {
      await enviarEmail({ to: r.cliente.email, subject: tpl.subject, html: tpl.html });
      await prisma.reservacion.update({
        where: { id: r.id },
        data: tocaCorto ? { recordatorioCortoEn: new Date() } : { recordatorioEnviadoEn: new Date() },
      });
      enviados++;
    } catch (e) {
      logger.warn({ err: e, reservaId: r.id }, "no se pudo enviar recordatorio");
    }
  }
  if (enviados > 0) logger.info(`[job] ${enviados} recordatorio(s) enviado(s)`);
  return enviados;
}

/** Utilidad expuesta para diagnóstico: hora de pared actual en una zona. */
export const ahoraEn = ahoraEnZona;

let timer: NodeJS.Timeout | null = null;

// Cada 20 minutos: suficiente para que el recordatorio corto sea puntual.
export function iniciarJobRecordatorios(intervaloMs = 20 * 60 * 1000) {
  if (timer) return;
  enviarRecordatorios().catch((e) => logger.error({ err: e }, "job recordatorios"));
  timer = setInterval(() => {
    enviarRecordatorios().catch((e) => logger.error({ err: e }, "job recordatorios"));
  }, intervaloMs);
  timer.unref?.();
}

export function detenerJobRecordatorios() {
  if (timer) clearInterval(timer);
  timer = null;
}
