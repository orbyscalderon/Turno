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
import { estaVigente, filtroNegocioVigente, diasRestantes } from "../lib/suscripcion.js";
import { lockNegocio } from "../lib/locks.js";
import { zonaValida, fechaUTC, fechaISO } from "../lib/time.js";
import { auditar } from "../lib/audit.js";

export const negociosRouter = Router();

// Verifica que el usuario autenticado sea dueño del negocio indicado.
async function assertDueno(negocioId: string, usuarioId: number, rol?: string) {
  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId !== usuarioId && rol !== "superadmin") {
    throw Forbidden("No eres dueño de este negocio");
  }
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

const SELECT_PUBLICO = {
  id: true,
  nombreComercial: true,
  categoria: true,
  slug: true,
  direccion: true,
  telefonoContacto: true,
  logoUrl: true,
  coverUrl: true,
  ratingPromedio: true,
  ratingConteo: true,
  lat: true,
  lng: true,
} as const;

// ---------- Listado público de negocios (solo suscripción vigente) ----------
negociosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const ubicacion = typeof req.query.ubicacion === "string" ? req.query.ubicacion.trim() : undefined;
    const categoria = typeof req.query.categoria === "string" ? req.query.categoria : undefined;
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const radioKm = Math.min(Math.max(Number(req.query.radioKm ?? 50), 1), 500);
    const geo =
      lat !== undefined &&
      lng !== undefined &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180;
    const { page, limit } = paginationSchema.parse(req.query);

    // --- Búsqueda por cercanía: se resuelve EN LA BASE DE DATOS ---
    // Antes se cargaban todos los negocios en memoria para ordenarlos por distancia.
    // Aquí se acota primero con una caja (usa el índice lat/lng) y se calcula la
    // distancia real en SQL, paginando sin traer el resto de la tabla.
    if (geo) {
      const gradosLat = radioKm / 111.32;
      const cosLat = Math.max(Math.cos((lat! * Math.PI) / 180), 0.01);
      const gradosLng = radioKm / (111.32 * cosLat);

      const condiciones: Prisma.Sql[] = [
        Prisma.sql`n.estado_suscripcion IN ('activo','prueba')`,
        Prisma.sql`(n.suscripcion_hasta IS NULL OR n.suscripcion_hasta > now())`,
        Prisma.sql`n.lat IS NOT NULL AND n.lng IS NOT NULL`,
        Prisma.sql`n.lat BETWEEN ${lat! - gradosLat} AND ${lat! + gradosLat}`,
        Prisma.sql`n.lng BETWEEN ${lng! - gradosLng} AND ${lng! + gradosLng}`,
      ];
      if (q) condiciones.push(Prisma.sql`n.nombre_comercial ILIKE ${`%${q}%`}`);
      if (ubicacion) condiciones.push(Prisma.sql`n.direccion ILIKE ${`%${ubicacion}%`}`);
      if (categoria) condiciones.push(Prisma.sql`n.categoria = ${categoria}`);
      const where = Prisma.join(condiciones, " AND ");

      // Haversine en SQL.
      const distancia = Prisma.sql`
        6371 * 2 * asin(sqrt(
          power(sin(radians(n.lat - ${lat!}) / 2), 2) +
          cos(radians(${lat!})) * cos(radians(n.lat)) *
          power(sin(radians(n.lng - ${lng!}) / 2), 2)
        ))`;

      const base = Prisma.sql`
        FROM negocios n
        WHERE ${where}`;

      const [filas, totales] = await Promise.all([
        prisma.$queryRaw<
          {
            id: string;
            nombreComercial: string;
            categoria: string;
            slug: string;
            direccion: string;
            telefonoContacto: string;
            logoUrl: string | null;
            coverUrl: string | null;
            ratingPromedio: number;
            ratingConteo: number;
            lat: number;
            lng: number;
            distanciaKm: number;
          }[]
        >`
          SELECT * FROM (
            SELECT n.id,
                   n.nombre_comercial   AS "nombreComercial",
                   n.categoria,
                   n.slug,
                   n.direccion,
                   n.telefono_contacto  AS "telefonoContacto",
                   n.logo_url           AS "logoUrl",
                   n.cover_url          AS "coverUrl",
                   n.rating_promedio    AS "ratingPromedio",
                   n.rating_conteo      AS "ratingConteo",
                   n.lat, n.lng,
                   ${distancia} AS "distanciaKm"
            ${base}
          ) t
          WHERE t."distanciaKm" <= ${radioKm}
          ORDER BY t."distanciaKm" ASC
          LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        prisma.$queryRaw<{ total: bigint }[]>`
          SELECT count(*)::bigint AS total FROM (
            SELECT ${distancia} AS "distanciaKm" ${base}
          ) t
          WHERE t."distanciaKm" <= ${radioKm}`,
      ]);

      const total = Number(totales[0]?.total ?? 0);
      return res.json({
        negocios: filas.map((n) => ({ ...n, distanciaKm: Number(n.distanciaKm.toFixed(2)) })),
        meta: metaPaginacion(total, page, limit),
      });
    }

    // --- Búsqueda normal (sin coordenadas) ---
    const where: Prisma.NegocioWhereInput = {
      // Regla de negocio: los negocios sin suscripción vigente se ocultan al cliente.
      ...filtroNegocioVigente(),
      ...(q ? { nombreComercial: { contains: q, mode: "insensitive" } } : {}),
      ...(ubicacion ? { direccion: { contains: ubicacion, mode: "insensitive" } } : {}),
      ...(categoria ? { categoria } : {}),
    };

    const [total, negocios] = await Promise.all([
      prisma.negocio.count({ where }),
      prisma.negocio.findMany({
        where,
        select: SELECT_PUBLICO,
        orderBy: [{ ratingPromedio: "desc" }, { nombreComercial: "asc" }],
        ...paginar(page, limit),
      }),
    ]);
    res.json({ negocios, meta: metaPaginacion(total, page, limit) });
  }),
);

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
        timezone: true,
        lat: true,
        lng: true,
        logoUrl: true,
        coverUrl: true,
        plan: true,
        intervaloPlan: true,
        estadoSuscripcion: true,
        suscripcionHasta: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      negocios: negocios.map((n) => ({
        ...n,
        // Estado efectivo: un negocio en "prueba" con la fecha pasada ya NO es vigente.
        vigente: estaVigente(n),
        diasRestantes: diasRestantes(n.suscripcionHasta),
      })),
    });
  }),
);

// ---------- Detalle público con profesionales aceptados ----------
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
        coverUrl: true,
        timezone: true,
        lat: true,
        lng: true,
        ratingPromedio: true,
        ratingConteo: true,
        estadoSuscripcion: true,
        suscripcionHasta: true,
        equipo: {
          where: { estadoAprobacion: "aceptado" },
          select: {
            usuario: { select: { id: true, nombre: true, telefono: true, fotoUrl: true } },
          },
        },
      },
    });
    if (!negocio) throw NotFound("Negocio no encontrado");
    // La fecha manda: una prueba caducada deja de ser pública al instante.
    if (!estaVigente(negocio)) throw NotFound("Negocio no disponible");

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
        coverUrl: negocio.coverUrl,
        timezone: negocio.timezone,
        lat: negocio.lat,
        lng: negocio.lng,
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

const TIMEZONE = z
  .string()
  .max(64)
  .refine(zonaValida, "Zona horaria IANA no válida (ej. Europe/Madrid, America/Bogota)");

const crearNegocioSchema = z.object({
  nombreComercial: z.string().trim().min(2).max(150),
  categoria: z.string().trim().min(2).max(40).default("otro"),
  // Rubro del motor de nicho (activa sus módulos). Debe existir en el catálogo.
  perfil: z.enum(SLUGS_PERFIL as [string, ...string[]]).optional(),
  direccion: z.string().trim().min(3),
  telefonoContacto: z.string().trim().min(6).max(20),
  // Zona horaria del local: de ella dependen la agenda, los slots y los recordatorios.
  timezone: TIMEZONE.optional(),
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
    // En modo "rubro fijo", todos los negocios de este despliegue son de ese rubro.
    const perfilFinal = env.rubroFijo || data.perfil || null;

    if (env.exigirEmailVerificado) {
      const yo = await prisma.usuario.findUnique({
        where: { id: duenoId },
        select: { emailVerificadoEn: true },
      });
      if (!yo?.emailVerificadoEn) {
        throw Forbidden("Confirma tu email antes de crear un negocio.");
      }
    }

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
        categoria: env.rubroFijo || data.categoria,
        perfil: perfilFinal,
        direccion: data.direccion,
        telefonoContacto: data.telefonoContacto,
        timezone: data.timezone ?? env.timezoneDefecto,
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
  nombreComercial: z.string().trim().min(2).max(150).optional(),
  direccion: z.string().trim().min(3).optional(),
  categoria: z.string().trim().min(2).max(40).optional(),
  telefonoContacto: z.string().trim().min(6).max(20).optional(),
  timezone: TIMEZONE.optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

negociosRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    await assertDueno(req.params.id, req.user!.sub, req.user!.rol);
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
    const negocio = await assertDueno(req.params.id, req.user!.sub, req.user!.rol);
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
    const limite = limitePeluqueros(negocio.plan, negocio.estadoSuscripcion);
    res.json({ miembros, activos, limite });
  }),
);

// ---------- Admin aprueba/rechaza una solicitud (respetando el límite del plan) ----------
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
    await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    // Lock por negocio para que dos aprobaciones simultáneas no superen el límite.
    const resultado = await prisma.$transaction(async (tx) => {
      await lockNegocio(tx, negocioId);

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

// ---------- Dar de baja a un profesional del equipo ----------
// No se borran sus citas: se cancela solo lo que queda por delante, para que el
// cliente no se quede con una cita que nadie va a atender.
negociosRouter.delete(
  "/:id/equipo/:miembroId",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    const miembroId = Number(req.params.miembroId);
    const negocio = await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    const miembro = await prisma.peluqueroEquipo.findFirst({
      where: { id: miembroId, negocioId },
    });
    if (!miembro) throw NotFound("Miembro no encontrado");
    if (miembro.usuarioId === negocio.duenoId) {
      throw BadRequest("El dueño no puede darse de baja de su propio equipo", "ES_DUENO");
    }

    const hoy = fechaUTC(fechaISO(new Date()));
    const [, citas] = await prisma.$transaction([
      prisma.peluqueroEquipo.delete({ where: { id: miembroId } }),
      prisma.reservacion.updateMany({
        where: { peluqueroId: miembro.usuarioId, estadoCita: "confirmada", fecha: { gte: hoy } },
        data: {
          estadoCita: "cancelada",
          canceladaEn: new Date(),
          canceladaPor: "negocio",
          motivoCancelacion: "El profesional ya no trabaja en el negocio",
        },
      }),
    ]);

    await auditar(
      req.user!.sub,
      "profesional_dado_de_baja",
      `negocio=${negocioId} usuario=${miembro.usuarioId} citasCanceladas=${citas.count}`,
    );
    res.json({ ok: true, citasCanceladas: citas.count });
  }),
);

// ---------- Admin genera un link de invitación único ----------
negociosRouter.post(
  "/:id/invitaciones",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await assertDueno(negocioId, req.user!.sub, req.user!.rol);

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
      await lockNegocio(tx, inv.negocioId);

      const negocio = await tx.negocio.findUnique({
        where: { id: inv.negocioId },
        select: { plan: true, estadoSuscripcion: true },
      });
      if (!negocio) throw NotFound("Negocio no encontrado");

      const yaMiembro = await tx.peluqueroEquipo.findUnique({
        where: { unique_peluquero_negocio: { negocioId: inv.negocioId, usuarioId } },
      });
      if (yaMiembro && yaMiembro.estadoAprobacion === "aceptado") {
        throw Conflict("Ya perteneces a este negocio", "YA_MIEMBRO");
      }

      const activos = await tx.peluqueroEquipo.count({
        where: { negocioId: inv.negocioId, estadoAprobacion: "aceptado" },
      });
      // El límite es el DEL PLAN, igual que al aprobar una solicitud: antes esta
      // ruta usaba un tope fijo de entorno y permitía saltarse el plan Básico.
      const maxPel = limitePeluqueros(negocio.plan, negocio.estadoSuscripcion);
      if (activos >= maxPel) {
        throw Conflict(
          `El negocio ya alcanzó el máximo de ${maxPel} profesionales de su plan`,
          "LIMITE_PELUQUEROS",
        );
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
    await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    // IDs de los peluqueros aceptados del negocio.
    const equipo = await prisma.peluqueroEquipo.findMany({
      where: { negocioId, estadoAprobacion: "aceptado" },
      select: { usuarioId: true, usuario: { select: { nombre: true } } },
    });
    const peluqueroIds = equipo.map((e) => e.usuarioId);

    if (peluqueroIds.length === 0) {
      return res.json({
        totalReservas: 0,
        porEstado: [],
        ingresoServiciosUsd: 0,
        ingresoPorMoneda: [],
        porPeluquero: [],
      });
    }

    const [porEstado, ingresos, reservasPorPeluquero] = await Promise.all([
      prisma.reservacion.groupBy({
        by: ["estadoCita"],
        where: { peluqueroId: { in: peluqueroIds } },
        _count: true,
      }),
      // Suma agregada EN SQL: antes se traían todas las citas completadas a memoria.
      prisma.$queryRaw<{ moneda: string; total: string; n: number }[]>`
        SELECT s.moneda, SUM(s.precio)::text AS total, COUNT(*)::int AS n
        FROM reservaciones r
        JOIN servicios s ON s.id = r.servicio_id
        WHERE r.peluquero_id IN (${Prisma.join(peluqueroIds)})
          AND r.estado_cita = 'completada'
        GROUP BY s.moneda`,
      prisma.reservacion.groupBy({
        by: ["peluqueroId"],
        where: {
          peluqueroId: { in: peluqueroIds },
          estadoCita: { in: ["confirmada", "completada"] },
        },
        _count: true,
      }),
    ]);

    const nombreDe = new Map(equipo.map((e) => [e.usuarioId, e.usuario.nombre]));
    const ingresoPorMoneda = ingresos.map((i) => ({
      moneda: i.moneda || "USD",
      total: Number(Number(i.total).toFixed(2)),
      citas: i.n,
    }));

    res.json({
      totalReservas: porEstado.reduce((a, e) => a + e._count, 0),
      porEstado: porEstado.map((e) => ({ estado: e.estadoCita, total: e._count })),
      // Compatibilidad: total de la moneda USD (el desglose completo va aparte).
      ingresoServiciosUsd: ingresoPorMoneda.find((i) => i.moneda === "USD")?.total ?? 0,
      ingresoPorMoneda,
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
    await assertDueno(negocioId, req.user!.sub, req.user!.rol);

    const hoy = new Date();
    const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const desde =
      typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde)
        ? fechaUTC(req.query.desde)
        : inicioMes;

    const equipo = await prisma.peluqueroEquipo.findMany({
      where: { negocioId, estadoAprobacion: "aceptado" },
      select: { usuarioId: true, usuario: { select: { nombre: true } } },
    });
    const ids = equipo.map((e) => e.usuarioId);
    const parteNegocioPorFianza = calcularSplitFianza().alNegocioUsd;

    if (ids.length === 0) {
      return res.json({
        desde: fechaISO(desde),
        parteNegocioPorFianza,
        empleados: [],
        totalReservas: 0,
        totalNegocioUsd: 0,
      });
    }

    const [grupos, completados] = await Promise.all([
      prisma.reservacion.groupBy({
        by: ["peluqueroId"],
        where: { peluqueroId: { in: ids }, pagoReservaStatus: "pagado", createdAt: { gte: desde } },
        _count: true,
      }),
      prisma.reservacion.groupBy({
        by: ["peluqueroId"],
        where: { peluqueroId: { in: ids }, estadoCita: "completada", completadaEn: { gte: desde } },
        _count: true,
      }),
    ]);
    const countDe = new Map(grupos.map((g) => [g.peluqueroId, g._count]));
    const completadasDe = new Map(completados.map((g) => [g.peluqueroId, g._count]));

    const empleados = equipo
      .map((e) => {
        const n = countDe.get(e.usuarioId) ?? 0;
        return {
          peluquero: e.usuario.nombre,
          reservasPagadas: n,
          citasCompletadas: completadasDe.get(e.usuarioId) ?? 0,
          fianzaNegocioUsd: Number((n * parteNegocioPorFianza).toFixed(2)),
        };
      })
      .sort((a, b) => b.reservasPagadas - a.reservasPagadas);

    res.json({
      desde: fechaISO(desde),
      parteNegocioPorFianza,
      comisionPlataformaUsd: env.fianzaComisionUsd,
      empleados,
      totalReservas: empleados.reduce((a, e) => a + e.reservasPagadas, 0),
      totalNegocioUsd: Number(empleados.reduce((a, e) => a + e.fianzaNegocioUsd, 0).toFixed(2)),
    });
  }),
);
