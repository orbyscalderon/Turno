import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Forbidden, Unauthorized } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyPassword } from "../lib/auth.js";
import {
  generarSecreto,
  verificarTotp,
  uriOtpAuth,
  cifrarSecreto,
  descifrarSecreto,
  generarCodigoRecuperacion,
  hashCodigoRecuperacion,
  CODIGOS_RECUPERACION,
} from "../lib/totp.js";
import { revocarTodos } from "../lib/refresh.js";
import { auditar } from "../lib/audit.js";
import { env } from "../config/env.js";

// Segundo factor (TOTP) para cualquier cuenta, obligatorio para superadmin si
// EXIGIR_2FA_SUPERADMIN=true. El panel de superadmin ve todos los negocios,
// usuarios e ingresos: una sola contraseña es poca cosa para eso.

export const dosFactoresRouter = Router();

const CODIGO = z.string().trim().min(6).max(12);

/**
 * Activación en dos pasos:
 *  1. /iniciar  genera el secreto, lo guarda SIN activar y devuelve el QR.
 *  2. /activar  comprueba un código real del móvil antes de encenderlo.
 * Si se activara en el paso 1, un QR mal escaneado dejaría la cuenta fuera.
 */
dosFactoresRouter.post(
  "/iniciar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: { email: true, totpActivadoEn: true },
    });
    if (!usuario) throw Unauthorized("Sesión no válida");
    if (usuario.totpActivadoEn) {
      throw BadRequest("Ya tienes el segundo factor activo. Desactívalo antes de volver a configurarlo.", "2FA_YA_ACTIVO");
    }

    const secreto = generarSecreto();
    await prisma.usuario.update({
      where: { id: req.user!.sub },
      data: { totpSecret: cifrarSecreto(secreto), totpActivadoEn: null },
    });

    const uri = uriOtpAuth(usuario.email, secreto);
    // El QR se genera aquí y no en el navegador para no añadir otra dependencia
    // al bundle del cliente por una pantalla que se usa una vez.
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
    res.json({ secreto, uri, qr });
  }),
);

dosFactoresRouter.post(
  "/activar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { codigo } = z.object({ codigo: CODIGO }).parse(req.body);

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: { totpSecret: true, totpActivadoEn: true },
    });
    if (!usuario?.totpSecret) throw BadRequest("Primero empieza la configuración", "2FA_SIN_INICIAR");
    if (usuario.totpActivadoEn) throw BadRequest("Ya está activo", "2FA_YA_ACTIVO");

    const secreto = descifrarSecreto(usuario.totpSecret);
    if (!secreto) throw BadRequest("La configuración ha caducado, vuelve a empezar", "2FA_SIN_INICIAR");
    if (!verificarTotp(secreto, codigo)) throw BadRequest("Código incorrecto", "2FA_CODIGO_INVALIDO");

    // Códigos de recuperación: se muestran UNA vez y se guardan hasheados.
    const codigos = Array.from({ length: CODIGOS_RECUPERACION }, generarCodigoRecuperacion);
    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: req.user!.sub },
        data: { totpActivadoEn: new Date() },
      }),
      prisma.codigoRecuperacion.deleteMany({ where: { usuarioId: req.user!.sub } }),
      prisma.codigoRecuperacion.createMany({
        data: codigos.map((c) => ({ usuarioId: req.user!.sub, hash: hashCodigoRecuperacion(c) })),
      }),
    ]);
    await auditar(req.user!.sub, "2fa_activado", `usuario ${req.user!.sub}`);

    res.json({ activo: true, codigosRecuperacion: codigos });
  }),
);

dosFactoresRouter.get(
  "/estado",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: { totpActivadoEn: true },
    });
    const restantes = usuario?.totpActivadoEn
      ? await prisma.codigoRecuperacion.count({ where: { usuarioId: req.user!.sub, usadoEn: null } })
      : 0;
    res.json({
      activo: Boolean(usuario?.totpActivadoEn),
      activadoEn: usuario?.totpActivadoEn ?? null,
      codigosRestantes: restantes,
    });
  }),
);

// Desactivar pide la contraseña: si alguien se deja la sesión abierta en un
// ordenador ajeno, no debe poder quitar el segundo factor sin más.
dosFactoresRouter.post(
  "/desactivar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);

    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    if (!usuario) throw Unauthorized("Sesión no válida");
    if (!(await verifyPassword(password, usuario.passwordHash))) {
      throw Unauthorized("Contraseña incorrecta");
    }
    if (usuario.rol === "superadmin" && env.exigir2faSuperadmin) {
      throw Forbidden(
        "Esta instalación exige segundo factor para los superadmin. No se puede desactivar.",
        "2FA_OBLIGATORIO",
      );
    }

    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: usuario.id },
        data: { totpSecret: null, totpActivadoEn: null },
      }),
      prisma.codigoRecuperacion.deleteMany({ where: { usuarioId: usuario.id } }),
    ]);
    await auditar(usuario.id, "2fa_desactivado", `usuario ${usuario.id}`);
    res.json({ activo: false });
  }),
);

// Regenerar los códigos de recuperación (los anteriores dejan de valer).
dosFactoresRouter.post(
  "/recuperacion/regenerar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { codigo } = z.object({ codigo: CODIGO }).parse(req.body);

    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: { totpSecret: true, totpActivadoEn: true },
    });
    if (!usuario?.totpActivadoEn || !usuario.totpSecret) {
      throw BadRequest("No tienes el segundo factor activo", "2FA_INACTIVO");
    }
    const secreto = descifrarSecreto(usuario.totpSecret);
    if (!secreto || !verificarTotp(secreto, codigo)) {
      throw BadRequest("Código incorrecto", "2FA_CODIGO_INVALIDO");
    }

    const codigos = Array.from({ length: CODIGOS_RECUPERACION }, generarCodigoRecuperacion);
    await prisma.$transaction([
      prisma.codigoRecuperacion.deleteMany({ where: { usuarioId: req.user!.sub } }),
      prisma.codigoRecuperacion.createMany({
        data: codigos.map((c) => ({ usuarioId: req.user!.sub, hash: hashCodigoRecuperacion(c) })),
      }),
    ]);
    res.json({ codigosRecuperacion: codigos });
  }),
);

/**
 * Comprueba el segundo factor de un usuario con un código TOTP o uno de
 * recuperación. Devuelve `null` si no es válido. Lo usa el login.
 */
export async function comprobarSegundoFactor(
  usuarioId: number,
  codigo: string,
): Promise<{ via: "totp" | "recuperacion" } | null> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { totpSecret: true, totpActivadoEn: true },
  });
  if (!usuario?.totpActivadoEn || !usuario.totpSecret) return null;

  const secreto = descifrarSecreto(usuario.totpSecret);
  if (secreto && verificarTotp(secreto, codigo)) return { via: "totp" };

  // Código de recuperación: de un solo uso, y al gastarlo se cierran las demás
  // sesiones por si el móvil perdido las tenía abiertas.
  const hash = hashCodigoRecuperacion(codigo);
  const fila = await prisma.codigoRecuperacion.findFirst({
    where: { usuarioId, hash, usadoEn: null },
    select: { id: true },
  });
  if (!fila) return null;
  await prisma.codigoRecuperacion.update({ where: { id: fila.id }, data: { usadoEn: new Date() } });
  await revocarTodos(usuarioId);
  await auditar(usuarioId, "2fa_codigo_recuperacion_usado", `usuario ${usuarioId}`);
  return { via: "recuperacion" };
}
