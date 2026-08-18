import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { storage } from "../lib/storage.js";

export const uploadsRouter = Router();

// Multer en memoria: el proveedor de storage decide dónde persiste (disco local o S3/B2).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (_req, file, cb) => {
    const permitidos = ["image/jpeg", "image/png", "image/webp"];
    cb(null, permitidos.includes(file.mimetype));
  },
});

async function guardarArchivo(file: Express.Multer.File): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase();
  return storage.guardar(file.buffer, ext, file.mimetype);
}

// ---------- Foto de perfil del peluquero (sobre sí mismo) ----------
uploadsRouter.post(
  "/foto",
  requireAuth,
  requireRole("peluquero"),
  upload.single("imagen"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest("Falta la imagen (campo 'imagen', jpg/png/webp, máx 3MB)");
    const fotoUrl = await guardarArchivo(req.file);
    await prisma.usuario.update({ where: { id: req.user!.sub }, data: { fotoUrl } });
    res.status(201).json({ fotoUrl });
  }),
);

// ---------- Imagen de un servicio (peluquero dueño del servicio) ----------
uploadsRouter.post(
  "/servicio/:servicioId",
  requireAuth,
  requireRole("peluquero"),
  upload.single("imagen"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest("Falta la imagen (campo 'imagen', jpg/png/webp, máx 3MB)");
    const id = Number(req.params.servicioId);
    const servicio = await prisma.servicio.findUnique({ where: { id } });
    if (!servicio) throw NotFound("Servicio no encontrado");
    if (servicio.peluqueroId !== req.user!.sub) throw Forbidden("No es tu servicio");

    const imagenUrl = await guardarArchivo(req.file);
    await prisma.servicio.update({ where: { id }, data: { imagenUrl } });
    res.status(201).json({ imagenUrl });
  }),
);

// ---------- Logo del negocio (dueño) ----------
uploadsRouter.post(
  "/logo/:negocioId",
  requireAuth,
  requireRole("admin_negocio"),
  upload.single("imagen"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest("Falta la imagen (campo 'imagen', jpg/png/webp, máx 3MB)");
    const negocio = await prisma.negocio.findUnique({ where: { id: req.params.negocioId } });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (negocio.duenoId !== req.user!.sub) throw Forbidden("No eres dueño de este negocio");

    const logoUrl = await guardarArchivo(req.file);
    await prisma.negocio.update({ where: { id: negocio.id }, data: { logoUrl } });
    res.status(201).json({ logoUrl });
  }),
);

// ---------- Foto de portada del negocio (dueño) ----------
uploadsRouter.post(
  "/cover/:negocioId",
  requireAuth,
  requireRole("admin_negocio"),
  upload.single("imagen"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw BadRequest("Falta la imagen (campo 'imagen', jpg/png/webp, máx 3MB)");
    const negocio = await prisma.negocio.findUnique({ where: { id: req.params.negocioId } });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (negocio.duenoId !== req.user!.sub) throw Forbidden("No eres dueño de este negocio");

    const coverUrl = await guardarArchivo(req.file);
    await prisma.negocio.update({ where: { id: negocio.id }, data: { coverUrl } });
    res.status(201).json({ coverUrl });
  }),
);
