import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, signToken } from "../lib/auth.js";
import { BadRequest, Forbidden, Unauthorized } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { enviarEmail, emailVerificacion, emailReset } from "../lib/email.js";
import { emitirRefreshToken, validarRefreshToken, rotarRefreshToken, revocarRefreshToken } from "../lib/refresh.js";

export const authRouter = Router();

// Emite el par de tokens (acceso corto + refresh) y crea la sesión.
async function emitirSesion(usuario: { id: number; rol: any; email: string }) {
  const token = signToken({ sub: usuario.id, rol: usuario.rol, email: usuario.email });
  const refreshToken = await emitirRefreshToken(usuario.id);
  return { token, refreshToken };
}

async function crearYEnviarVerificacion(usuarioId: number, nombre: string, email: string) {
  const token = randomBytes(24).toString("base64url");
  await prisma.emailVerificationToken.create({
    data: { usuarioId, token, expiraEn: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  const url = `${env.appUrl}/verificar/${token}`;
  const tpl = emailVerificacion(nombre, url);
  await enviarEmail({ to: email, subject: tpl.subject, html: tpl.html });
}

const registroSchema = z.object({
  nombre: z.string().min(2).max(100),
  telefono: z.string().min(6).max(20),
  email: z.string().email().max(150),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  // El superadmin no se crea por registro público.
  rol: z.enum(["admin_negocio", "peluquero", "cliente"]),
});

authRouter.post(
  "/registro",
  asyncHandler(async (req, res) => {
    const data = registroSchema.parse(req.body);

    const existe = await prisma.usuario.findUnique({ where: { email: data.email } });
    if (existe) throw BadRequest("El email ya está registrado", "EMAIL_EN_USO");

    const usuario = await prisma.usuario.create({
      data: {
        nombre: data.nombre,
        telefono: data.telefono,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        rol: data.rol,
      },
      select: { id: true, nombre: true, email: true, rol: true, emailVerificadoEn: true },
    });

    await crearYEnviarVerificacion(usuario.id, usuario.nombre, usuario.email);
    const sesion = await emitirSesion(usuario);
    res.status(201).json({ usuario, ...sesion });
  }),
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) throw Unauthorized("Credenciales inválidas");

    const ok = await verifyPassword(password, usuario.passwordHash);
    if (!ok) throw Unauthorized("Credenciales inválidas");
    if (usuario.bloqueado) throw Forbidden("Cuenta suspendida. Contacta con soporte.");

    const sesion = await emitirSesion(usuario);
    res.json({
      usuario: {
        id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol,
        emailVerificadoEn: usuario.emailVerificadoEn,
      },
      ...sesion,
    });
  }),
);

// ---------- Renovar el token de acceso con el refresh token (con rotación) ----------
authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(10) }).parse(req.body);
    const usuarioId = await validarRefreshToken(refreshToken);
    if (!usuarioId) throw Unauthorized("Refresh token inválido o expirado");

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario || usuario.bloqueado) throw Unauthorized("Sesión no válida");

    const nuevoRefresh = await rotarRefreshToken(refreshToken, usuarioId);
    const token = signToken({ sub: usuario.id, rol: usuario.rol, email: usuario.email });
    res.json({ token, refreshToken: nuevoRefresh });
  }),
);

// ---------- Cerrar sesión (revoca el refresh token) ----------
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const parsed = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (parsed.refreshToken) await revocarRefreshToken(parsed.refreshToken);
    res.json({ ok: true });
  }),
);

// ---------- Verificar email ----------
authRouter.post(
  "/email/verificar",
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const registro = await prisma.emailVerificationToken.findUnique({ where: { token } });
    if (!registro || registro.usado || registro.expiraEn < new Date()) {
      throw BadRequest("Enlace de verificación inválido o expirado", "TOKEN_INVALIDO");
    }
    await prisma.$transaction([
      prisma.usuario.update({ where: { id: registro.usuarioId }, data: { emailVerificadoEn: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: registro.id }, data: { usado: true } }),
    ]);
    res.json({ ok: true, mensaje: "Email verificado" });
  }),
);

