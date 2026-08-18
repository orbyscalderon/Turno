import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

// Abstracción de almacenamiento de imágenes.
//  - local: guarda en disco (dev / VPS con volumen).
//  - s3:    Backblaze B2 / Cloudflare R2 (compatible S3), servidas por CDN.
export interface Storage {
  guardar(buffer: Buffer, extension: string, mimetype: string): Promise<string>; // devuelve URL pública
}

const EXT_OK = new Set([".jpg", ".jpeg", ".png", ".webp"]);
function nombreSeguro(extension: string): string {
  const ext = extension.toLowerCase();
  return `${randomUUID()}${EXT_OK.has(ext) ? ext : ""}`;
}

class LocalStorage implements Storage {
  async guardar(buffer: Buffer, extension: string): Promise<string> {
    const filename = nombreSeguro(extension);
    const dir = path.resolve(env.uploadDir);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    return `/uploads/${filename}`; // relativa; el frontend la resuelve contra la API
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
}

export const storage: Storage = env.storageProvider === "s3" ? new S3Storage() : new LocalStorage();
