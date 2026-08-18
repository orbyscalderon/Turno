import { prisma } from "../lib/prisma.js";
import { enviarEmail, emailRecordatorio } from "../lib/email.js";
import { logger } from "../lib/logger.js";

/**
 * Envía recordatorios por email de las citas confirmadas y pagadas que ocurren mañana.
 * Marca recordatorioEnviadoEn para no duplicar.
 */
export async function enviarRecordatorios(): Promise<number> {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const fecha = new Date(manana.toISOString().slice(0, 10) + "T00:00:00");

  const reservas = await prisma.reservacion.findMany({
    where: {
      fecha,
      estadoCita: "confirmada",
      pagoReservaStatus: "pagado",
      recordatorioEnviadoEn: null,
    },
    include: {
      cliente: { select: { nombre: true, email: true } },
      peluquero: { select: { nombre: true } },
      servicio: { select: { nombreServicio: true } },
    },
  });

  let enviados = 0;
  for (const r of reservas) {
    const tpl = emailRecordatorio({
      nombre: r.cliente.nombre,
      profesional: r.peluquero.nombre,
      servicio: r.servicio.nombreServicio,
      fecha: r.fecha.toISOString().slice(0, 10),
      hora: r.horaInicio,
    });
    try {
      await enviarEmail({ to: r.cliente.email, subject: tpl.subject, html: tpl.html });
      await prisma.reservacion.update({ where: { id: r.id }, data: { recordatorioEnviadoEn: new Date() } });
      enviados++;
    } catch (e) {
      logger.warn({ err: e, reservaId: r.id }, "no se pudo enviar recordatorio");
    }
  }
  if (enviados > 0) logger.info(`[job] ${enviados} recordatorio(s) enviado(s)`);
  return enviados;
}

let timer: NodeJS.Timeout | null = null;

// Corre cada 6 horas (suficiente para recordatorios del día siguiente).
export function iniciarJobRecordatorios(intervaloMs = 6 * 60 * 60 * 1000) {
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
