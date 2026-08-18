import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { auditar } from "../lib/audit.js";
import { revocarTodos } from "../lib/refresh.js";

export const superadminRouter = Router();

// Todas las rutas requieren rol superadmin.
superadminRouter.use(requireAuth, requireRole("superadmin"));

// ---------- Métricas financieras globales ----------
superadminRouter.get(
  "/metricas",
  asyncHandler(async (_req, res) => {
    const [negocios, negociosActivos, reservasPagadas, usuarios] = await Promise.all([
      prisma.negocio.count(),
      prisma.negocio.count({ where: { estadoSuscripcion: { in: ["activo", "prueba"] } } }),
      prisma.reservacion.count({ where: { pagoReservaStatus: "pagado" } }),
      prisma.usuario.groupBy({ by: ["rol"], _count: true }),
    ]);

    res.json({
      negocios,
      negociosActivos,
      reservasPagadas,
      // Ingreso por fianzas = nº de reservas pagadas * $2 (tasa fija de la plataforma).
      ingresoFianzasUsd: Number((reservasPagadas * env.fianzaUsd).toFixed(2)),
      usuariosPorRol: usuarios.map((u) => ({ rol: u.rol, total: u._count })),
    });
  }),
);

// ---------- Listado de negocios ----------
superadminRouter.get(
  "/negocios",
  asyncHandler(async (_req, res) => {
    const negocios = await prisma.negocio.findMany({
      select: {
        id: true,
        nombreComercial: true,
        estadoSuscripcion: true,
        suscripcionHasta: true,
        createdAt: true,
        dueno: { select: { nombre: true, email: true } },
        _count: { select: { equipo: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ negocios });
  }),
);

// ---------- Cambiar estado de suscripción (banear/suspender/reactivar) ----------
const suscripcionSchema = z.object({
  estadoSuscripcion: z.enum(["activo", "vencido", "prueba"]),
  suscripcionHasta: z.string().datetime().optional(),
});

superadminRouter.patch(
  "/negocios/:id/suscripcion",
  asyncHandler(async (req, res) => {
    const data = suscripcionSchema.parse(req.body);
    const existe = await prisma.negocio.findUnique({ where: { id: req.params.id } });
    if (!existe) throw NotFound("Negocio no encontrado");

    const negocio = await prisma.negocio.update({
      where: { id: req.params.id },
      data: {
        estadoSuscripcion: data.estadoSuscripcion,
        ...(data.suscripcionHasta ? { suscripcionHasta: new Date(data.suscripcionHasta) } : {}),
      },
    });
    await auditar(req.user!.sub, "suscripcion_cambiada", `negocio=${negocio.id} estado=${data.estadoSuscripcion}`);
    res.json({ negocio });
  }),
);

// ---------- Listado de usuarios + baneo ----------
superadminRouter.get(
  "/usuarios",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const usuarios = await prisma.usuario.findMany({
      where: q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : undefined,
      select: { id: true, nombre: true, email: true, rol: true, bloqueado: true, emailVerificadoEn: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ usuarios });
  }),
);

superadminRouter.patch(
  "/usuarios/:id/estado",
  asyncHandler(async (req, res) => {
    const { bloqueado } = z.object({ bloqueado: z.boolean() }).parse(req.body);
    const id = Number(req.params.id);
    const usuario = await prisma.usuario.findUnique({ where: { id } });
    if (!usuario) throw NotFound("Usuario no encontrado");
    if (usuario.rol === "superadmin") throw BadRequest("No se puede banear a un superadmin");

    await prisma.usuario.update({ where: { id }, data: { bloqueado } });
    if (bloqueado) await revocarTodos(id); // corta sesiones activas
    await auditar(req.user!.sub, bloqueado ? "usuario_baneado" : "usuario_reactivado", `usuario=${id}`);
    res.json({ ok: true, bloqueado });
  }),
);

// ---------- Ingresos por fianzas agrupados por día (últimos N días) ----------
superadminRouter.get(
  "/ingresos",
  asyncHandler(async (req, res) => {
    const dias = Math.min(Number(req.query.dias ?? 30), 365);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    // Agrupa por día las reservas pagadas usando SQL (created_at::date).
    const filas = await prisma.$queryRaw<{ dia: Date; total: bigint }[]>`
      SELECT created_at::date AS dia, COUNT(*)::bigint AS total
      FROM reservaciones
      WHERE pago_reserva_status = 'pagado' AND created_at >= ${desde}
      GROUP BY dia ORDER BY dia ASC`;
    res.json({
      dias,
      serie: filas.map((f) => ({
        dia: f.dia.toISOString().slice(0, 10),
        reservas: Number(f.total),
        ingresoUsd: Number((Number(f.total) * env.fianzaUsd).toFixed(2)),
      })),
    });
  }),
);

// ---------- Log de auditoría ----------
superadminRouter.get(
  "/auditoria",
  asyncHandler(async (_req, res) => {
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ logs });
  }),
);
