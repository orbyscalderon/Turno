import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  hkdfSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

// Segundo factor TOTP (RFC 6238) implementado con `node:crypto`.
// Sin dependencias: el algoritmo son 20 líneas y una librería más es una
// superficie de suministro más que auditar para algo que no cambia nunca.

const DIGITOS = 6;
const PASO_SEGUNDOS = 30;
// Tolerancia: ±1 paso (30 s) absorbe el desfase de reloj del móvil.
const VENTANA = 1;

// ---------------------------------------------------------------------------
// Base32 (RFC 4648 sin relleno), que es lo que esperan Google Authenticator,
// Authy, 1Password y el resto de apps.
// ---------------------------------------------------------------------------

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Codificar(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decodificar(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const ch of limpio) {
    const idx = ALFABETO.indexOf(ch);
    if (idx === -1) throw new Error("Secreto TOTP inválido");
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Generación y verificación del código
// ---------------------------------------------------------------------------

/** Secreto nuevo de 160 bits, el tamaño que recomienda la RFC para HMAC-SHA1. */
export function generarSecreto(): string {
  return base32Codificar(randomBytes(20));
}

/** Código de 6 dígitos para un paso de tiempo concreto. */
export function codigoTotp(secretoBase32: string, enMs: number = Date.now()): string {
  const contador = Math.floor(enMs / 1000 / PASO_SEGUNDOS);
  const buf = Buffer.alloc(8);
  // Contador de 64 bits big-endian. writeBigUInt64BE evita el desbordamiento
  // de los 32 bits que tendría un writeUInt32BE ingenuo.
  buf.writeBigUInt64BE(BigInt(contador));

  const hmac = createHmac("sha1", base32Decodificar(secretoBase32)).update(buf).digest();
  // Truncamiento dinámico (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

/**
 * Verifica el código aceptando ±VENTANA pasos.
 * La comparación es en tiempo constante: comparar con `===` filtra información
 * por el tiempo de respuesta y un código de 6 dígitos es corto.
 */
export function verificarTotp(
  secretoBase32: string,
  codigo: string,
  enMs: number = Date.now(),
): boolean {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return false;
  const esperado = Buffer.from(limpio);
  for (let i = -VENTANA; i <= VENTANA; i++) {
    const candidato = Buffer.from(codigoTotp(secretoBase32, enMs + i * PASO_SEGUNDOS * 1000));
    if (candidato.length === esperado.length && timingSafeEqual(candidato, esperado)) return true;
  }
  return false;
}

/** URI `otpauth://` que se convierte en el QR que escanea la app del móvil. */
export function uriOtpAuth(email: string, secretoBase32: string, emisor = "Turno"): string {
  const etiqueta = encodeURIComponent(`${emisor}:${email}`);
  const params = new URLSearchParams({
    secret: secretoBase32,
    issuer: emisor,
    algorithm: "SHA1",
    digits: String(DIGITOS),
    period: String(PASO_SEGUNDOS),
  });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Cifrado del secreto en reposo
// ---------------------------------------------------------------------------
// El secreto TOTP en claro en la base de datos equivale a no tener segundo
// factor: quien lea la tabla genera códigos válidos. Se guarda cifrado con
// AES-256-GCM y una clave que NO está en la base de datos.

function clave(): Buffer {
  const material = env.totpClave || env.jwtSecret;
  // HKDF separa esta clave de la de firma de JWT aunque el material sea el mismo.
  return Buffer.from(hkdfSync("sha256", material, "turno-totp-v1", "cifrado-secreto-totp", 32));
}

export function cifrarSecreto(secreto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", clave(), iv);
  const ct = Buffer.concat([cipher.update(secreto, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** Devuelve null si el blob no se puede descifrar (clave rotada o dato corrupto). */
export function descifrarSecreto(blob: string): string | null {
  try {
    const [version, ivB64, tagB64, ctB64] = blob.split(".");
    if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", clave(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Códigos de recuperación
// ---------------------------------------------------------------------------

export const CODIGOS_RECUPERACION = 10;

/** Formato legible para teclear: 4-4 en base32 sin caracteres ambiguos. */
export function generarCodigoRecuperacion(): string {
  const bruto = base32Codificar(randomBytes(5)).slice(0, 8);
  return `${bruto.slice(0, 4)}-${bruto.slice(4, 8)}`;
}

/** Hash del código tal y como se guarda (normaliza guiones y mayúsculas). */
export function hashCodigoRecuperacion(codigo: string): string {
  const normal = codigo.toUpperCase().replace(/[\s-]/g, "");
  return createHash("sha256").update(normal).digest("hex");
}
