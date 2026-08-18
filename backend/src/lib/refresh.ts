import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

// Refresh tokens opacos almacenados en BD (revocables), distintos del JWT de acceso.

export async function emitirRefreshToken(usuarioId: number): Promise<string> {
  const token = randomBytes(48).toString("base64url");
  const expiraEn = new Date(Date.now() + env.refreshTokenDias * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { usuarioId, token, expiraEn } });
  return token;
}

/** Valida un refresh token; devuelve el usuarioId o null. */
export async function validarRefreshToken(token: string): Promise<number | null> {
  const registro = await prisma.refreshToken.findUnique({ where: { token } });
  if (!registro || registro.revocado || registro.expiraEn < new Date()) return null;
  return registro.usuarioId;
}

/** Rota el token: revoca el actual y emite uno nuevo (mitiga robo de tokens). */
export async function rotarRefreshToken(token: string, usuarioId: number): Promise<string> {
  await prisma.refreshToken.updateMany({ where: { token }, data: { revocado: true } });
  return emitirRefreshToken(usuarioId);
}

export async function revocarRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({ where: { token }, data: { revocado: true } });
}

/** Revoca todos los refresh tokens de un usuario (p. ej. al banearlo). */
export async function revocarTodos(usuarioId: number) {
  await prisma.refreshToken.updateMany({ where: { usuarioId }, data: { revocado: true } });
}
