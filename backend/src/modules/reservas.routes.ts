import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  toMinutes,
  toHHMM,
  diaSemanaDeFecha,
  fechaUTC,
  fechaISO,
  horasHasta,
  ahoraEnZona,
  sumarDias,
} from "../lib/time.js";
import { calcularSlotsLibres, intervaloDisponible, zonaDelPeluquero } from "./slots.service.js";
import { paymentProvider } from "./pagos.provider.js";
import { generarCodigoValidacion } from "../lib/codes.js";
import { generarLinkWhatsApp, enviarWhatsApp } from "../lib/whatsapp.js";
import { calcularSplitFianza } from "../lib/split.js";
import {
  enviarEmailSeguro,
  emailConfirmacionReserva,
  emailNuevaReservaPro,
  emailCancelacionNegocio,
  emailCitaCompletada,
} from "../lib/email.js";
import { lockAgenda } from "../lib/locks.js";
import { avisarListaEspera } from "../lib/espera.js";
import { marcarEventoNuevo } from "../lib/webhooks.js";
import { filtroNegocioVigente } from "../lib/suscripcion.js";
import { auditar } from "../lib/audit.js";
import { paginationSchema, paginar, metaPaginacion } from "../lib/pagination.js";

export const reservasRouter = Router();

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora debe ser HH:MM");

// Roles que pueden actuar como cliente. Un dueño o un profesional también son
// clientes de otros negocios: antes necesitaban una segunda cuenta para reservar.
const ROLES_CLIENTE = ["cliente", "admin_negocio", "peluquero"] as const;
// Roles que pueden cerrar/gestionar una cita desde el lado del negocio.
const ROLES_NEGOCIO = ["peluquero", "admin_negocio"] as const;

/** El error del índice único de slot confirmado se traduce a un 409 claro. */
function esSlotDuplicado(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String(e.meta?.target ?? "").includes("slot_confirmado")
  );
}

/**
 * Comprueba que el usuario puede gestionar la cita desde el lado del negocio:
 * o es el profesional de la cita, o es dueño de un negocio donde ese profesional
 * está aceptado (o superadmin).
 */
async function assertGestorDeCita(
  reserva: { peluqueroId: number },
  user: { sub: number; rol: string },
): Promise<void> {
  if (user.rol === "superadmin") return;
  if (reserva.peluqueroId === user.sub) return;
  const esDueno = await prisma.peluqueroEquipo.findFirst({
    where: {
      usuarioId: reserva.peluqueroId,
      estadoAprobacion: "aceptado",
      negocio: { duenoId: user.sub },
    },
    select: { id: true },
  });
  if (!esDueno) throw Forbidden("Esta cita no pertenece a tu negocio");
}

/** Datos del negocio vigente del profesional (o null si no tiene ninguno activo). */
async function negocioVigenteDe(peluqueroId: number, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const membresia = await db.peluqueroEquipo.findFirst({
    where: {
      usuarioId: peluqueroId,
      estadoAprobacion: "aceptado",
      negocio: filtroNegocioVigente(),
    },
    include: {
      negocio: {
        select: {
          id: true,
          nombreComercial: true,
          timezone: true,
          stripeConnectAccountId: true,
          cobrosActivos: true,
        },
      },
    },
  });
  return membresia?.negocio ?? null;
}

// ---------- Desglose de cómo se reparte la fianza ----------
// Autenticado: la estructura de comisiones de la plataforma no es información pública.
reservasRouter.get(
  "/split",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(calcularSplitFianza());
  }),
);

// ---------- Consultar slots libres (público) ----------
reservasRouter.get(
  "/slots",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        peluqueroId: z.coerce.number().int().positive(),
        servicioId: z.coerce.number().int().positive(),
        fecha: FECHA,
      })
      .parse(req.query);

    const resultado = await calcularSlotsLibres({
      peluqueroId: query.peluqueroId,
      servicioId: query.servicioId,
      fechaISO: query.fecha,
    });
    res.json(resultado);
  }),
);

// ---------- Crear reserva => slot bloqueado + intento de pago ----------
const crearReservaSchema = z.object({
  peluqueroId: z.number().int().positive(),
  servicioId: z.number().int().positive(),
  fecha: FECHA,
  horaInicio: HORA,
});

