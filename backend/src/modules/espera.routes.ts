import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { fechaUTC, fechaISO, sumarDias, ahoraEnZona, toMinutes } from "../lib/time.js";
import { filtroNegocioVigente } from "../lib/suscripcion.js";

// Lista de espera para un día completo. El cliente se apunta y recibe un email
// si se libera un hueco; no bloquea nada ni garantiza la plaza.

export const esperaRouter = Router();

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha debe ser YYYY-MM-DD");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora debe ser HH:MM");
const ROLES_CLIENTE = ["cliente", "admin_negocio", "peluquero"] as const;

// Tope por cliente: sin él, apuntarse en bucle convierte la lista en un buzón
// de spam para el propio cliente y en basura para el negocio.
const MAX_ESPERAS_ACTIVAS = 10;

const apuntarseSchema = z
  .object({
    peluqueroId: z.number().int().positive(),
    servicioId: z.number().int().positive(),
    fecha: FECHA,
    horaDesde: HORA.optional(),
    horaHasta: HORA.optional(),
  })
  .refine((d) => !d.horaDesde || !d.horaHasta || toMinutes(d.horaDesde) < toMinutes(d.horaHasta), {
    message: "horaDesde debe ser anterior a horaHasta",
    path: ["horaHasta"],
  })
  .refine((d) => Boolean(d.horaDesde) === Boolean(d.horaHasta), {
    message: "Indica las dos horas de la franja o ninguna",
    path: ["horaDesde"],
  });

esperaRouter.post(
  "/",
  requireAuth,
  requireRole(...ROLES_CLIENTE),
  asyncHandler(async (req, res) => {
    const data = apuntarseSchema.parse(req.body);
    const clienteId = req.user!.sub;

    const membresia = await prisma.peluqueroEquipo.findFirst({
      where: {
        usuarioId: data.peluqueroId,
        estadoAprobacion: "aceptado",
        negocio: filtroNegocioVigente(),
      },
      include: { negocio: { select: { timezone: true } } },
    });
    if (!membresia) throw Forbidden("El profesional no está disponible para reservas");

    const servicio = await prisma.servicio.findUnique({ where: { id: data.servicioId } });
    if (!servicio || !servicio.activo) throw NotFound("Servicio no disponible");
    if (servicio.peluqueroId !== data.peluqueroId) {
      throw BadRequest("El servicio no pertenece a ese profesional");
    }

    // Mismas ventanas que una reserva: no se espera por un día que ya pasó ni
    // por uno que todavía no se puede reservar.
    const hoy = ahoraEnZona(membresia.negocio.timezone).fechaISO;
    if (data.fecha < hoy) throw BadRequest("Esa fecha ya ha pasado");
    if (data.fecha > sumarDias(hoy, env.horizonteReservaDias)) {
      throw BadRequest(
        `Solo se puede esperar hasta ${env.horizonteReservaDias} días por adelantado`,
        "FUERA_DE_HORIZONTE",
      );
    }

    const activas = await prisma.listaEspera.count({
      where: { clienteId, cancelada: false, fecha: { gte: fechaUTC(hoy) } },
    });
    if (activas >= MAX_ESPERAS_ACTIVAS) {
      throw Conflict(
        `Ya estás en ${activas} listas de espera. Sal de alguna antes de apuntarte a otra.`,
        "DEMASIADAS_ESPERAS",
      );
    }

    const fecha = fechaUTC(data.fecha);
    // Volver a apuntarse al mismo día reinicia el aviso: si ya se avisó antes,
    // el cliente quiere que se le vuelva a avisar.
    const fila = await prisma.listaEspera.upsert({
      where: {
        unique_espera_cliente_dia: {
          clienteId,
          peluqueroId: data.peluqueroId,
          servicioId: data.servicioId,
          fecha,
        },
      },
      create: {
        clienteId,
        peluqueroId: data.peluqueroId,
        servicioId: data.servicioId,
        fecha,
        horaDesde: data.horaDesde ?? null,
        horaHasta: data.horaHasta ?? null,
      },
      update: {
        horaDesde: data.horaDesde ?? null,
        horaHasta: data.horaHasta ?? null,
        cancelada: false,
        avisadoEn: null,
      },
    });

    res.status(201).json({
      espera: { ...fila, fecha: fechaISO(fila.fecha) },
      mensaje: "Te avisaremos por email si se libera un hueco ese día.",
    });
  }),
);

esperaRouter.get(
  "/mias",
  requireAuth,
  asyncHandler(async (req, res) => {
    const hoy = fechaUTC(ahoraEnZona(env.timezoneDefecto).fechaISO);
    const filas = await prisma.listaEspera.findMany({
      where: { clienteId: req.user!.sub, cancelada: false, fecha: { gte: hoy } },
      orderBy: { fecha: "asc" },
      include: {
        servicio: { select: { nombreServicio: true, precio: true, moneda: true } },
        peluquero: { select: { id: true, nombre: true } },
      },
    });
    res.json({
      esperas: filas.map((f) => ({
        id: f.id,
        fecha: fechaISO(f.fecha),
        horaDesde: f.horaDesde,
        horaHasta: f.horaHasta,
        avisadoEn: f.avisadoEn,
        servicio: f.servicio,
        peluquero: f.peluquero,
      })),
    });
  }),
);

// Cola de un día, para el negocio: saber cuánta demanda hay sin hueco es la
// información que justifica abrir más horas o contratar.
esperaRouter.get(
  "/cola",
  requireAuth,
  requireRole("peluquero", "admin_negocio", "superadmin"),
  asyncHandler(async (req, res) => {
    const { peluqueroId, fecha } = z
      .object({ peluqueroId: z.coerce.number().int().positive(), fecha: FECHA })
      .parse(req.query);

    if (req.user!.rol !== "superadmin" && peluqueroId !== req.user!.sub) {
      const esDueno = await prisma.peluqueroEquipo.findFirst({
        where: {
          usuarioId: peluqueroId,
          estadoAprobacion: "aceptado",
          negocio: { duenoId: req.user!.sub },
        },
        select: { id: true },
      });
      if (!esDueno) throw Forbidden("Ese profesional no es de tu negocio");
    }

    const filas = await prisma.listaEspera.findMany({
      where: { peluqueroId, fecha: fechaUTC(fecha), cancelada: false },
      orderBy: { createdAt: "asc" },
      include: {
        cliente: { select: { id: true, nombre: true, telefono: true } },
        servicio: { select: { nombreServicio: true } },
      },
    });
    res.json({ total: filas.length, cola: filas });
  }),
);

esperaRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const fila = await prisma.listaEspera.findUnique({ where: { id } });
    if (!fila) throw NotFound("No estás en esa lista de espera");
    if (fila.clienteId !== req.user!.sub && req.user!.rol !== "superadmin") {
      throw Forbidden("No puedes salir de una lista que no es tuya");
    }
    await prisma.listaEspera.update({ where: { id }, data: { cancelada: true } });
    res.json({ ok: true });
  }),
);
