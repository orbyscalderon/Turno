import { randomBytes } from "node:crypto";

// Alfabeto sin caracteres ambiguos (0/O, 1/I/L) para códigos legibles.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Genera un token de validación corto y aleatorio para la reserva.
 * Se usa en el mensaje de WhatsApp en lugar del id secuencial (que es adivinable).
 */
export function generarCodigoValidacion(longitud = 8): string {
  const bytes = randomBytes(longitud);
  let out = "";
  for (let i = 0; i < longitud; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