reservasRouter.post(
  "/",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    const data = crearReservaSchema.parse(req.body);
    const clienteId = req.user!.sub;

    // Email confirmado (si así está configurado): evita reservas de cuentas falsas.
    if (env.exigirEmailVerificado) {
      const yo = await prisma.usuario.findUnique({
        where: { id: clienteId },
        select: { emailVerificadoEn: true },
      });
      if (!yo?.emailVerificadoEn) {
        throw Forbidden("Confirma tu email antes de reservar. Revisa tu bandeja de entrada.");
      }
    }

    // Tope de reservas sin pagar: sin esto, un cliente podía crear reservas en
    // bucle y mantener bloqueada la agenda de un negocio sin pagar nada.
    const pendientes = await prisma.reservacion.count({
      where: {
        clienteId,
        estadoCita: "confirmada",
        pagoReservaStatus: "pendiente",
        expiraPagoEn: { gt: new Date() },
      },
    });
    if (pendientes >= env.maxReservasPendientes) {
      throw Conflict(
        `Tienes ${pendientes} reserva(s) pendientes de pago. Complétalas o espera a que caduquen.`,
        "DEMASIADAS_PENDIENTES",
      );
    }

    // El negocio del profesional marca la zona horaria y debe estar vigente.
    const negocio = await negocioVigenteDe(data.peluqueroId);
    if (!negocio) throw Forbidden("El peluquero no está disponible para reservas");
    const tz = negocio.timezone;

    // Validaciones de calendario en la zona del NEGOCIO (no del servidor).
    const horas = horasHasta(data.fecha, data.horaInicio, tz);
    if (horas <= 0) throw BadRequest("No puedes reservar en un horario pasado");
    if (horas < env.antelacionMinimaHoras) {
      throw BadRequest(
        `Las reservas requieren al menos ${env.antelacionMinimaHoras} h de antelación`,
        "ANTELACION_MINIMA",
      );
    }
    const limite = sumarDias(ahoraEnZona(tz).fechaISO, env.horizonteReservaDias);
    if (data.fecha > limite) {
      throw BadRequest(
        `Solo se puede reservar hasta ${env.horizonteReservaDias} días por adelantado`,
        "FUERA_DE_HORIZONTE",
      );
    }

    let resultadoTx;
    try {
      resultadoTx = await prisma.$transaction(async (tx) => {
        // Serializa por (profesional, día) aunque todavía no haya ninguna fila:
        // el FOR UPDATE anterior no bloqueaba nada en la primera reserva del día.
        await lockAgenda(tx, data.peluqueroId, data.fecha);

        const servicio = await tx.servicio.findUnique({ where: { id: data.servicioId } });
        if (!servicio || !servicio.activo) throw NotFound("Servicio no disponible");
        if (servicio.peluqueroId !== data.peluqueroId) {
          throw BadRequest("El servicio no pertenece a ese peluquero");
        }

        const fecha = fechaUTC(data.fecha);
        const inicioMin = toMinutes(data.horaInicio);
        const finMin = inicioMin + servicio.duracionMinutos;
        if (finMin > 24 * 60) throw BadRequest("El servicio no cabe antes de medianoche");
        const horaFin = toHHMM(finMin);

        // Debe caer dentro de un rango de disponibilidad de ese día.
        const dia = diaSemanaDeFecha(data.fecha);
        const rangos = await tx.disponibilidad.findMany({
          where: { peluqueroId: data.peluqueroId, dia: dia as never },
        });
        const dentroDeRango = rangos.some(
          (r) => inicioMin >= toMinutes(r.horaInicio) && finMin <= toMinutes(r.horaFin),
        );
        if (!dentroDeRango) {
          throw Conflict(
            "El horario está fuera de la disponibilidad del peluquero",
            "FUERA_DE_RANGO",
          );
        }

        // Verificación estricta de colisión contra reservas confirmadas.
        const confirmadas = await tx.reservacion.findMany({
          where: { peluqueroId: data.peluqueroId, fecha, estadoCita: "confirmada" },
          select: { horaInicio: true, horaFin: true },
        });
        const bloqueos = confirmadas.map((r) => ({
          inicio: toMinutes(r.horaInicio),
          fin: toMinutes(r.horaFin),
        }));

        // Bloqueos de agenda del profesional (descanso/vacaciones).
        const bloqueosAgenda = await tx.bloqueo.findMany({
          where: { peluqueroId: data.peluqueroId, fecha },
          select: { horaInicio: true, horaFin: true },
        });
        for (const b of bloqueosAgenda) {
          bloqueos.push(
            b.horaInicio && b.horaFin
              ? { inicio: toMinutes(b.horaInicio), fin: toMinutes(b.horaFin) }
              : { inicio: 0, fin: 24 * 60 },
          );
        }

        if (!intervaloDisponible(inicioMin, finMin, bloqueos)) {
          throw Conflict("Ese horario no está disponible (reservado o bloqueado)", "SLOT_OCUPADO");
        }

        // ¿Tiene un bono prepagado para este servicio? Entonces no hay fianza:
        // el cliente ya pagó el paquete en el local y aquí solo se descuenta
        // una sesión. Se elige el que caduca antes para no desperdiciarlo.
        const bono = await tx.bonoCliente.findFirst({
          where: {
            clienteId,
            paquete: { servicioId: data.servicioId, activo: true },
            OR: [{ expiraEn: null }, { expiraEn: { gt: new Date() } }],
          },
          orderBy: [{ expiraEn: "asc" }, { createdAt: "asc" }],
          select: { id: true, sesionesTotales: true, sesionesUsadas: true },
        });
        const bonoUtil = bono && bono.sesionesUsadas < bono.sesionesTotales ? bono : null;

        if (bonoUtil) {
          // Incremento condicional: si dos reservas simultáneas intentaran gastar
          // la última sesión, solo una vería count=1.
          const gastado = await tx.bonoCliente.updateMany({
            where: { id: bonoUtil.id, sesionesUsadas: bonoUtil.sesionesUsadas },
            data: { sesionesUsadas: { increment: 1 } },
          });
          if (gastado.count !== 1) {
            throw Conflict("El bono se ha actualizado, vuelve a intentarlo", "BONO_EN_USO");
          }
        }

        // Se crea CONFIRMADA para bloquear el slot de inmediato, pero con pago pendiente.
        // Si el pago no llega antes de expiraPagoEn, el job de expiración libera el slot.
        // Con bono no hay hold: expiraPagoEn queda a null para que el job de
        // expiración no pueda cancelarla (la sesión ya está descontada).
        const expiraPagoEn = bonoUtil
          ? null
          : new Date(Date.now() + env.reservaHoldMinutos * 60 * 1000);
        const nueva = await tx.reservacion.create({
          data: {
            clienteId,
            peluqueroId: data.peluqueroId,
            servicioId: data.servicioId,
            fecha,
            horaInicio: data.horaInicio,
            horaFin,
            estadoCita: "confirmada",
            pagoReservaStatus: "pendiente",
            expiraPagoEn,
            bonoId: bonoUtil?.id ?? null,
            codigoValidacion: generarCodigoValidacion(),
          },
        });
        return { nueva, expiraPagoEn, bonoId: bonoUtil?.id ?? null };
      });
    } catch (e) {
      // El índice único de BD es la última red: si salta, el slot se ocupó a la vez.
      if (esSlotDuplicado(e)) {
        throw Conflict("Ese horario acaba de ser reservado por otra persona", "SLOT_OCUPADO");
      }
      throw e;
    }

    const { nueva: reserva, expiraPagoEn, bonoId } = resultadoTx;

    // Pagada con bono: no se crea intento de pago. Se confirma ya mismo, que
    // envía los emails y el WhatsApp igual que un pago normal.
    if (bonoId) {
      const confirmada = await confirmarReservaPagada(reserva.id);
      return res.status(201).json({
        reserva: {
          id: reserva.id,
          fecha: data.fecha,
          horaInicio: reserva.horaInicio,
          horaFin: reserva.horaFin,
          estadoCita: "confirmada",
          pagoReservaStatus: "pagado",
          codigoValidacion: reserva.codigoValidacion,
          expiraPagoEn: null,
          timezone: tz,
          negocio: negocio.nombreComercial,
        },
        pago: null,
        bono: { id: bonoId, usado: true },
        whatsappUrl: confirmada.whatsappUrl,
      });
    }

    // Split de la fianza (contando la comisión real de Stripe): si el negocio tiene cobros
    // activos (Stripe Connect), su parte va a su cuenta y la plataforma retiene el application fee.
    const conSplit = negocio.cobrosActivos && negocio.stripeConnectAccountId;
    const split = calcularSplitFianza();
    const intento = await paymentProvider.crearIntento({
      reservaId: reserva.id,
      montoUsd: split.montoCobradoUsd,
      clienteEmail: req.user!.email,
      destinoConnectId: conSplit ? negocio.stripeConnectAccountId! : undefined,
      comisionUsd: conSplit ? split.applicationFeeUsd : undefined,
    });

    await prisma.reservacion.update({
      where: { id: reserva.id },
      data: { idTransaccionPasarela: intento.transaccionId },
    });

    res.status(201).json({
      reserva: {
        id: reserva.id,
        fecha: data.fecha,
        horaInicio: reserva.horaInicio,
        horaFin: reserva.horaFin,
        estadoCita: reserva.estadoCita,
        pagoReservaStatus: reserva.pagoReservaStatus,
        codigoValidacion: reserva.codigoValidacion,
        // El frontend muestra la cuenta atrás del hold con este dato.
        expiraPagoEn,
        timezone: tz,
        negocio: negocio.nombreComercial,
      },
      pago: {
        provider: intento.provider,
        transaccionId: intento.transaccionId,
        clientSecret: intento.clientSecret,
        montoUsd: intento.montoUsd,
        // Desglose completo del reparto (fianza = Stripe + Turno + negocio).
        split: conSplit
          ? {
              alNegocioUsd: split.alNegocioUsd,
              turnoNetoUsd: split.turnoNetoUsd,
              feeStripeUsd: split.feeStripeUsd,
              reparto: split.reparto,
            }
          : {
              alNegocioUsd: 0,
              turnoNetoUsd: Number((env.fianzaUsd - split.feeStripeUsd).toFixed(2)),
              feeStripeUsd: split.feeStripeUsd,
              reparto: "plataforma",
            },
      },
    });
  }),
);

