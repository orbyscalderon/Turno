import type { Request, Response, NextFunction } from "express";
import type { Rol } from "@prisma/client";
import { verifyToken, type TokenPayload } from "../lib/auth.js";
import { Unauthorized, Forbidden } from "../lib/errors.js";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

// Extiende el tipo Request para adjuntar el usuario autenticado y el cuerpo crudo
// (necesario para verificar la firma de los webhooks de la pasarela de pagos).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
      rawBody?: string;
    }
  }
}

/** Requiere un token JWT válido en el header Authorization: Bearer <token>. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw Unauthorized("Falta el token de autenticación");
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    throw Unauthorized("Token inválido o expirado");
  }
}

/** Restringe el acceso a uno o más roles. Debe usarse después de requireAuth. */
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Unauthorized();
    // El superadmin tiene acceso total (puede operar cualquier vista, incl. "Ver como cliente").
    if (req.user.rol === "superadmin") return next();
    if (!roles.includes(req.user.rol)) {
      throw Forbidden(`Requiere rol: ${roles.join(" o ")}`);
    }
    next();
  };
}

/**
 * Adjunta el usuario SI viene un token válido, pero no exige sesión.
 * Lo usa la analítica de producto: el embudo empieza antes de registrarse, así
 * que los eventos anónimos también cuentan.
 */
export function authOpcional(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch {
      // Token caducado: se trata como visita anónima, no como error.
    }
  }
  next();
}

/**
 * Exige segundo factor activo. El panel de superadmin ve todos los negocios,
 * usuarios e ingresos; con EXIGIR_2FA_SUPERADMIN=true se puede iniciar sesión
 * sin 2FA (hace falta para poder configurarlo) pero no entrar aquí.
 */
export async function requiere2fa(req: Request, _res: Response, next: NextFunction) {
  if (!env.exigir2faSuperadmin || req.user?.rol !== "superadmin") return next();

  const usuario = await prisma.usuario.findUnique({
    where: { id: req.user.sub },
    select: { totpActivadoEn: true },
  });
  if (!usuario?.totpActivadoEn) {
    throw Forbidden(
      "Activa el segundo factor en tu perfil para usar el panel de superadmin",
      "2FA_REQUERIDO",
    );
  }
  next();
}
