import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// Abstracción de almacenamiento de imágenes.
//  - local: guarda en disco (dev / VPS con volumen).
//  - s3:    Backblaze B2 / Cloudflare R2 (compatible S3), servidas por CDN.
export interface Storage {
  guardar(buffer: Buffer, extension: string, mimetype: string): Promise<string>; // devuelve URL pública
  /** Borra una imagen a partir de la URL que devolvió `guardar` (best-effort). */
  borrar(url: string): Promise<void>;
}

const EXT_OK = new Set([".jpg", ".jpeg", ".png", ".webp"]);
function nombreSeguro(extension: string): string {
  const ext = extension.toLowerCase();
  return `${randomUUID()}${EXT_OK.has(ext) ? ext : ""}`;
}

/** Extrae el nombre de fichero de una URL propia, descartando rutas sospechosas. */
function nombreDeUrl(url: string): string | null {
  const base = path.basename(url.split("?")[0]);
  // Solo aceptamos los nombres que genera `nombreSeguro` (uuid + extensión).
  return /^[0-9a-f-]{36}(\.[a-z]{3,4})?$/i.test(base) ? base : null;
}

class LocalStorage implements Storage {
  async guardar(buffer: Buffer, extension: string): Promise<string> {
    const filename = nombreSeguro(extension);
    const dir = path.resolve(env.uploadDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    return `/uploads/${filename}`; // relativa; el frontend la resuelve contra la API
  }

  async borrar(url: string): Promise<void> {
    const nombre = nombreDeUrl(url);
    if (!nombre) return;
    await fs.unlink(path.join(path.resolve(env.uploadDir), nombre)).catch(() => {});
  }
}

class S3Storage implements Storage {
  private client: S3Client;
  constructor() {
    this.client = new S3Client({
      endpoint: env.s3Endpoint || undefined,
      region: env.s3Region,
      credentials: { accessKeyId: env.s3AccessKeyId, secretAccessKey: env.s3SecretAccessKey },
      forcePathStyle: true, // requerido por Backblaze B2
    });
  }
  async guardar(buffer: Buffer, extension: string, mimetype: string): Promise<string> {
    const key = `uploads/${nombreSeguro(extension)}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    // URL pública vía CDN (Cloudflare delante de B2/R2) o endpoint del bucket.
    const base = (env.s3PublicUrl || `${env.s3Endpoint}/${env.s3Bucket}`).replace(/\/$/, "");
    return `${base}/${key}`; // absoluta
  }

  async borrar(url: string): Promise<void> {
    const nombre = nombreDeUrl(url);
    if (!nombre) return;
    await this.client
      .send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: `uploads/${nombre}` }))
      .catch(() => {});
  }
}

export const storage: Storage = env.storageProvider === "s3" ? new S3Storage() : new LocalStorage();

/**
 * Borra la imagen anterior al sustituirla.
 * Sin esto, cada cambio de logo o de foto dejaba el fichero viejo para siempre:
 * una fuga de almacenamiento que solo crece (y se paga) con el uso.
 */
export function borrarAnterior(url: string | null | undefined): void {
  if (!url) return;
  void storage.borrar(url).catch((err) => logger.warn({ err, url }, "no se pudo borrar la imagen anterior"));
}

// ---------------------------------------------------------------------------
// Validación real del contenido
// ---------------------------------------------------------------------------

/**
 * Comprueba la firma binaria (magic bytes) del archivo.
 * El `Content-Type` del multipart lo elige el cliente: se puede subir cualquier
 * cosa diciendo que es `image/png`. Esto mira los bytes de verdad.
 */
export function tipoDeImagenReal(buffer: Buffer): "jpg" | "png" | "webp" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}