interface ResultadoConfirmacion {
  estado: "confirmada" | "reembolsada";
  whatsappUrl: string | null;
  yaConfirmada?: boolean;
}

/**
 * Marca la reserva como pagada/confirmada, arma el WhatsApp y envía los emails.
 *
 * Es IDEMPOTENTE (Stripe reintenta y puede repetir eventos) y respeta el hold:
 * si la reserva ya se canceló por falta de pago, el slot pudo revenderse, así que
 * no se "resucita" la cita: se reembolsa el cobro automáticamente.
 */
async function confirmarReservaPagada(reservaId: number): Promise<ResultadoConfirmacion> {
  const reserva = await prisma.reservacion.findUnique({
    where: { id: reservaId },
    include: {
      cliente: { select: { nombre: true, email: true, telefono: true } },
      peluquero: { select: { nombre: true, email: true, telefono: true } },
      servicio: { select: { nombreServicio: true } },
    },
  });
  if (!reserva) throw NotFound("Reserva no encontrada");

  const fecha = fechaISO(reserva.fecha);

  const whatsappDe = (codigo: string) =>
    generarLinkWhatsApp({
      telefonoDestino: reserva.peluquero.telefono,
      nombreProfesional: reserva.peluquero.nombre,
      nombreServicio: reserva.servicio.nombreServicio,
      fecha,
      hora: reserva.horaInicio,
      codigoValidacion: codigo,
    });

  // Ya estaba pagada: no repetir avisos (reintento de webhook).
  if (reserva.pagoReservaStatus === "pagado") {
    return {
      estado: "confirmada",
      whatsappUrl: whatsappDe(reserva.codigoValidacion),
      yaConfirmada: true,
    };
  }

  // El hold expiró y la reserva ya se liberó: devolver el dinero en vez de
  // confirmar una cita cuyo horario puede estar vendido a otra persona.
  if (reserva.estadoCita !== "confirmada") {
    if (reserva.idTransaccionPasarela) {
      const reembolso = await paymentProvider.reembolsar(reserva.idTransaccionPasarela);
      await prisma.reservacion.update({
        where: { id: reserva.id },
        data: reembolso.ok
          ? { pagoReservaStatus: "reembolsado", idReembolsoPasarela: reembolso.reembolsoId }
          : { pagoReservaStatus: "pagado" },
      });
    }
    await auditar(
      null,
      "pago_tardio_reembolsado",
      `reserva=${reserva.id} estado=${reserva.estadoCita}`,
    );
    return { estado: "reembolsada", whatsappUrl: null };
  }

  const actualizada = await prisma.reservacion.update({
    where: { id: reserva.id },
    data: { pagoReservaStatus: "pagado", estadoCita: "confirmada", expiraPagoEn: null },
  });

  const negocio = await prisma.peluqueroEquipo.findFirst({
    where: { usuarioId: reserva.peluqueroId, estadoAprobacion: "aceptado" },
    select: { negocio: { select: { nombreComercial: true } } },
  });

  const tpl = emailConfirmacionReserva({
    nombre: reserva.cliente.nombre,
    negocio: negocio?.negocio.nombreComercial ?? "tu negocio en Turno",
    profesional: reserva.peluquero.nombre,
    servicio: reserva.servicio.nombreServicio,
    fecha,
    hora: actualizada.horaInicio,
    codigo: actualizada.codigoValidacion,
  });
  void enviarEmailSeguro({ to: reserva.cliente.email, subject: tpl.subject, html: tpl.html });

  // Aviso al PROFESIONAL de la nueva reserva (best-effort).
  const tplPro = emailNuevaReservaPro({
    profesional: reserva.peluquero.nombre,
    cliente: reserva.cliente.nombre,
    servicio: reserva.servicio.nombreServicio,
    fecha,
    hora: actualizada.horaInicio,
  });
  void enviarEmailSeguro({
    to: reserva.peluquero.email,
    subject: tplPro.subject,
    html: tplPro.html,
  });

  // Envío AUTOMÁTICO por WhatsApp Cloud API al cliente (si WHATSAPP_PROVIDER=cloud).
  void enviarWhatsApp({
    telefonoDestino: reserva.cliente.telefono,
    nombreProfesional: reserva.peluquero.nombre,
    nombreServicio: reserva.servicio.nombreServicio,
    fecha,
    hora: actualizada.horaInicio,
    codigoValidacion: actualizada.codigoValidacion,
  }).catch(() => {});

  return { estado: "confirmada", whatsappUrl: whatsappDe(actualizada.codigoValidacion) };
}

