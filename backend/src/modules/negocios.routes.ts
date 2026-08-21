import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { paginationSchema, paginar, metaPaginacion } from "../lib/pagination.js";
import { calcularSplitFianza } from "../lib/split.js";
import { limitePeluqueros, limiteNegocios } from "../lib/planes.js";
import { SLUGS_PERFIL } from "../config/perfiles.js";

export const negociosRouter = Router();

// Verifica que el usuario autenticado sea dueño del negocio indicado.
async function assertDueno(negocioId: string, usuarioId: number) {
  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId !== usuarioId) throw Forbidden("No eres dueño de este negocio");
  return negocio;
}

function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------- Listado público de negocios (solo suscripción activa/prueba y visibles) ----------
negociosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const ubicacion = typeof req.query.ubicacion === "string" ? req.query.ubicacion.trim() : undefined;
    const categoria = typeof req.query.categoria === "string" ? req.query.categoria : undefined;
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    const geo = lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng);
    const { page, limit } = paginationSchema.parse(req.query);
    const where: Prisma.NegocioWhereInput = {
      // Regla de negocio: los negocios con suscripción vencida se ocultan al cliente.
      estadoSuscripcion: { in: ["activo", "prueba"] },
      ...(q ? { nombreComercial: { contains: q, mode: "insensitive" } } : {}),
      // Búsqueda por ubicación: filtra por texto de la dirección (ciudad, zona...).
      ...(ubicacion ? { direccion: { contains: ubicacion, mode: "insensitive" } } : {}),
      ...(categoria ? { categoria } : {}),
    };

    const select = {
      id: true, nombreComercial: true, categoria: true, slug: true,
      direccion: true, telefonoContacto: true, logoUrl: true, coverUrl: true,
      ratingPromedio: true, ratingConteo: true, lat: true, lng: true,
    };

    const total = await prisma.negocio.count({ where });

    // Con geo: traemos todos los que tienen coords, calculamos distancia y ordenamos por cercanía.
    if (geo) {
      const todos = await prisma.negocio.findMany({ where, select });
      const conDist = todos
        .map((n) => ({
          ...n,
          distanciaKm: n.lat != null && n.lng != null ? distanciaKm(lat!, lng!, n.lat, n.lng) : null,
        }))
        .sort((a, b) => (a.distanciaKm ?? Infinity) - (b.distanciaKm ?? Infinity))
        .slice((page - 1) * limit, page * limit)
        .map((n) => ({ ...n, distanciaKm: n.distanciaKm != null ? Number(n.distanciaKm.toFixed(2)) : null }));
      return res.json({ negocios: conDist, meta: metaPaginacion(total, page, limit) });
    }

    const negocios = await prisma.negocio.findMany({
      where,
      select,
      orderBy: [{ ratingPromedio: "desc" }, { nombreComercial: "asc" }],
      ...paginar(page, limit),
    });
    res.json({ negocios, meta: metaPaginacion(total, page, limit) });
  }),
);

// Distancia en km entre dos coordenadas (fórmula de Haversine).
function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Negocios del dueño autenticado (admin_negocio) ----------
// Debe declararse ANTES de "/:slug" para no ser capturada por esa ruta comodín.
negociosRouter.get(
  "/mios",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocios = await prisma.negocio.findMany({
      where: { duenoId: req.user!.sub },
      select: {
        id: true,
        nombreComercial: true,
        categoria: true,
        perfil: true,
        slug: true,
        direccion: true,
        telefonoContacto: true,
        lat: true,
        lng: true,
        estadoSuscripcion: true,
        suscripcionHasta: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ negocios });
  }),
);

// ---------- Detalle público con peluqueros aceptados ----------
negociosRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const negocio = await prisma.negocio.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        nombreComercial: true,
        categoria: true,
        slug: true,
        direccion: true,
        telefonoContacto: true,
        logoUrl: true,
        ratingPromedio: true,
        ratingConteo: true,
        estadoSuscripcion: true,
        equipo: {
          where: { estadoAprobacion: "aceptado" },
          select: {
            usuario: { select: { id: true, nombre: true, telefono: true, fotoUrl: true } },
          },
        },
      },
    });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (negocio.estadoSuscripcion === "vencido") {
      throw NotFound("Negocio no disponible");
    }

    const profesionales = negocio.equipo.map((e) => e.usuario);
    res.json({
      negocio: {
        id: negocio.id,
        nombreComercial: negocio.nombreComercial,
        categoria: negocio.categoria,
        slug: negocio.slug,
        direccion: negocio.direccion,
        telefonoContacto: negocio.telefonoContacto,
        logoUrl: negocio.logoUrl,
        ratingPromedio: negocio.ratingPromedio,
        ratingConteo: negocio.ratingConteo,
      },
      // Clave neutral "profesionales"; se mantiene "peluqueros" por compatibilidad.
      profesionales,
      peluqueros: profesionales,
    });
  }),
);

