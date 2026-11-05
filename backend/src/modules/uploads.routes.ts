import { Router } from "express";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { storage, borrarAnterior, tipoDeImagenReal } from "../lib/storage.js";

export const uploadsRouter = Router();

// Multer en memoria: el proveedor de storage decide dónde persiste (disco local o S3/B2).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 }, // 3 MB
  fileFilter: (_req, file, cb) => {
    const permitidos = ["image/jpeg", "image/png", "image/webp"];
    cb(null, permitidos.includes(file.mimetype));
  },
});

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Guarda la imagen comprobando su contenido real.
 * La extensión y el mimetype los decide quien sube el archivo, así que la
 * extensión final se deriva de los magic bytes, no de `originalname`.
 */
async function guardarArchivo(file: Express.Multer.File): Promise<string> {
  const tipo = tipoDeImagenReal(file.buffer);
  if (!tipo) {
    throw BadRequest("El archivo no es una imagen JPG, PNG o WEBP válida", "IMAGEN_INVALIDA");
  }
  return storage.guardar(file.buffer, `.${tipo}`, MIME[tipo]);
}

function exigirArchivo(file?: Express.Multer.File): Express.Multer.File {
  if (!file) throw BadRequest("Falta la imagen (campo 'imagen', jpg/png/webp, máx 3MB)");
  return file;
}

// ---------- Foto de perfil del peluquero (sobre sí mismo) ----------
uploadsRouter.post(
  "/foto",
  requireAuth,
  requireRole("peluquero", "admin_negocio", "cliente"),
  upload.single("imagen"),
  asyncHandler(async (req, res) => {
    const file = exigirArchivo(req.file);
    const previo = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: { fotoUrl: true },
    });
    const fotoUrl = await guardarArchivo(file);
    await prisma.usuario.update({ where: { id: req.user!.sub }, data: { fotoUrl } });
    borrarAnterior(previo?.fotoUrl);
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
    const file = exigirArchivo(req.file);
    const id = Number(req.params.servicioId);
    const servicio = await prisma.servicio.findUnique({ where: { id } });
    if (!servicio) throw NotFound("Servicio no encontrado");
    if (servicio.peluqueroId !== req.user!.sub) throw Forbidden("No es tu servicio");

    const imagenUrl = await guardarArchivo(file);
    await prisma.servicio.update({ where: { id }, data: { imagenUrl } });
    borrarAnterior(servicio.imagenUrl);
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
    const file = exigirArchivo(req.file);
    const negocio = await prisma.negocio.findUnique({ where: { id: req.params.negocioId } });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (negocio.duenoId !== req.user!.sub) throw Forbidden("No eres dueño de este negocio");

    const logoUrl = await guardarArchivo(file);
    await prisma.negocio.update({ where: { id: negocio.id }, data: { logoUrl } });
    borrarAnterior(negocio.logoUrl);
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
    const file = exigirArchivo(req.file);
    const negocio = await prisma.negocio.findUnique({ where: { id: req.params.negocioId } });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (negocio.duenoId !== req.user!.sub) throw Forbidden("No eres dueño de este negocio");

    const coverUrl = await guardarArchivo(file);
    await prisma.negocio.update({ where: { id: negocio.id }, data: { coverUrl } });
    borrarAnterior(negocio.coverUrl);
    res.status(201).json({ coverUrl });
  }),
);