// ---------- Confirmar pago (modo mock/paypal-stub): AUTENTICADO y sobre la reserva propia ----------
reservasRouter.post(
  "/:id/pagar",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    if (env.paymentProvider !== "mock") {
      throw BadRequest(
        "Con una pasarela real el pago se confirma en la pasarela, no aquí",
        env.paymentProvider === "stripe" ? "USE_STRIPE" : "USE_PAYPAL",
      );
    }
    const id = Number(req.params.id);
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    if (reserva.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");
    if (reserva.pagoReservaStatus === "pagado") {
      return res.json({ ok: true, estado: "confirmada", yaConfirmada: true });
    }
    if (reserva.estadoCita !== "confirmada") throw BadRequest("La reserva ya no está activa");

    const r = await confirmarReservaPagada(id);
    res.json({ ok: true, estado: r.estado, whatsappUrl: r.whatsappUrl });
  }),
);

// ---------- Webhook REAL de la pasarela (Stripe): fuente de verdad del pago ----------
// Solo procesa con firma válida y una sola vez por evento (idempotencia en BD).
reservasRouter.post(
  "/webhook/pago",
  asyncHandler(async (req, res) => {
    if (env.paymentProvider === "mock") {
      throw Forbidden("En modo mock el pago se confirma con el endpoint autenticado /:id/pagar");
    }
    const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body ?? {});
    const signature = req.headers["stripe-signature"] as string | undefined;

    const evento = await paymentProvider.verificarWebhook(rawBody, signature, req.headers);
    if (!evento) throw BadRequest("Webhook inválido o firma incorrecta", "WEBHOOK_INVALIDO");

    // Idempotencia: la pasarela reintenta hasta recibir 2xx y puede repetir eventos.
    if (evento.eventoId) {
      const nuevo = await marcarEventoNuevo(
        env.paymentProvider,
        evento.eventoId,
        evento.tipo ?? "desconocido",
      );
      if (!nuevo) return res.json({ ok: true, duplicado: true });
    }

    const reserva = await prisma.reservacion.findFirst({
      where: { idTransaccionPasarela: evento.transaccionId },
    });
    // 200 aunque no exista: si no, Stripe reintentaría para siempre un pago huérfano.
    if (!reserva) return res.json({ ok: true, ignorado: "reserva no encontrada" });

    if (!evento.pagado) {
      // Solo cancelar si sigue pendiente: un `payment_failed` posterior no debe
      // tumbar una cita ya pagada (p. ej. reintento con otra tarjeta).
      if (reserva.pagoReservaStatus === "pendiente" && reserva.estadoCita === "confirmada") {
        await prisma.reservacion.update({
          where: { id: reserva.id },
          data: {
            estadoCita: "cancelada",
            canceladaEn: new Date(),
            canceladaPor: "sistema",
            motivoCancelacion: "Pago rechazado por la pasarela",
          },
        });
      }
      return res.json({ ok: true, estado: "cancelada" });
    }

    const r = await confirmarReservaPagada(reserva.id);
    res.json({ ok: true, estado: r.estado, whatsappUrl: r.whatsappUrl });
  }),
);

