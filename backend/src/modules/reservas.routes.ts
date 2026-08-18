import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { toMinutes, toHHMM, diaSemanaDeFecha } from "../lib/time.js";
import { calcularSlotsLibres, intervaloDisponible } from "./slots.service.js";
import { paymentProvider } from "./pagos.provider.js";
import { generarCodigoValidacion } from "../lib/codes.js";
import { generarLinkWhatsApp, enviarWhatsApp } from "../lib/whatsapp.js";
import { calcularSplitFianza } from "../lib/split.js";
import { enviarEmail, emailConfirmacionReserva, emailNuevaReservaPro } from "../lib/email.js";

export const reservasRouter = Router();

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora debe ser HH:MM");

// ---------- Desglose de cómo se reparte la fianza (para el panel del dueño) ----------
reservasRouter.get(
  "/split",
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

// ---------- Crear reserva (cliente) => estado pendiente + intento de pago ----------
const crearReservaSchema = z.object({
  peluqueroId: z.number().int().positive(),
  servicioId: z.number().int().positive(),
  fecha: FECHA,
  horaInicio: HORA,
});

reservasRouter.post(
  "/",
  requireAuth,
  requireRole("cliente"),
  asyncHandler(async (req, res) => {
    const data = crearReservaSchema.parse(req.body);
    const clienteId = req.user!.sub;

    // No permitir reservar en el pasado.
    const inicioDate = new Date(`${data.fecha}T${data.horaInicio}:00`);
    if (inicioDate.getTime() < Date.now()) {
      throw BadRequest("No puedes reservar en un horario pasado");
    }

    const resultadoTx = await prisma.$transaction(async (tx) => {
      // Bloquea las reservas del peluquero en esa fecha para serializar la verificación de colisión.
      const fecha = new Date(`${data.fecha}T00:00:00`);
      await tx.$queryRaw`
        SELECT id FROM reservaciones
        WHERE peluquero_id = ${data.peluqueroId} AND fecha = ${fecha}::date
        FOR UPDATE`;

      const servicio = await tx.servicio.findUnique({ where: { id: data.servicioId } });
      if (!servicio || !servicio.activo) throw NotFound("Servicio no disponible");
      if (servicio.peluqueroId !== data.peluqueroId) {
        throw BadRequest("El servicio no pertenece a ese peluquero");
      }

      // El peluquero debe estar aceptado en algún negocio con suscripción vigente.
      const membresia = await tx.peluqueroEquipo.findFirst({
        where: {
          usuarioId: data.peluqueroId,
          estadoAprobacion: "aceptado",
          negocio: { estadoSuscripcion: { in: ["activo", "prueba"] } },
        },
        include: { negocio: { select: { stripeConnectAccountId: true, cobrosActivos: true } } },
      });
      if (!membresia) throw Forbidden("El peluquero no está disponible para reservas");

      const inicioMin = toMinutes(data.horaInicio);
      const finMin = inicioMin + servicio.duracionMinutos;
      const horaFin = toHHMM(finMin);

      // Debe caer dentro de un rango de disponibilidad de ese día.
      const dia = diaSemanaDeFecha(data.fecha);
      const rangos = await tx.disponibilidad.findMany({
        where: { peluqueroId: data.peluqueroId, dia: dia as any },
      });
      const dentroDeRango = rangos.some(
        (r) => inicioMin >= toMinutes(r.horaInicio) && finMin <= toMinutes(r.horaFin),
      );
      if (!dentroDeRango) {
        throw Conflict("El horario está fuera de la disponibilidad del peluquero", "FUERA_DE_RANGO");
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

      // Se crea CONFIRMADA para bloquear el slot de inmediato, pero con pago pendiente.
      // Si el pago no llega antes de expiraPagoEn, el job de expiración libera el slot.
      const expiraPagoEn = new Date(Date.now() + env.reservaHoldMinutos * 60 * 1000);
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
          codigoValidacion: generarCodigoValidacion(),
        },
      });
      // Devuelve también los datos de cobro del negocio para el split de la fianza.
      return { nueva, negocio: membresia.negocio };
    });

    const { nueva: reserva, negocio } = resultadoTx;

    // Split de la fianza (contando la comisión real de Stripe): si el negocio tiene cobros
    // activos (Stripe Connect), su parte va a su cuenta y la plataforma retiene el application fee.
    const conSplit = negocio?.cobrosActivos && negocio?.stripeConnectAccountId;
    const split = calcularSplitFianza();
    const intento = await paymentProvider.crearIntento({
      reservaId: reserva.id,
      montoUsd: split.montoCobradoUsd,
      clienteEmail: req.user!.email,
      destinoConnectId: conSplit ? negocio!.stripeConnectAccountId! : undefined,
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

// Lógica compartida: marca la reserva como pagada/confirmada, arma WhatsApp y envía email.
async function confirmarReservaPagada(reservaId: number): Promise<string> {
  const reserva = await prisma.reservacion.findUnique({
    where: { id: reservaId },
    include: {
      cliente: { select: { nombre: true, email: true, telefono: true } },
      peluquero: { select: { nombre: true, email: true, telefono: true } },
      servicio: { select: { nombreServicio: true } },
    },
  });
  if (!reserva) throw NotFound("Reserva no encontrada");

  const actualizada = await prisma.reservacion.update({
    where: { id: reserva.id },
    data: { pagoReservaStatus: "pagado", estadoCita: "confirmada" },
  });

  const fechaISO = actualizada.fecha.toISOString().slice(0, 10);
  const whatsappUrl = generarLinkWhatsApp({
    telefonoDestino: reserva.peluquero.telefono,
    nombreProfesional: reserva.peluquero.nombre,
    nombreServicio: reserva.servicio.nombreServicio,
    fecha: fechaISO,
    hora: actualizada.horaInicio,
    codigoValidacion: actualizada.codigoValidacion,
  });

  const tpl = emailConfirmacionReserva({
    nombre: reserva.cliente.nombre,
    negocio: "tu negocio en Turno",
    profesional: reserva.peluquero.nombre,
    servicio: reserva.servicio.nombreServicio,
    fecha: fechaISO,
    hora: actualizada.horaInicio,
    codigo: actualizada.codigoValidacion,
  });
  enviarEmail({ to: reserva.cliente.email, subject: tpl.subject, html: tpl.html }).catch(() => {});

  // Aviso al PROFESIONAL de la nueva reserva (best-effort).
  const tplPro = emailNuevaReservaPro({
    profesional: reserva.peluquero.nombre,
    cliente: reserva.cliente.nombre,
    servicio: reserva.servicio.nombreServicio,
    fecha: fechaISO,
    hora: actualizada.horaInicio,
  });
  enviarEmail({ to: reserva.peluquero.email, subject: tplPro.subject, html: tplPro.html }).catch(() => {});

  // Envío AUTOMÁTICO por WhatsApp Cloud API al cliente (si WHATSAPP_PROVIDER=cloud).
  enviarWhatsApp({
    telefonoDestino: reserva.cliente.telefono,
    nombreProfesional: reserva.peluquero.nombre,
    nombreServicio: reserva.servicio.nombreServicio,
    fecha: fechaISO,
    hora: actualizada.horaInicio,
    codigoValidacion: actualizada.codigoValidacion,
  }).catch(() => {});

  return whatsappUrl;
}

// ---------- Confirmar pago (modo mock/paypal-stub): AUTENTICADO y sobre la reserva propia ----------
// Reemplaza la llamada directa del frontend al webhook público (que era abusable).
reservasRouter.post(
  "/:id/pagar",
  requireAuth,
  requireRole("cliente"),
  asyncHandler(async (req, res) => {
    if (env.paymentProvider === "stripe") {
      throw BadRequest("Con Stripe el pago se confirma vía webhook de la pasarela", "USE_STRIPE");
    }
    const id = Number(req.params.id);
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    if (reserva.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");
    if (reserva.pagoReservaStatus === "pagado") {
      return res.json({ ok: true, estado: "confirmada", yaConfirmada: true });
    }
    if (reserva.estadoCita !== "confirmada") throw BadRequest("La reserva no está activa");

    const whatsappUrl = await confirmarReservaPagada(id);
    res.json({ ok: true, estado: "confirmada", whatsappUrl });
  }),
);

// ---------- Webhook REAL de la pasarela (Stripe): fuente de verdad del pago ----------
// Solo procesa con firma válida. En modo mock/paypal-stub se usa el endpoint autenticado de arriba.
reservasRouter.post(
  "/webhook/pago",
  asyncHandler(async (req, res) => {
    if (env.paymentProvider !== "stripe") {
      throw Forbidden("En este modo el pago se confirma con el endpoint autenticado /:id/pagar");
    }
    const rawBody =
      typeof (req as any).rawBody === "string" ? (req as any).rawBody : JSON.stringify(req.body ?? {});
    const signature = req.headers["stripe-signature"] as string | undefined;

    const evento = paymentProvider.verificarWebhook(rawBody, signature);
    if (!evento) throw BadRequest("Webhook inválido o firma incorrecta", "WEBHOOK_INVALIDO");

    const reserva = await prisma.reservacion.findFirst({
      where: { idTransaccionPasarela: evento.transaccionId },
    });
    if (!reserva) throw NotFound("Reserva de la transacción no encontrada");

    if (!evento.pagado) {
      await prisma.reservacion.update({
        where: { id: reserva.id },
        data: { estadoCita: "cancelada", pagoReservaStatus: "pendiente" },
      });
      return res.json({ ok: true, estado: "cancelada" });
    }

    const whatsappUrl = await confirmarReservaPagada(reserva.id);
    res.json({ ok: true, estado: "confirmada", whatsappUrl });
  }),
);

// ---------- Historial de reservas del cliente ----------
reservasRouter.get(
  "/mias",
  requireAuth,
  requireRole("cliente"),
  asyncHandler(async (req, res) => {
    const reservas = await prisma.reservacion.findMany({
      where: { clienteId: req.user!.sub },
      include: {
        peluquero: { select: { nombre: true, telefono: true } },
        servicio: { select: { nombreServicio: true, precio: true, moneda: true } },
      },
      orderBy: [{ fecha: "desc" }, { horaInicio: "desc" }],
    });

    const data = reservas.map((r) => {
      const fechaISO = r.fecha.toISOString().slice(0, 10);
      return {
        id: r.id,
        fecha: fechaISO,
        horaInicio: r.horaInicio,
        horaFin: r.horaFin,
        estadoCita: r.estadoCita,
        pagoReservaStatus: r.pagoReservaStatus,
        codigoValidacion: r.codigoValidacion,
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
                fecha: fechaISO,
                hora: r.horaInicio,
                codigoValidacion: r.codigoValidacion,
              })
            : null,
      };
    });

    res.json({ reservas: data });
  }),
);

// ---------- Agenda del peluquero (sus citas) ----------
reservasRouter.get(
  "/agenda",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const desde = typeof req.query.desde === "string" ? req.query.desde : undefined;
    const where: any = { peluqueroId: req.user!.sub };
    if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      where.fecha = { gte: new Date(`${desde}T00:00:00`) };
    }
    const reservas = await prisma.reservacion.findMany({
      where,
      include: {
        cliente: { select: { nombre: true, telefono: true } },
        servicio: { select: { nombreServicio: true, duracionMinutos: true } },
      },
      orderBy: [{ fecha: "asc" }, { horaInicio: "asc" }],
    });
    res.json({ reservas });
  }),
);

