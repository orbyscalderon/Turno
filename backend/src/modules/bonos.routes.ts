import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { enviarEmailSeguro, emailBonoEmitido } from "../lib/email.js";
import { auditar } from "../lib/audit.js";
import { fechaISO } from "../lib/time.js";

// Bonos y paquetes de sesiones ("10 cortes por el precio de 8").
//
// Decisión importante: el dinero del paquete se cobra EN EL LOCAL, no por la
// plataforma. La plataforma solo lleva la cuenta de las sesiones. Cobrarlo aquí
// convertiría a Turno en depositario de dinero de clientes por servicios que
// presta un tercero: si el negocio cierra, la deuda sería nuestra. Así, el bono
// es solo un contador que ahorra la fianza al reservar.

export const bonosRouter = Router();

const EMAIL = z.string().trim().toLowerCase().email().max(150);

/** Comprueba que el usuario manda en ese negocio (dueño, miembro aceptado o superadmin). */
async function assertGestorDeNegocio(negocioId: string, user: { sub: number; rol: string }) {
  if (user.rol === "superadmin") return;
  const negocio = await prisma.negocio.findUnique({
    where: { id: negocioId },
    select: { duenoId: true },
  });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId === user.sub) return;
  const miembro = await prisma.peluqueroEquipo.findFirst({
    where: { negocioId, usuarioId: user.sub, estadoAprobacion: "aceptado" },
    select: { id: true },
  });
  if (!miembro) throw Forbidden("No gestionas ese negocio");
}

// ---------- Paquetes que vende el negocio ----------

const paqueteSchema = z.object({
  negocioId: z.string().min(1),
  servicioId: z.number().int().positive(),
  nombre: z.string().trim().min(2).max(100),
  sesiones: z.number().int().min(2).max(100),
  precio: z.number().nonnegative(),
  moneda: z.string().length(3).toUpperCase().default("EUR"),
  validezDias: z.number().int().min(1).max(3650).nullable().optional(),
});

bonosRouter.post(
  "/paquetes",
  requireAuth,
  requireRole("admin_negocio", "superadmin"),
  asyncHandler(async (req, res) => {
    const data = paqueteSchema.parse(req.body);
    await assertGestorDeNegocio(data.negocioId, req.user!);

    // El servicio tiene que ser de alguien del equipo: si no, un negocio podría
    // vender paquetes de un servicio ajeno.
    const servicio = await prisma.servicio.findUnique({ where: { id: data.servicioId } });
    if (!servicio) throw NotFound("Servicio no encontrado");
    const delEquipo = await prisma.peluqueroEquipo.findFirst({
      where: {
        negocioId: data.negocioId,
        usuarioId: servicio.peluqueroId,
        estadoAprobacion: "aceptado",
      },
      select: { id: true },
    });
    if (!delEquipo) throw BadRequest("Ese servicio no pertenece a tu equipo");

    const paquete = await prisma.paquete.create({
      data: {
        negocioId: data.negocioId,
        servicioId: data.servicioId,
        nombre: data.nombre,
        sesiones: data.sesiones,
        precio: data.precio,
        moneda: data.moneda,
        validezDias: data.validezDias ?? null,
      },
    });
    res.status(201).json({ paquete });
  }),
);

bonosRouter.get(
  "/paquetes",
  asyncHandler(async (req, res) => {
    const { negocioId } = z.object({ negocioId: z.string().min(1) }).parse(req.query);
    const paquetes = await prisma.paquete.findMany({
      where: { negocioId, activo: true },
      orderBy: { createdAt: "asc" },
      include: {
        servicio: { select: { id: true, nombreServicio: true, precio: true, moneda: true } },
      },
    });
    res.json({ paquetes });
  }),
);

bonosRouter.patch(
  "/paquetes/:id",
  requireAuth,
  requireRole("admin_negocio", "superadmin"),
  asyncHandler(async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const data = z
      .object({
        nombre: z.string().trim().min(2).max(100).optional(),
        precio: z.number().nonnegative().optional(),
        validezDias: z.number().int().min(1).max(3650).nullable().optional(),
        activo: z.boolean().optional(),
      })
      .parse(req.body);

    const paquete = await prisma.paquete.findUnique({ where: { id } });
    if (!paquete) throw NotFound("Paquete no encontrado");
    await assertGestorDeNegocio(paquete.negocioId, req.user!);

    // Las sesiones no se editan: cambiarlas alteraría bonos ya vendidos.
    const actualizado = await prisma.paquete.update({ where: { id }, data });
    res.json({ paquete: actualizado });
  }),
);