// ---------- Capturar el pago tras la aprobación del cliente (PayPal) ----------
// PayPal usa redirección: el cliente aprueba en su web, vuelve a /pago/paypal/:id
// y el frontend llama aquí para cobrar. El webhook es la confirmación definitiva,
// así que esta ruta es segura de reintentar (confirmarReservaPagada es idempotente).
reservasRouter.post(
  "/:id/capturar",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    if (!paymentProvider.capturar) {
      throw BadRequest("Este proveedor de pago no requiere captura", "SIN_CAPTURA");
    }
    const id = Number(req.params.id);
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    if (reserva.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");
    if (reserva.pagoReservaStatus === "pagado") {
      return res.json({ ok: true, estado: "confirmada", yaConfirmada: true });
    }
    if (!reserva.idTransaccionPasarela) throw BadRequest("La reserva no tiene pago asociado");

    const captura = await paymentProvider.capturar(reserva.idTransaccionPasarela);
    if (!captura.pagado)
      throw BadRequest("El pago no se completó en la pasarela", "PAGO_NO_COMPLETADO");

    const r = await confirmarReservaPagada(id);
    res.json({ ok: true, estado: r.estado, whatsappUrl: r.whatsappUrl });
  }),
);

// ---------- Historial de reservas del cliente ----------
reservasRouter.get(
  "/mias",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    const where = { clienteId: req.user!.sub };

    const [total, reservas] = await Promise.all([
      prisma.reservacion.count({ where }),
      prisma.reservacion.findMany({
        where,
        include: {
          peluquero: { select: { nombre: true, telefono: true } },
          servicio: { select: { nombreServicio: true, precio: true, moneda: true } },
        },
        orderBy: [{ fecha: "desc" }, { horaInicio: "desc" }],
        ...paginar(page, limit),
      }),
    ]);

    const data = reservas.map((r) => {
      const fecha = fechaISO(r.fecha);
      return {
        id: r.id,
        fecha,
        horaInicio: r.horaInicio,
        horaFin: r.horaFin,
        estadoCita: r.estadoCita,
        pagoReservaStatus: r.pagoReservaStatus,
        codigoValidacion: r.codigoValidacion,
        expiraPagoEn: r.expiraPagoEn,
        canceladaPor: r.canceladaPor,
        motivoCancelacion: r.motivoCancelacion,
        peluqueroId: r.peluqueroId,
        servicioId: r.servicioId,
        peluquero: r.peluquero.nombre,
        servicio: r.servicio.nombreServicio,
        precio: r.servicio.precio,
        moneda: r.servicio.moneda,
        whatsappUrl:
          r.pagoReservaStatus === "pagado"
            ? generarLinkWhatsApp({
                telefonoDestino: r.peluquero.telefono,
                nombreProfesional: r.peluquero.nombre,
                nombreServicio: r.servicio.nombreServicio,
                fecha,
                hora: r.horaInicio,
                codigoValidacion: r.codigoValidacion,
              })
            : null,
      };
    });

    res.json({ reservas: data, meta: metaPaginacion(total, page, limit) });
  }),
);

// ---------- Agenda del peluquero (sus citas) ----------
reservasRouter.get(
  "/agenda",
  requireAuth,
  requireRole(...ROLES_NEGOCIO),
  asyncHandler(async (req, res) => {
    const q = z
      .object({ desde: FECHA.optional(), hasta: FECHA.optional() })
      .merge(paginationSchema.partial())
      .parse(req.query);
    const limit = Math.min(q.limit ?? 200, 500);

    const where: Prisma.ReservacionWhereInput = { peluqueroId: req.user!.sub };
    if (q.desde || q.hasta) {
      where.fecha = {
        ...(q.desde ? { gte: fechaUTC(q.desde) } : {}),
        ...(q.hasta ? { lte: fechaUTC(q.hasta) } : {}),
      };
    }

    const reservas = await prisma.reservacion.findMany({
      where,
      include: {
        cliente: { select: { nombre: true, telefono: true } },
        servicio: { select: { nombreServicio: true, duracionMinutos: true } },
      },
      orderBy: [{ fecha: "asc" }, { horaInicio: "asc" }],
      take: limit,
    });

    res.json({
      reservas: reservas.map((r) => ({ ...r, fecha: fechaISO(r.fecha) })),
      timezone: await zonaDelPeluquero(req.user!.sub),
    });
  }),
);

// ---------- Ingresos del profesional: desglose de lo que generó ----------
reservasRouter.get(
  "/mis-ingresos",
  requireAuth,
  requireRole(...ROLES_NEGOCIO),
  asyncHandler(async (req, res) => {
    const peluqueroId = req.user!.sub;
    const hoy = new Date();
    const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const desde =
      typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde)
        ? fechaUTC(req.query.desde)
        : inicioMes;

    const split = calcularSplitFianza();
    const [pagadas, totalHistorico, completadas] = await Promise.all([
      prisma.reservacion.findMany({
        where: { peluqueroId, pagoReservaStatus: "pagado", createdAt: { gte: desde } },
        include: { servicio: { select: { nombreServicio: true, precio: true, moneda: true } } },
        orderBy: [{ fecha: "desc" }, { horaInicio: "desc" }],
      }),
      prisma.reservacion.count({ where: { peluqueroId, pagoReservaStatus: "pagado" } }),
      prisma.reservacion.count({
        where: { peluqueroId, estadoCita: "completada", completadaEn: { gte: desde } },
      }),
    ]);

    // Valor de servicios generado, agrupado por moneda.
    const porMoneda = new Map<string, number>();
    const propinasPorMoneda = new Map<string, number>();
    let conBono = 0;
    for (const r of pagadas) {
      const m = r.servicio.moneda || "USD";
      porMoneda.set(m, Number(((porMoneda.get(m) ?? 0) + Number(r.servicio.precio)).toFixed(2)));
      if (r.propina) {
        propinasPorMoneda.set(
          m,
          Number(((propinasPorMoneda.get(m) ?? 0) + Number(r.propina)).toFixed(2)),
        );
      }
      if (r.bonoId) conBono++;
    }

    res.json({
      desde: fechaISO(desde),
      reservasPagadas: pagadas.length,
      citasCompletadas: completadas,
      totalHistorico,
      fianzaNegocioUsd: Number((pagadas.length * split.alNegocioUsd).toFixed(2)),
      fianzaPorReservaUsd: split.alNegocioUsd,
      valorServicios: Array.from(porMoneda.entries()).map(([moneda, total]) => ({ moneda, total })),
      // Las propinas se cobran en el local; aquí solo se reflejan las registradas
      // al cerrar la cita, así que son un mínimo, no el total real.
      propinas: Array.from(propinasPorMoneda.entries()).map(([moneda, total]) => ({
        moneda,
        total,
      })),
      // Reservas pagadas con bono: no generan fianza, por eso se cuentan aparte.
      reservasConBono: conBono,
      reservas: pagadas.map((r) => ({
        id: r.id,
        fecha: fechaISO(r.fecha),
        servicio: r.servicio.nombreServicio,
        precio: r.servicio.precio,
        moneda: r.servicio.moneda,
        propina: r.propina,
        conBono: Boolean(r.bonoId),
      })),
    });
  }),
);