// ---------- Crear negocio (admin_negocio) ----------
// Categorías sugeridas de la plataforma multi-rubro (se permite cualquier valor corto).
export const CATEGORIAS = [
  "barberia",
  "peluqueria",
  "estetica",
  "unas",
  "spa",
  "masajes",
  "tatuajes",
  "depilacion",
  "maquillaje",
  "otro",
] as const;

const crearNegocioSchema = z.object({
  nombreComercial: z.string().min(2).max(150),
  categoria: z.string().min(2).max(40).default("otro"),
  // Rubro del motor de nicho (activa sus módulos). Debe existir en el catálogo.
  perfil: z.enum(SLUGS_PERFIL as [string, ...string[]]).optional(),
  direccion: z.string().min(3),
  telefonoContacto: z.string().min(6).max(20),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

negociosRouter.post(
  "/",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const data = crearNegocioSchema.parse(req.body);
    const duenoId = req.user!.sub;

    // Límite de negocios por dueño según su plan (el superadmin queda exento).
    if (req.user!.rol !== "superadmin") {
      const propios = await prisma.negocio.findMany({
        where: { duenoId },
        select: { plan: true, estadoSuscripcion: true },
      });
      const maxNegocios = limiteNegocios(propios);
      if (propios.length >= maxNegocios) {
        throw Conflict(
          `Tu plan permite ${maxNegocios} negocio(s). Sube a Pro para crear más.`,
          "LIMITE_NEGOCIOS",
        );
      }
    }

    // Genera un slug único agregando sufijo si hace falta.
    const base = slugify(data.nombreComercial) || "negocio";
    let slug = base;
    let intento = 1;
    while (await prisma.negocio.findUnique({ where: { slug } })) {
      slug = `${base}-${++intento}`;
    }

    const negocio = await prisma.negocio.create({
      data: {
        nombreComercial: data.nombreComercial,
        categoria: data.categoria,
        perfil: data.perfil ?? null,
        direccion: data.direccion,
        telefonoContacto: data.telefonoContacto,
        lat: data.lat,
        lng: data.lng,
        slug,
        duenoId,
        estadoSuscripcion: "prueba",
        suscripcionHasta: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 días de prueba
      },
    });

    // El creador queda como primer profesional aceptado de su propio negocio.
    // Así un negocio de una sola persona es reservable sin necesitar una segunda cuenta.
    await prisma.peluqueroEquipo.create({
      data: { negocioId: negocio.id, usuarioId: duenoId, estadoAprobacion: "aceptado" },
    });

    res.status(201).json({ negocio });
  }),
);

// ---------- Actualizar datos/ubicación del negocio (dueño) ----------
const actualizarNegocioSchema = z.object({
  direccion: z.string().min(3).optional(),
  categoria: z.string().min(2).max(40).optional(),
  telefonoContacto: z.string().min(6).max(20).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

negociosRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    await assertDueno(req.params.id, req.user!.sub);
    const data = actualizarNegocioSchema.parse(req.body);
    const negocio = await prisma.negocio.update({ where: { id: req.params.id }, data });
    res.json({ negocio });
  }),
);

// ---------- Peluquero solicita unirse a un negocio ----------
negociosRouter.post(
  "/:id/solicitudes",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    const usuarioId = req.user!.sub;

    const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
    if (!negocio) throw NotFound("Negocio no encontrado");

    const existente = await prisma.peluqueroEquipo.findUnique({
      where: { unique_peluquero_negocio: { negocioId, usuarioId } },
    });
    if (existente) {
      if (existente.estadoAprobacion === "rechazado") {
        // Permite re-solicitar tras un rechazo.
        const actualizado = await prisma.peluqueroEquipo.update({
          where: { id: existente.id },
          data: { estadoAprobacion: "pendiente" },
        });
        return res.status(200).json({ solicitud: actualizado });
      }
      throw Conflict("Ya existe una solicitud para este negocio", "SOLICITUD_EXISTENTE");
    }

    const solicitud = await prisma.peluqueroEquipo.create({
      data: { negocioId, usuarioId, estadoAprobacion: "pendiente" },
    });
    res.status(201).json({ solicitud });
  }),
);

