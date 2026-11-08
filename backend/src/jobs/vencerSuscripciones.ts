import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { enviarEmailSeguro, emailSuscripcionVencida } from "../lib/email.js";
import { auditar } from "../lib/audit.js";

/**
 * Marca como `vencido` todo negocio cuya suscripción (o prueba de 14 días) ya pasó.
 *
 * Sin este job, `suscripcionHasta` se escribía pero nunca se leía: las pruebas eran
 * infinitas y ningún negocio dejaba de ser visible por no pagar.
 *
 * Avisa por email al dueño (best-effort) para que pueda reactivar.
 */
export async function vencerSuscripciones(): Promise<number> {
  const caducados = await prisma.negocio.findMany({
    where: {
      estadoSuscripcion: { in: ["activo", "prueba"] },
      suscripcionHasta: { not: null, lt: new Date() },
    },
    select: {
      id: true,
      nombreComercial: true,
      estadoSuscripcion: true,
      dueno: { select: { id: true, nombre: true, email: true } },
    },
  });
  if (caducados.length === 0) return 0;

  await prisma.negocio.updateMany({
    where: { id: { in: caducados.map((n) => n.id) } },
    data: { estadoSuscripcion: "vencido" },
  });

  for (const n of caducados) {
    await auditar(
      null,
      "suscripcion_vencida",
      `negocio=${n.id} (${n.nombreComercial}) estadoAnterior=${n.estadoSuscripcion}`,
    );
    const tpl = emailSuscripcionVencida({
      nombre: n.dueno.nombre,
      negocio: n.nombreComercial,
      url: `${env.appUrl}/?suscripcion=renovar`,
    });
    void enviarEmailSeguro({ to: n.dueno.email, subject: tpl.subject, html: tpl.html });
  }

  logger.info(`[job] ${caducados.length} suscripcion(es) vencida(s)`);
  return caducados.length;
}

let timer: NodeJS.Timeout | null = null;

/** Arranca el job (cada hora por defecto). */
export function iniciarJobSuscripciones(intervaloMs = 60 * 60 * 1000) {
  if (timer) return;
  vencerSuscripciones().catch((e) =>
    logger.error({ err: e }, "[job] error venciendo suscripciones"),
  );
  timer = setInterval(() => {
    vencerSuscripciones().catch((e) =>
      logger.error({ err: e }, "[job] error venciendo suscripciones"),
    );
  }, intervaloMs);
  timer.unref?.();
}

export function detenerJobSuscripciones() {
  if (timer) clearInterval(timer);
  timer = null;
}