// ---------- Cancelar reserva (cliente dueño de la cita) + reembolso si procede ----------
reservasRouter.patch(
  "/:id/cancelar",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    if (reserva.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");
    if (reserva.estadoCita !== "confirmada") {
      throw BadRequest("Solo se pueden cancelar reservas confirmadas");
    }

    // Política de cancelación evaluada en la zona del negocio.
    const tz = await zonaDelPeluquero(reserva.peluqueroId);
    const horasDeAntelacion = horasHasta(fechaISO(reserva.fecha), reserva.horaInicio, tz);
    const dentroDeVentana = horasDeAntelacion >= env.cancelacionHorasReembolso;

    let reembolso: { reembolsoId: string; ok: boolean } | null = null;
    if (
      dentroDeVentana &&
      reserva.pagoReservaStatus === "pagado" &&
      reserva.idTransaccionPasarela
    ) {
      reembolso = await paymentProvider.reembolsar(reserva.idTransaccionPasarela);
    }

    const actualizada = await prisma.reservacion.update({
      where: { id },
      data: {
        estadoCita: "cancelada",
        canceladaEn: new Date(),
        canceladaPor: "cliente",
        ...(reembolso?.ok
          ? { pagoReservaStatus: "reembolsado", idReembolsoPasarela: reembolso.reembolsoId }
          : {}),
      },
    });

    // Si se pagó con bono, la sesión vuelve al cliente cuando cancela con la
    // antelación pactada. Fuera de plazo se pierde, igual que la fianza.
    let sesionDevuelta = false;
    if (reserva.bonoId && dentroDeVentana) {
      const devuelta = await prisma.bonoCliente.updateMany({
        where: { id: reserva.bonoId, sesionesUsadas: { gt: 0 } },
        data: { sesionesUsadas: { decrement: 1 } },
      });
      sesionDevuelta = devuelta.count === 1;
    }

    await auditar(
      req.user!.sub,
      "reserva_cancelada_cliente",
      `reserva=${id} reembolso=${reembolso?.ok ?? false} bono_devuelto=${sesionDevuelta}`,
    );

    // El hueco vuelve a estar libre: avisa a la lista de espera de ese día.
    void avisarListaEspera({
      peluqueroId: reserva.peluqueroId,
      fecha: reserva.fecha,
      horaInicio: reserva.horaInicio,
      horaFin: reserva.horaFin,
      tz,
    });
    res.json({
      reserva: { ...actualizada, fecha: fechaISO(actualizada.fecha) },
      reembolsado: reembolso?.ok ?? false,
      sesionBonoDevuelta: sesionDevuelta,
      politica: dentroDeVentana
        ? undefined
        : `Sin reembolso: se requiere cancelar con al menos ${env.cancelacionHorasReembolso}h de antelación`,
    });
  }),
);

// ---------- Reprogramar reserva (cliente) con verificación anti-colisión ----------
const reprogramarSchema = z.object({ fecha: FECHA, horaInicio: HORA });

reservasRouter.patch(
  "/:id/reprogramar",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = reprogramarSchema.parse(req.body);

    const previa = await prisma.reservacion.findUnique({ where: { id } });
    if (!previa) throw NotFound("Reserva no encontrada");
    if (previa.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");

    const tz = await zonaDelPeluquero(previa.peluqueroId);
    if (horasHasta(data.fecha, data.horaInicio, tz) <= 0) {
      throw BadRequest("No puedes reprogramar a un horario pasado");
    }

    let actualizada;
    try {
      actualizada = await prisma.$transaction(async (tx) => {
        await lockAgenda(tx, previa.peluqueroId, data.fecha);

        const reserva = await tx.reservacion.findUnique({ where: { id } });
        if (!reserva) throw NotFound("Reserva no encontrada");
        if (reserva.estadoCita !== "confirmada") {
          throw BadRequest("Solo se reprograman reservas confirmadas");
        }

        const fecha = fechaUTC(data.fecha);
        const servicio = await tx.servicio.findUnique({ where: { id: reserva.servicioId } });
        const inicioMin = toMinutes(data.horaInicio);
        const finMin = inicioMin + (servicio?.duracionMinutos ?? 30);
        if (finMin > 24 * 60) throw BadRequest("El servicio no cabe antes de medianoche");
        const horaFin = toHHMM(finMin);

        // Dentro de disponibilidad.
        const dia = diaSemanaDeFecha(data.fecha);
        const rangos = await tx.disponibilidad.findMany({
          where: { peluqueroId: reserva.peluqueroId, dia: dia as never },
        });
        const dentro = rangos.some(
          (r) => inicioMin >= toMinutes(r.horaInicio) && finMin <= toMinutes(r.horaFin),
        );
        if (!dentro) throw Conflict("Fuera de la disponibilidad del profesional", "FUERA_DE_RANGO");

        // Colisión contra otras reservas confirmadas (excluyendo esta) + bloqueos.
        const confirmadas = await tx.reservacion.findMany({
          where: {
            peluqueroId: reserva.peluqueroId,
            fecha,
            estadoCita: "confirmada",
            id: { not: id },
          },
          select: { horaInicio: true, horaFin: true },
        });
        const bloqueos = confirmadas.map((r) => ({
          inicio: toMinutes(r.horaInicio),
          fin: toMinutes(r.horaFin),
        }));
        const bloqueosAgenda = await tx.bloqueo.findMany({
          where: { peluqueroId: reserva.peluqueroId, fecha },
        });
        for (const b of bloqueosAgenda) {
          bloqueos.push(
            b.horaInicio && b.horaFin
              ? { inicio: toMinutes(b.horaInicio), fin: toMinutes(b.horaFin) }
              : { inicio: 0, fin: 1440 },
          );
        }
        if (!intervaloDisponible(inicioMin, finMin, bloqueos)) {
          throw Conflict("Ese horario no está disponible", "SLOT_OCUPADO");
        }

        return tx.reservacion.update({
          where: { id },
          data: {
            fecha,
            horaInicio: data.horaInicio,
            horaFin,
            // El aviso previo ya no aplica a la nueva hora.
            recordatorioEnviadoEn: null,
            recordatorioCortoEn: null,
          },
        });
      });
    } catch (e) {
      if (esSlotDuplicado(e)) {
        throw Conflict("Ese horario acaba de ser reservado por otra persona", "SLOT_OCUPADO");
      }
      throw e;
    }

    res.json({ reserva: { ...actualizada, fecha: fechaISO(actualizada.fecha) } });
  }),
);

