import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { paginationSchema, paginar, metaPaginacion } from "../lib/pagination.js";

export const resenasRouter = Router();

// ---------- Crear reseña de una reserva completada ----------
const crearSchema = z.object({
  reservacionId: z.number().int().positive(),
  puntuacion: z.number().int().min(1).max(5),
  comentario: z.string().max(500).optional(),
});

resenasRouter.post(
  "/",
  requireAuth,
  // Cualquier usuario que haya sido cliente de la cita (un dueño o un profesional
  // también pueden reservar como clientes de otro negocio).
  requireRole("cliente", "admin_negocio", "peluquero"),
  asyncHandler(async (req, res) => {
    const data = crearSchema.parse(req.body);
    const clienteId = req.user!.sub;

    const reserva = await prisma.reservacion.findUnique({
      where: { id: data.reservacionId },
      include: { peluquero: { include: { membresias: { where: { estadoAprobacion: "aceptado" } } } } },
    });
    if (!reserva) throw NotFound("Reserva no encontrada");
    if (reserva.clienteId !== clienteId) throw Forbidden("No es tu reserva");
    if (reserva.estadoCita !== "completada") {
      throw BadRequest("Solo puedes reseñar una cita completada");
    }

    const yaExiste = await prisma.resena.findUnique({ where: { reservacionId: reserva.id } });
    if (yaExiste) throw Conflict("Ya reseñaste esta reserva", "RESENA_EXISTENTE");

    // Negocio al que pertenece el profesional (primera membresía aceptada).
    const negocioId = reserva.peluquero.membresias[0]?.negocioId;
    if (!negocioId) throw BadRequest("El profesional no tiene negocio asociado");

    const resena = await prisma.$transaction(async (tx) => {
      const creada = await tx.resena.create({
        data: {
          reservacionId: reserva.id,
          clienteId,
          peluqueroId: reserva.peluqueroId,
          negocioId,
          puntuacion: data.puntuacion,
          comentario: data.comentario ?? null,
        },
      });

      // Recalcula el rating agregado del negocio.
      const agg = await tx.resena.aggregate({
        where: { negocioId },
        _avg: { puntuacion: true },
        _count: true,
      });
      await tx.negocio.update({
        where: { id: negocioId },
        data: {
          ratingPromedio: Number((agg._avg.puntuacion ?? 0).toFixed(2)),
          ratingConteo: agg._count,
        },
      });
      return creada;
    });

    res.status(201).json({ resena });
  }),
);

// ---------- Listar reseñas de un negocio (público, paginado) ----------
resenasRouter.get(
  "/negocio/:negocioId",
  asyncHandler(async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    const where = { negocioId: req.params.negocioId };

    const [total, resenas] = await Promise.all([
      prisma.resena.count({ where }),
      prisma.resena.findMany({
        where,
        select: {
          id: true,
          puntuacion: true,
          comentario: true,
          createdAt: true,
          cliente: { select: { nombre: true } },
        },
        orderBy: { createdAt: "desc" },
        ...paginar(page, limit),
      }),
    ]);
    res.json({ resenas, meta: metaPaginacion(total, page, limit) });
  }),
);