// ---------- Ingresos del profesional: desglose de lo que generó (para cuadrar con el negocio) ----------
reservasRouter.get(
  "/mis-ingresos",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const peluqueroId = req.user!.sub;
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const desde =
      typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde)
        ? new Date(`${req.query.desde}T00:00:00`)
        : inicioMes;

    const split = calcularSplitFianza();
    const [pagadas, totalHistorico] = await Promise.all([
      prisma.reservacion.findMany({
        where: { peluqueroId, pagoReservaStatus: "pagado", createdAt: { gte: desde } },
        include: { servicio: { select: { nombreServicio: true, precio: true, moneda: true } } },
        orderBy: [{ fecha: "desc" }, { horaInicio: "desc" }],
      }),
      prisma.reservacion.count({ where: { peluqueroId, pagoReservaStatus: "pagado" } }),
    ]);

    // Valor de servicios generado, agrupado por moneda (los precios pueden estar en distintas monedas).
    const porMoneda = new Map<string, number>();
    for (const r of pagadas) {
      const m = r.servicio.moneda || "USD";
      porMoneda.set(m, Number(((porMoneda.get(m) ?? 0) + Number(r.servicio.precio)).toFixed(2)));
    }

    res.json({
      desde: desde.toISOString().slice(0, 10),
      reservasPagadas: pagadas.length,
      totalHistorico,
      // Aporte de fianzas al negocio generado por este profesional (lo que cobró el negocio por su trabajo).
      fianzaNegocioUsd: Number((pagadas.length * split.alNegocioUsd).toFixed(2)),
      fianzaPorReservaUsd: split.alNegocioUsd,
      valorServicios: Array.from(porMoneda.entries()).map(([moneda, total]) => ({ moneda, total })),
      reservas: pagadas.map((r) => ({
        id: r.id,
        fecha: r.fecha.toISOString().slice(0, 10),
        servicio: r.servicio.nombreServicio,
        precio: r.servicio.precio,
        moneda: r.servicio.moneda,
      })),
    });
  }),
);

