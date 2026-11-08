import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { toMinutes, fechaISO, horasHasta } from "./time.js";
import { enviarEmailSeguro, emailHuecoLibre } from "./email.js";

// Lista de espera: cuando una cita se cae (cancelada por el cliente, por el
// negocio o por impago), el hueco vuelve a estar libre. Antes se quedaba muerto
// salvo que alguien recargara la página en ese momento.
//
// El hueco NO se reserva para nadie: se avisa a los primeros de la cola y lo
// coge quien reserve antes. Reservárselo a uno solo lo deja perdido si no
// contesta, y avisar a toda la cola es spam.

interface HuecoLibre {
  peluqueroId: number;
  fecha: Date; // @db.Date en UTC
  horaInicio: string;
  horaFin: string;
  /** Zona del negocio: decide si el hueco ya pasó. */
  tz: string;
}

/** ¿La franja preferida del cliente se solapa con el hueco que ha quedado libre? */
function encaja(
  espera: { horaDesde: string | null; horaHasta: string | null },
  hueco: { horaInicio: string; horaFin: string },
): boolean {
  // Sin franja declarada, cualquier hora de ese día le sirve.
  if (!espera.horaDesde || !espera.horaHasta) return true;
  return (
    toMinutes(espera.horaDesde) < toMinutes(hueco.horaFin) &&
    toMinutes(hueco.horaInicio) < toMinutes(espera.horaHasta)
  );
}

/**
 * Avisa a los primeros de la cola de que hay un hueco libre.
 * Devuelve a cuántas personas se ha avisado. Nunca lanza: un fallo de email no
 * puede tumbar la cancelación que lo ha disparado.
 */
export async function avisarListaEspera(hueco: HuecoLibre): Promise<number> {
  try {
    // Un hueco que ya pasó no es una oportunidad, es un email absurdo.
    if (horasHasta(fechaISO(hueco.fecha), hueco.horaInicio, hueco.tz) <= 0) return 0;

    const candidatos = await prisma.listaEspera.findMany({
      where: {
        peluqueroId: hueco.peluqueroId,
        fecha: hueco.fecha,
        cancelada: false,
        avisadoEn: null,
      },
      orderBy: { createdAt: "asc" },
      include: {
        cliente: { select: { id: true, nombre: true, email: true } },
        servicio: { select: { nombreServicio: true, duracionMinutos: true } },
        peluquero: { select: { nombre: true } },
      },
      // Se piden más de los necesarios porque algunos se descartan por franja.
      take: env.esperaAvisosPorHueco * 4,
    });

    const elegidos = candidatos.filter((c) => encaja(c, hueco)).slice(0, env.esperaAvisosPorHueco);
    if (!elegidos.length) return 0;

    const negocio = await prisma.peluqueroEquipo.findFirst({
      where: { usuarioId: hueco.peluqueroId, estadoAprobacion: "aceptado" },
      include: { negocio: { select: { nombreComercial: true, slug: true } } },
    });

    const fechaStr = fechaISO(hueco.fecha);
    for (const espera of elegidos) {
      const tpl = emailHuecoLibre({
        nombre: espera.cliente.nombre,
        negocio: negocio?.negocio.nombreComercial ?? "el negocio",
        profesional: espera.peluquero.nombre,
        servicio: espera.servicio.nombreServicio,
        fecha: fechaStr,
        hora: hueco.horaInicio,
        url: negocio ? `${env.appUrl}/negocio/${negocio.negocio.slug}` : env.appUrl,
      });
      await enviarEmailSeguro({ to: espera.cliente.email, subject: tpl.subject, html: tpl.html });
    }

    await prisma.listaEspera.updateMany({
      where: { id: { in: elegidos.map((e) => e.id) } },
      data: { avisadoEn: new Date() },
    });

    logger.info(
      { peluqueroId: hueco.peluqueroId, fecha: fechaStr, avisados: elegidos.length },
      "lista de espera avisada",
    );
    return elegidos.length;
  } catch (err) {
    logger.error({ err }, "fallo al avisar a la lista de espera");
    return 0;
  }
}
