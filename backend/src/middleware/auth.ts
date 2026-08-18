import type { Request, Response, NextFunction } from "express";
import type { Rol } from "@prisma/client";
import { verifyToken, type TokenPayload } from "../lib/auth.js";
import { Unauthorized, Forbidden } from "../lib/errors.js";

// Extiende el tipo Request para adjuntar el usuario autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
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
    if (!roles.includes(req.user.rol)) {
      throw Forbidden(`Requiere rol: ${roles.join(" o ")}`);
    }
    next();
  };
}