// ---------- Cancelar reserva (cliente dueño de la cita) + reembolso si estaba pagada ----------
reservasRouter.patch(
  "/:id/cancelar",
  requireAuth,
  requireRole("cliente"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reserva = await prisma.reservacion.findUnique({ where: { id } });
    if (!reserva) throw NotFound("Reserva no encontrada");
    if (reserva.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");
    if (reserva.estadoCita !== "confirmada") {
      throw BadRequest("Solo se pueden cancelar reservas confirmadas");
    }

    // Política de cancelación: solo hay reembolso si se cancela con la antelación mínima.
    const inicioCita = new Date(`${reserva.fecha.toISOString().slice(0, 10)}T${reserva.horaInicio}:00`);
    const horasDeAntelacion = (inicioCita.getTime() - Date.now()) / (1000 * 60 * 60);
    const dentroDeVentana = horasDeAntelacion >= env.cancelacionHorasReembolso;

    let reembolso: { reembolsoId: string; ok: boolean } | null = null;
    if (dentroDeVentana && reserva.pagoReservaStatus === "pagado" && reserva.idTransaccionPasarela) {
      reembolso = await paymentProvider.reembolsar(reserva.idTransaccionPasarela);
    }

    const actualizada = await prisma.reservacion.update({
      where: { id },
      data: {
        estadoCita: "cancelada",
        ...(reembolso?.ok
          ? { pagoReservaStatus: "reembolsado", idReembolsoPasarela: reembolso.reembolsoId }
          : {}),
      },
    });
    res.json({
      reserva: actualizada,
      reembolsado: reembolso?.ok ?? false,
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
  requireRole("cliente"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = reprogramarSchema.parse(req.body);

    const inicioDate = new Date(`${data.fecha}T${data.horaInicio}:00`);
    if (inicioDate.getTime() < Date.now()) throw BadRequest("No puedes reprogramar a un horario pasado");

    const actualizada = await prisma.$transaction(async (tx) => {
      const reserva = await tx.reservacion.findUnique({ where: { id } });
      if (!reserva) throw NotFound("Reserva no encontrada");
      if (reserva.clienteId !== req.user!.sub) throw Forbidden("No es tu reserva");
      if (reserva.estadoCita !== "confirmada") throw BadRequest("Solo se reprograman reservas confirmadas");

      const fecha = new Date(`${data.fecha}T00:00:00`);
      await tx.$queryRaw`
        SELECT id FROM reservaciones
        WHERE peluquero_id = ${reserva.peluqueroId} AND fecha = ${fecha}::date FOR UPDATE`;

      const servicio = await tx.servicio.findUnique({ where: { id: reserva.servicioId } });
      const inicioMin = toMinutes(data.horaInicio);
      const finMin = inicioMin + (servicio?.duracionMinutos ?? 30);
      const horaFin = toHHMM(finMin);

      // Dentro de disponibilidad.
      const dia = diaSemanaDeFecha(data.fecha);
      const rangos = await tx.disponibilidad.findMany({ where: { peluqueroId: reserva.peluqueroId, dia: dia as any } });
      const dentro = rangos.some((r) => inicioMin >= toMinutes(r.horaInicio) && finMin <= toMinutes(r.horaFin));
      if (!dentro) throw Conflict("Fuera de la disponibilidad del profesional", "FUERA_DE_RANGO");

      // Colisión contra otras reservas confirmadas (excluyendo esta) + bloqueos.
      const confirmadas = await tx.reservacion.findMany({
        where: { peluqueroId: reserva.peluqueroId, fecha, estadoCita: "confirmada", id: { not: id } },
        select: { horaInicio: true, horaFin: true },
      });
      const bloqueos = confirmadas.map((r) => ({ inicio: toMinutes(r.horaInicio), fin: toMinutes(r.horaFin) }));
      const bloqueosAgenda = await tx.bloqueo.findMany({ where: { peluqueroId: reserva.peluqueroId, fecha } });
      for (const b of bloqueosAgenda) {
        bloqueos.push(b.horaInicio && b.horaFin ? { inicio: toMinutes(b.horaInicio), fin: toMinutes(b.horaFin) } : { inicio: 0, fin: 1440 });
      }
      if (!intervaloDisponible(inicioMin, finMin, bloqueos)) {
        throw Conflict("Ese horario no está disponible", "SLOT_OCUPADO");
      }

      return tx.reservacion.update({
        where: { id },
        data: { fecha, horaInicio: data.horaInicio, horaFin },
      });
    });

    res.json({ reserva: actualizada });
  }),
);