// ---------- Admin lista solicitudes y equipo de su negocio ----------
negociosRouter.get(
  "/:id/equipo",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    await assertDueno(req.params.id, req.user!.sub);
    const negocio = await prisma.negocio.findUnique({
      where: { id: req.params.id },
      select: { plan: true, estadoSuscripcion: true },
    });
    const miembros = await prisma.peluqueroEquipo.findMany({
      where: { negocioId: req.params.id },
      select: {
        id: true,
        estadoAprobacion: true,
        createdAt: true,
        usuario: { select: { id: true, nombre: true, email: true, telefono: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const activos = miembros.filter((m) => m.estadoAprobacion === "aceptado").length;
    const limite = limitePeluqueros(negocio?.plan, negocio?.estadoSuscripcion ?? "prueba");
    res.json({ miembros, activos, limite });
  }),
);

// ---------- Admin aprueba/rechaza una solicitud (LÍMITE ESTRICTO DE 5) ----------
const decisionSchema = z.object({
  decision: z.enum(["aceptado", "rechazado"]),
});

negociosRouter.patch(
  "/:id/equipo/:solicitudId",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    const solicitudId = Number(req.params.solicitudId);
    const { decision } = decisionSchema.parse(req.body);
    await assertDueno(negocioId, req.user!.sub);

    // Transacción con lock a nivel de negocio para evitar que dos aprobaciones
    // simultáneas superen el límite de 5 peluqueros activos (condición de carrera).
    const resultado = await prisma.$transaction(async (tx) => {
      // Serializa las operaciones sobre este negocio bloqueando su fila.
      await tx.$queryRaw`SELECT id FROM negocios WHERE id = ${negocioId} FOR UPDATE`;

      const negocio = await tx.negocio.findUnique({
        where: { id: negocioId },
        select: { plan: true, estadoSuscripcion: true },
      });
      if (!negocio) throw NotFound("Negocio no encontrado");

      const solicitud = await tx.peluqueroEquipo.findFirst({
        where: { id: solicitudId, negocioId },
      });
      if (!solicitud) throw NotFound("Solicitud no encontrada");

      if (decision === "aceptado") {
        if (solicitud.estadoAprobacion === "aceptado") {
          return solicitud; // idempotente
        }
        const activos = await tx.peluqueroEquipo.count({
          where: { negocioId, estadoAprobacion: "aceptado" },
        });
        const maxPel = limitePeluqueros(negocio.plan, negocio.estadoSuscripcion);
        if (activos >= maxPel) {
          throw Conflict(
            `Tu plan permite ${maxPel} profesionales activos. Sube de plan para aceptar más.`,
            "LIMITE_PELUQUEROS",
          );
        }
      }

      return tx.peluqueroEquipo.update({
        where: { id: solicitud.id },
        data: { estadoAprobacion: decision },
      });
    });

    res.json({ solicitud: resultado });
  }),
);

// ---------- Admin genera un link de invitación único ----------
negociosRouter.post(
  "/:id/invitaciones",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await assertDueno(negocioId, req.user!.sub);

    const token = randomBytes(24).toString("base64url");
    const expiraEn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    await prisma.invitacionNegocio.create({ data: { negocioId, token, expiraEn } });

    res.status(201).json({
      token,
      expiraEn,
      // El frontend arma la ruta /invitacion/:token; se expone la URL completa por comodidad.
      url: `${env.appUrl}/invitacion/${token}`,
    });
  }),
);

// ---------- Peluquero consulta y acepta una invitación por token ----------
negociosRouter.get(
  "/invitaciones/:token",
  asyncHandler(async (req, res) => {
    const inv = await prisma.invitacionNegocio.findUnique({
      where: { token: req.params.token },
      include: { negocio: { select: { id: true, nombreComercial: true, slug: true } } },
    });
    if (!inv || inv.usadaEn || inv.expiraEn < new Date()) {
      throw NotFound("Invitación inválida o expirada");
    }
    res.json({ negocio: inv.negocio });
  }),
);

negociosRouter.post(
  "/invitaciones/:token/aceptar",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const usuarioId = req.user!.sub;

    const resultado = await prisma.$transaction(async (tx) => {
      const inv = await tx.invitacionNegocio.findUnique({ where: { token: req.params.token } });
      if (!inv || inv.usadaEn || inv.expiraEn < new Date()) {
        throw NotFound("Invitación inválida o expirada");
      }
      // Lock del negocio para respetar el límite de 5 al aceptar por invitación.
      await tx.$queryRaw`SELECT id FROM negocios WHERE id = ${inv.negocioId} FOR UPDATE`;

      const yaMiembro = await tx.peluqueroEquipo.findUnique({
        where: { unique_peluquero_negocio: { negocioId: inv.negocioId, usuarioId } },
      });
      if (yaMiembro && yaMiembro.estadoAprobacion === "aceptado") {
        throw Conflict("Ya perteneces a este negocio", "YA_MIEMBRO");
      }

      const activos = await tx.peluqueroEquipo.count({
        where: { negocioId: inv.negocioId, estadoAprobacion: "aceptado" },
      });
      if (activos >= env.maxPeluqueros) {
        throw Conflict(`El negocio ya alcanzó el máximo de ${env.maxPeluqueros} peluqueros`, "LIMITE_PELUQUEROS");
      }

      // La invitación pre-aprueba al peluquero.
      const membresia = yaMiembro
        ? await tx.peluqueroEquipo.update({
            where: { id: yaMiembro.id },
            data: { estadoAprobacion: "aceptado" },
          })
        : await tx.peluqueroEquipo.create({
            data: { negocioId: inv.negocioId, usuarioId, estadoAprobacion: "aceptado" },
          });

      await tx.invitacionNegocio.update({
        where: { id: inv.id },
        data: { usadaPor: usuarioId, usadaEn: new Date() },
      });
      return membresia;
    });

    res.json({ membresia: resultado });
  }),
);