// ===========================================================================
// CIERRE DE CITAS (lado del negocio)
// Sin esto ninguna cita llegaba nunca a "completada": las reseñas eran
// imposibles y la analítica de ingresos del negocio salía siempre a cero.
// ===========================================================================

/** Cierra una cita: la marca completada y pide reseña al cliente. */
async function cerrarCita(reservaId: number, actorId: number, propina?: number) {
  const reserva = await prisma.reservacion.findUnique({
    where: { id: reservaId },
    include: {
      cliente: { select: { nombre: true, email: true } },
      servicio: { select: { nombreServicio: true } },
      peluquero: {
        select: {
          membresias: {
            where: { estadoAprobacion: "aceptado" },
            select: { negocio: { select: { nombreComercial: true } } },
            take: 1,
          },
        },
      },
    },
  });
  if (!reserva) throw NotFound("Reserva no encontrada");
  if (reserva.estadoCita === "completada") {
    return { reserva, yaCompletada: true };
  }
  if (reserva.estadoCita !== "confirmada") {
    throw BadRequest(`No se puede cerrar una cita en estado "${reserva.estadoCita}"`);
  }
  if (reserva.pagoReservaStatus === "pendiente") {
    throw BadRequest("La fianza de esta cita aún no se ha cobrado", "PAGO_PENDIENTE");
  }

  const actualizada = await prisma.reservacion.update({
    where: { id: reservaId },
    data: {
      estadoCita: "completada",
      completadaEn: new Date(),
      // La propina se entrega en el local (la plataforma solo cobra la fianza):
      // se registra para que aparezca en los ingresos del profesional.
      ...(propina !== undefined ? { propina } : {}),
    },
  });
  await auditar(
    actorId,
    "cita_completada",
    `reserva=${reservaId}${propina ? ` propina=${propina}` : ""}`,
  );

  // Invitación a reseñar: cierra el circuito de reputación del negocio.
  const tpl = emailCitaCompletada({
    nombre: reserva.cliente.nombre,
    negocio: reserva.peluquero.membresias[0]?.negocio.nombreComercial ?? "el negocio",
    servicio: reserva.servicio.nombreServicio,
    url: `${env.appUrl}/?resena=${reservaId}`,
  });
  void enviarEmailSeguro({ to: reserva.cliente.email, subject: tpl.subject, html: tpl.html });

  return { reserva: actualizada, yaCompletada: false };
}

// ---------- Validar el código que trae el cliente al local -> cita completada ----------
reservasRouter.post(
  "/validar",
  requireAuth,
  requireRole(...ROLES_NEGOCIO),
  asyncHandler(async (req, res) => {
    const { codigo, propina } = z
      .object({
        codigo: z.string().trim().min(4).max(12),
        propina: z.number().nonnegative().max(10_000).optional(),
      })
      .parse(req.body);

    const reserva = await prisma.reservacion.findUnique({
      where: { codigoValidacion: codigo.toUpperCase() },
      include: {
        cliente: { select: { nombre: true } },
        servicio: { select: { nombreServicio: true } },
      },
    });
    if (!reserva) throw NotFound("Código no válido");
    await assertGestorDeCita(reserva, req.user!);

    const { yaCompletada } = await cerrarCita(reserva.id, req.user!.sub, propina);

    res.json({
      ok: true,
      yaCompletada,
      reserva: {
        id: reserva.id,
        cliente: reserva.cliente.nombre,
        servicio: reserva.servicio.nombreServicio,
        fecha: fechaISO(reserva.fecha),
        horaInicio: reserva.horaInicio,
        estadoCita: "completada",
      },
    });
  }),
);

// ---------- Cerrar una cita por id (sin código: el profesional la da por atendida) ----------
reservasRouter.patch(
  "/:id/completar",
  requireAuth,
  requireRole(...ROLES_NEGOCIO),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { propina } = z
      .object({ propina: z.number().nonnegative().max(10_000).optional() })
      .parse(req.body ?? {});
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    await assertGestorDeCita(reserva, req.user!);
    const { yaCompletada } = await cerrarCita(id, req.user!.sub, propina);
    res.json({ ok: true, yaCompletada, estadoCita: "completada" });
  }),
);