// ---------- Reenviar verificación (autenticado) ----------
authRouter.post(
  "/email/reenviar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    if (!usuario) throw Unauthorized();
    if (usuario.emailVerificadoEn) return res.json({ ok: true, mensaje: "El email ya está verificado" });
    await crearYEnviarVerificacion(usuario.id, usuario.nombre, usuario.email);
    res.json({ ok: true, mensaje: "Email de verificación reenviado" });
  }),
);

// Devuelve el perfil del usuario autenticado.
authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true, nombre: true, email: true, telefono: true, rol: true, fotoUrl: true,
        emailVerificadoEn: true, createdAt: true,
      },
    });
    res.json({ usuario });
  }),
);

// ---------- Solicitar restablecimiento de contraseña ----------
// No revela si el email existe (evita enumeración de cuentas). El enlace se "envía" por consola.
authRouter.post(
  "/password/olvide",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { email } });

    if (usuario) {
      const token = randomBytes(24).toString("base64url");
      await prisma.passwordResetToken.create({
        data: { usuarioId: usuario.id, token, expiraEn: new Date(Date.now() + 60 * 60 * 1000) }, // 1h
      });
      const url = `${env.appUrl}/reset/${token}`;
      const tpl = emailReset(usuario.nombre, url);
      await enviarEmail({ to: email, subject: tpl.subject, html: tpl.html });
    }

    res.json({ ok: true, mensaje: "Si el email existe, se envió un enlace de recuperación" });
  }),
);

// ---------- Confirmar nueva contraseña con el token ----------
authRouter.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const { token, password } = z
      .object({ token: z.string().min(10), password: z.string().min(8) })
      .parse(req.body);

    const registro = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!registro || registro.usado || registro.expiraEn < new Date()) {
      throw BadRequest("Token inválido o expirado", "TOKEN_INVALIDO");
    }

    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: registro.usuarioId },
        data: { passwordHash: await hashPassword(password) },
      }),
      prisma.passwordResetToken.update({ where: { id: registro.id }, data: { usado: true } }),
    ]);

    res.json({ ok: true, mensaje: "Contraseña actualizada" });
  }),
);

// ---------- GDPR: exportar todos mis datos ----------
authRouter.get(
  "/me/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.user!.sub;
    const [usuario, reservas, servicios, negocios, resenas] = await Promise.all([
      prisma.usuario.findUnique({
        where: { id },
        select: { id: true, nombre: true, email: true, telefono: true, rol: true, createdAt: true, emailVerificadoEn: true },
      }),
      prisma.reservacion.findMany({ where: { OR: [{ clienteId: id }, { peluqueroId: id }] } }),
      prisma.servicio.findMany({ where: { peluqueroId: id } }),
      prisma.negocio.findMany({ where: { duenoId: id } }),
      prisma.resena.findMany({ where: { clienteId: id } }),
    ]);
    res.setHeader("Content-Disposition", 'attachment; filename="mis-datos-turno.json"');
    res.json({ exportadoEn: new Date().toISOString(), usuario, reservas, servicios, negocios, resenas });
  }),
);

// ---------- GDPR: borrar mi cuenta (derecho al olvido) ----------
authRouter.delete(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.user!.sub;
    // Las reservas tienen relación Restrict a usuario; se limpian a mano antes de borrar la cuenta.
    // El resto (servicios, disponibilidad, negocios, tokens, membresías) cae por onDelete: Cascade.
    await prisma.$transaction([
      prisma.reservacion.deleteMany({ where: { OR: [{ clienteId: id }, { peluqueroId: id }] } }),
      prisma.usuario.delete({ where: { id } }),
    ]);
    res.json({ ok: true, mensaje: "Cuenta y datos asociados eliminados" });
  }),
);