// ---------- Emitir un bono a un cliente ----------

bonosRouter.post(
  "/emitir",
  requireAuth,
  requireRole("admin_negocio", "peluquero", "superadmin"),
  asyncHandler(async (req, res) => {
    const { paqueteId, clienteEmail } = z
      .object({ paqueteId: z.number().int().positive(), clienteEmail: EMAIL })
      .parse(req.body);

    const paquete = await prisma.paquete.findUnique({
      where: { id: paqueteId },
      include: {
        negocio: { select: { id: true, nombreComercial: true } },
        servicio: { select: { nombreServicio: true } },
      },
    });
    if (!paquete || !paquete.activo) throw NotFound("Paquete no disponible");
    await assertGestorDeNegocio(paquete.negocioId, req.user!);

    const cliente = await prisma.usuario.findUnique({ where: { email: clienteEmail } });
    if (!cliente) {
      throw BadRequest(
        "Ese email no tiene cuenta en Turno. El cliente debe registrarse para poder usar el bono al reservar.",
        "CLIENTE_SIN_CUENTA",
      );
    }

    const expiraEn = paquete.validezDias
      ? new Date(Date.now() + paquete.validezDias * 24 * 60 * 60 * 1000)
      : null;

    const bono = await prisma.bonoCliente.create({
      data: {
        paqueteId: paquete.id,
        clienteId: cliente.id,
        emitidoPor: req.user!.sub,
        sesionesTotales: paquete.sesiones,
        expiraEn,
      },
    });

    await auditar(
      req.user!.sub,
      "bono_emitido",
      `bono ${bono.id} (${paquete.sesiones} sesiones de ${paquete.servicio.nombreServicio}) a ${cliente.email}`,
    );

    const tpl = emailBonoEmitido({
      nombre: cliente.nombre,
      negocio: paquete.negocio.nombreComercial,
      paquete: paquete.nombre,
      sesiones: paquete.sesiones,
      caduca: expiraEn ? fechaISO(expiraEn) : null,
      url: `${env.appUrl}/`,
    });
    await enviarEmailSeguro({ to: cliente.email, subject: tpl.subject, html: tpl.html });

    res.status(201).json({ bono });
  }),
);

// ---------- Consultas ----------

bonosRouter.get(
  "/mios",
  requireAuth,
  asyncHandler(async (req, res) => {
    const bonos = await prisma.bonoCliente.findMany({
      where: { clienteId: req.user!.sub },
      orderBy: { createdAt: "desc" },
      include: {
        paquete: {
          include: {
            negocio: { select: { nombreComercial: true, slug: true } },
            servicio: { select: { id: true, nombreServicio: true } },
          },
        },
      },
    });
    const ahora = new Date();
    res.json({
      bonos: bonos.map((b) => ({
        id: b.id,
        nombre: b.paquete.nombre,
        negocio: b.paquete.negocio,
        servicio: b.paquete.servicio,
        sesionesTotales: b.sesionesTotales,
        sesionesUsadas: b.sesionesUsadas,
        restantes: b.sesionesTotales - b.sesionesUsadas,
        expiraEn: b.expiraEn,
        caducado: Boolean(b.expiraEn && b.expiraEn <= ahora),
        agotado: b.sesionesUsadas >= b.sesionesTotales,
      })),
    });
  }),
);

bonosRouter.get(
  "/negocio/:negocioId",
  requireAuth,
  requireRole("admin_negocio", "peluquero", "superadmin"),
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.params.negocioId);
    await assertGestorDeNegocio(negocioId, req.user!);

    const bonos = await prisma.bonoCliente.findMany({
      where: { paquete: { negocioId } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        cliente: { select: { id: true, nombre: true, email: true } },
        paquete: { select: { nombre: true, sesiones: true, precio: true, moneda: true } },
      },
    });

    const vendidos = bonos.length;
    const sesionesVendidas = bonos.reduce((a, b) => a + b.sesionesTotales, 0);
    const sesionesUsadas = bonos.reduce((a, b) => a + b.sesionesUsadas, 0);
    const ingresos = bonos.reduce((a, b) => a + Number(b.paquete.precio), 0);

    res.json({
      resumen: {
        vendidos,
        sesionesVendidas,
        sesionesUsadas,
        ingresos: Number(ingresos.toFixed(2)),
      },
      bonos,
    });
  }),
);