// ---------- Analítica del negocio (dueño) ----------
negociosRouter.get(
  "/:id/analitica",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await assertDueno(negocioId, req.user!.sub);

    // IDs de los peluqueros aceptados del negocio.
    const equipo = await prisma.peluqueroEquipo.findMany({
      where: { negocioId, estadoAprobacion: "aceptado" },
      select: { usuarioId: true, usuario: { select: { nombre: true } } },
    });
    const peluqueroIds = equipo.map((e) => e.usuarioId);

    if (peluqueroIds.length === 0) {
      return res.json({ totalReservas: 0, porEstado: [], ingresoServiciosUsd: 0, porPeluquero: [] });
    }

    const [porEstado, completadas, reservasPorPeluquero] = await Promise.all([
      prisma.reservacion.groupBy({
        by: ["estadoCita"],
        where: { peluqueroId: { in: peluqueroIds } },
        _count: true,
      }),
      prisma.reservacion.findMany({
        where: { peluqueroId: { in: peluqueroIds }, estadoCita: "completada" },
        select: { servicio: { select: { precio: true } } },
      }),
      prisma.reservacion.groupBy({
        by: ["peluqueroId"],
        where: { peluqueroId: { in: peluqueroIds }, estadoCita: { in: ["confirmada", "completada"] } },
        _count: true,
      }),
    ]);

    const ingresoServiciosUsd = completadas.reduce((acc, r) => acc + Number(r.servicio.precio), 0);
    const nombreDe = new Map(equipo.map((e) => [e.usuarioId, e.usuario.nombre]));

    res.json({
      totalReservas: porEstado.reduce((a, e) => a + e._count, 0),
      porEstado: porEstado.map((e) => ({ estado: e.estadoCita, total: e._count })),
      ingresoServiciosUsd: Number(ingresoServiciosUsd.toFixed(2)),
      porPeluquero: reservasPorPeluquero.map((r) => ({
        peluquero: nombreDe.get(r.peluqueroId) ?? `#${r.peluqueroId}`,
        reservas: r._count,
      })),
    });
  }),
);

// ---------- Liquidación por empleado (cuánto de la fianza corresponde a cada uno) ----------
// La fianza va a la cuenta del negocio; este desglose dice cuánto generó cada profesional
// para que el dueño le pague su parte. Por defecto, del mes en curso.
negociosRouter.get(
  "/:id/liquidacion",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await assertDueno(negocioId, req.user!.sub);

    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const desde =
      typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde)
        ? new Date(`${req.query.desde}T00:00:00`)
        : inicioMes;

    const equipo = await prisma.peluqueroEquipo.findMany({
      where: { negocioId, estadoAprobacion: "aceptado" },
      select: { usuarioId: true, usuario: { select: { nombre: true } } },
    });
    const ids = equipo.map((e) => e.usuarioId);
    const parteNegocioPorFianza = calcularSplitFianza().alNegocioUsd;

    if (ids.length === 0) {
      return res.json({ desde: desde.toISOString().slice(0, 10), parteNegocioPorFianza, empleados: [], totalReservas: 0, totalNegocioUsd: 0 });
    }

    const grupos = await prisma.reservacion.groupBy({
      by: ["peluqueroId"],
      where: { peluqueroId: { in: ids }, pagoReservaStatus: "pagado", createdAt: { gte: desde } },
      _count: true,
    });
    const countDe = new Map(grupos.map((g) => [g.peluqueroId, g._count]));

    const empleados = equipo
      .map((e) => {
        const n = countDe.get(e.usuarioId) ?? 0;
        return {
          peluquero: e.usuario.nombre,
          reservasPagadas: n,
          fianzaNegocioUsd: Number((n * parteNegocioPorFianza).toFixed(2)),
        };
      })
      .sort((a, b) => b.reservasPagadas - a.reservasPagadas);

    res.json({
      desde: desde.toISOString().slice(0, 10),
      parteNegocioPorFianza,
      comisionPlataformaUsd: env.fianzaComisionUsd,
      empleados,
      totalReservas: empleados.reduce((a, e) => a + e.reservasPagadas, 0),
      totalNegocioUsd: Number(empleados.reduce((a, e) => a + e.fianzaNegocioUsd, 0).toFixed(2)),
    });
  }),
);
