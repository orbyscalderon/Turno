import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const storefrontRouter = Router();

// Catálogo PÚBLICO de un negocio (tienda online). Sin autenticación.
storefrontRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const negocio = await prisma.negocio.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true, nombreComercial: true, telefonoContacto: true, logoUrl: true, coverUrl: true,
        direccion: true, perfil: true, categoria: true, estadoSuscripcion: true,
      },
    });
    if (!negocio || negocio.estadoSuscripcion === "vencido") throw NotFound("Tienda no disponible");
    const productos = await prisma.producto.findMany({
      where: { negocioId: negocio.id, activo: true },
      select: { id: true, nombre: true, precioVenta: true, impuestoPct: true, categoria: true, sku: true, unidad: true, stock: true },
      orderBy: { nombre: "asc" },
    });
    res.json({ negocio, productos });
  }),
);
