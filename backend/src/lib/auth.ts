import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { Rol } from "@prisma/client";
import { env } from "../config/env.js";

export interface TokenPayload {
  sub: number; // id del usuario
  rol: Rol;
  email: string;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.jwtSecret) as unknown as TokenPayload;
}

// ---------------------------------------------------------------------------
// Desafío intermedio del segundo factor
// ---------------------------------------------------------------------------
// Entre "contraseña correcta" y "sesión emitida" hace falta un paso. Ese paso
// se identifica con un token propio, corto y de un solo propósito: si se usara
// el token de acceso normal, el primer factor ya daría acceso a la API.

interface Desafio2fa {
  sub: number;
  proposito: "2fa";
}

const DESAFIO_2FA_MINUTOS = 5;

export function firmarDesafio2fa(usuarioId: number): string {
  const payload: Desafio2fa = { sub: usuarioId, proposito: "2fa" };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: `${DESAFIO_2FA_MINUTOS}m` });
}

/** Devuelve el id del usuario, o null si el token no es un desafío válido. */
export function verificarDesafio2fa(token: string): number | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as unknown as Desafio2fa;
    // Sin esta comprobación, un token de acceso normal valdría como desafío.
    if (payload.proposito !== "2fa" || typeof payload.sub !== "number") return null;
    return payload.sub;
  } catch {
    return null;
  }
}
