import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { authOpcional, requireAuth, requireRole } from "../middleware/auth.js";

// Analítica de producto propia. Responde a "¿dónde se cae la gente antes de
// reservar?", que es lo que no se puede deducir de la tabla de reservas: las
// reservas solo cuentan a quien llegó al final.
//
// Los eventos se guardan en la base de datos del proyecto. No se envía nada a
// terceros a propósito: ni Google ni nadie necesita saber qué barbería mira un
// cliente, y así no hace falta un consentimiento aparte para esto.

export const eventosRouter = Router();

// Catálogo cerrado de eventos. Si fuera texto libre, en tres meses habría
// quince nombres para el mismo paso y el embudo no se podría leer.
export const EVENTOS = [
  "landing_vista",
  "busqueda_realizada",
  "negocio_visto",
  "profesional_elegido",
  "servicio_elegido",
  "slots_vistos",
  "slot_elegido",
  "reserva_iniciada",
  "pago_abierto",
  "pago_completado",
  "pago_fallido",
  "registro_completado",
  "login_completado",
  "espera_apuntada",
  "resena_enviada",
] as const;

const eventoSchema = z.object({
  nombre: z.enum(EVENTOS),
  // Identificador anónimo que genera el navegador. No es PII.
  sesion: z.string().trim().min(8).max(40),
  ruta: z.string().trim().max(160).optional(),
  // Metadatos acotados: números y textos cortos. Sin esto, cualquiera podría
  // usar el endpoint público como almacenamiento gratuito.
  meta: z
    .record(z.string().max(40), z.union([z.string().max(120), z.number(), z.boolean()]))
    .optional(),
});

const loteSchema = z.object({ eventos: z.array(eventoSchema).min(1).max(20) });

// Público (con sesión opcional): el embudo empieza antes de registrarse.
eventosRouter.post(
  "/",
  authOpcional,
  asyncHandler(async (req, res) => {
    if (!env.analiticaActiva) return res.status(202).json({ guardados: 0, desactivada: true });

    const { eventos } = loteSchema.parse(req.body);
    await prisma.eventoProducto.createMany({
      data: eventos.map((e) => ({
        nombre: e.nombre,
        sesion: e.sesion,
        ruta: e.ruta ?? null,
        usuarioId: req.user?.sub ?? null,
        meta: (e.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
    res.status(202).json({ guardados: eventos.length });
  }),
);

// ---------- Embudo (solo superadmin) ----------

eventosRouter.get(
  "/embudo",
  requireAuth,
  requireRole("superadmin"),
  asyncHandler(async (req, res) => {
    const { dias } = z
      .object({ dias: z.coerce.number().int().min(1).max(365).default(30) })
      .parse(req.query);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    // Se cuentan SESIONES distintas, no eventos: diez recargas de la misma
    // persona no son diez visitas y falsearían cada tasa de conversión.
    const filas = await prisma.$queryRaw<{ nombre: string; sesiones: bigint; eventos: bigint }[]>`
      SELECT nombre, COUNT(DISTINCT sesion) AS sesiones, COUNT(*) AS eventos
      FROM eventos_producto
      WHERE created_at >= ${desde}
      GROUP BY nombre
    `;
    const porNombre = new Map(filas.map((f) => [f.nombre, Number(f.sesiones)]));

    // Pasos del embudo principal, en orden.
    const PASOS = [
      "landing_vista",
      "negocio_visto",
      "servicio_elegido",
      "slot_elegido",
      "pago_abierto",
      "pago_completado",
    ] as const;

    const base = porNombre.get(PASOS[0]) ?? 0;
    let anterior = base;
    const embudo = PASOS.map((paso) => {
      const sesiones = porNombre.get(paso) ?? 0;
      const fila = {
        paso,
        sesiones,
        // Respecto al primer paso y respecto al paso anterior: la primera dice
        // cuánto se pierde en total, la segunda dónde exactamente.
        pctDesdeInicio: base ? Number(((sesiones / base) * 100).toFixed(1)) : 0,
        pctDesdeAnterior: anterior ? Number(((sesiones / anterior) * 100).toFixed(1)) : 0,
      };
      anterior = sesiones;
      return fila;
    });

    res.json({
      dias,
      embudo,
      otros: filas
        .filter((f) => !PASOS.includes(f.nombre as (typeof PASOS)[number]))
        .map((f) => ({
          nombre: f.nombre,
          sesiones: Number(f.sesiones),
          eventos: Number(f.eventos),
        })),
    });
  }),
);