// ---------- Marcar que el cliente no apareció ----------
reservasRouter.patch(
  "/:id/no-asistio",
  requireAuth,
  requireRole(...ROLES_NEGOCIO),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    await assertGestorDeCita(reserva, req.user!);
    if (reserva.estadoCita !== "confirmada") {
      throw BadRequest(`No se puede marcar no-show una cita en estado "${reserva.estadoCita}"`);
    }
    // La fianza NO se devuelve en un no-show: es exactamente su razón de ser.
    const actualizada = await prisma.reservacion.update({
      where: { id },
      data: { estadoCita: "no_asistio", completadaEn: new Date() },
    });
    await auditar(req.user!.sub, "cita_no_asistio", `reserva=${id}`);
    res.json({ reserva: { ...actualizada, fecha: fechaISO(actualizada.fecha) } });
  }),
);

// ---------- Cancelar una cita desde el negocio (baja, imprevisto...) ----------
// Siempre con reembolso: la cancelación no es culpa del cliente.
reservasRouter.patch(
  "/:id/cancelar-negocio",
  requireAuth,
  requireRole(...ROLES_NEGOCIO),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { motivo } = z
      .object({ motivo: z.string().trim().max(200).optional() })
      .parse(req.body ?? {});

    const reserva = await prisma.reservacion.findUnique({
      where: { id },
      include: {
        cliente: { select: { nombre: true, email: true } },
        peluquero: { select: { nombre: true } },
        servicio: { select: { nombreServicio: true } },
      },
    });
    if (!reserva) throw NotFound("Reserva no encontrada");
    await assertGestorDeCita(reserva, req.user!);
    if (reserva.estadoCita !== "confirmada") {
      throw BadRequest("Solo se pueden cancelar citas confirmadas");
    }

    let reembolso: { reembolsoId: string; ok: boolean } | null = null;
    if (reserva.pagoReservaStatus === "pagado" && reserva.idTransaccionPasarela) {
      reembolso = await paymentProvider.reembolsar(reserva.idTransaccionPasarela);
    }

    const actualizada = await prisma.reservacion.update({
      where: { id },
      data: {
        estadoCita: "cancelada",
        canceladaEn: new Date(),
        canceladaPor: "negocio",
        motivoCancelacion: motivo ?? null,
        ...(reembolso?.ok
          ? { pagoReservaStatus: "reembolsado", idReembolsoPasarela: reembolso.reembolsoId }
          : {}),
      },
    });

    // Cancela el negocio: la sesión del bono SIEMPRE se devuelve, sin importar
    // la antelación. No es culpa del cliente.
    if (reserva.bonoId) {
      await prisma.bonoCliente.updateMany({
        where: { id: reserva.bonoId, sesionesUsadas: { gt: 0 } },
        data: { sesionesUsadas: { decrement: 1 } },
      });
    }

    const tpl = emailCancelacionNegocio({
      nombre: reserva.cliente.nombre,
      profesional: reserva.peluquero.nombre,
      servicio: reserva.servicio.nombreServicio,
      fecha: fechaISO(reserva.fecha),
      hora: reserva.horaInicio,
      motivo,
      reembolsado: reembolso?.ok ?? false,
    });
    void enviarEmailSeguro({ to: reserva.cliente.email, subject: tpl.subject, html: tpl.html });

    void avisarListaEspera({
      peluqueroId: reserva.peluqueroId,
      fecha: reserva.fecha,
      horaInicio: reserva.horaInicio,
      horaFin: reserva.horaFin,
      tz: await zonaDelPeluquero(reserva.peluqueroId),
    });

    await auditar(
      req.user!.sub,
      "reserva_cancelada_negocio",
      `reserva=${id} reembolso=${reembolso?.ok ?? false} motivo=${motivo ?? "-"}`,
    );
    res.json({
      reserva: { ...actualizada, fecha: fechaISO(actualizada.fecha) },
      reembolsado: reembolso?.ok ?? false,
    });
  }),
);

// ---------- Consultar UNA reserva (cliente dueño o negocio) ----------
// Declarada al final: "/:id" capturaría "/mias", "/agenda" o "/validar" si fuera antes.
// La usa el frontend para confirmar el estado tras pagar con la pasarela, ya que el
// pago lo cierra el webhook de forma asíncrona.
reservasRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw NotFound("Reserva no encontrada");

    const reserva = await prisma.reservacion.findUnique({
      where: { id },
      include: {
        peluquero: { select: { nombre: true, telefono: true } },
        servicio: { select: { nombreServicio: true, precio: true, moneda: true } },
      },
    });
    if (!reserva) throw NotFound("Reserva no encontrada");

    const esCliente = reserva.clienteId === req.user!.sub;
    if (!esCliente) await assertGestorDeCita(reserva, req.user!);

    res.json({
      reserva: {
        id: reserva.id,
        fecha: fechaISO(reserva.fecha),
        horaInicio: reserva.horaInicio,
        horaFin: reserva.horaFin,
        estadoCita: reserva.estadoCita,
        pagoReservaStatus: reserva.pagoReservaStatus,
        codigoValidacion: reserva.codigoValidacion,
        expiraPagoEn: reserva.expiraPagoEn,
        canceladaPor: reserva.canceladaPor,
        motivoCancelacion: reserva.motivoCancelacion,
        peluquero: reserva.peluquero.nombre,
        servicio: reserva.servicio.nombreServicio,
        precio: reserva.servicio.precio,
        moneda: reserva.servicio.moneda,
      },
    });
  }),
);
