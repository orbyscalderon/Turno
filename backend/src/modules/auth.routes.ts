import { Router } from "express";
import type { Rol } from "@prisma/client";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { prisma } from "../lib/prisma.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  firmarDesafio2fa,
  verificarDesafio2fa,
} from "../lib/auth.js";
import { comprobarSegundoFactor } from "./dosfactores.routes.js";
import { BadRequest, Forbidden, Unauthorized } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { enviarEmail, emailVerificacion, emailReset } from "../lib/email.js";
import {
  emitirRefreshToken,
  validarRefreshToken,
  rotarRefreshToken,
  revocarRefreshToken,
  revocarTodos,
} from "../lib/refresh.js";
import { auditar } from "../lib/audit.js";
import { fechaISO, fechaUTC } from "../lib/time.js";

export const authRouter = Router();

// Emite el par de tokens (acceso corto + refresh) y crea la sesión.
async function emitirSesion(usuario: { id: number; rol: Rol; email: string }) {
  const token = signToken({ sub: usuario.id, rol: usuario.rol, email: usuario.email });
  const refreshToken = await emitirRefreshToken(usuario.id);
  return { token, refreshToken };
}

// Respuesta estándar de "sesión abierta". Un superadmin sin segundo factor
// recibe `debeActivar2fa`: puede entrar (si no, no podría ni configurarlo),
// pero el panel de superadmin le queda cerrado hasta que lo active.
function respuestaSesion(
  usuario: { id: number; nombre: string; email: string; rol: Rol; emailVerificadoEn: Date | null; totpActivadoEn?: Date | null },
  sesion: { token: string; refreshToken: string },
) {
  return {
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      emailVerificadoEn: usuario.emailVerificadoEn,
      dosFactoresActivo: Boolean(usuario.totpActivadoEn),
    },
    debeActivar2fa:
      usuario.rol === "superadmin" && env.exigir2faSuperadmin && !usuario.totpActivadoEn,
    ...sesion,
  };
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

// El email se normaliza SIEMPRE (trim + minúsculas). Antes no se hacía en el
// registro ni en el login, pero sí en el acceso con Google: "Juan@x.com" y
// "juan@x.com" creaban dos cuentas distintas y Google no encontraba la primera.
const EMAIL = z.string().trim().toLowerCase().email().max(150);

const registroSchema = z.object({
  nombre: z.string().trim().min(2).max(100),
  telefono: z.string().trim().min(6).max(20),
  email: EMAIL,
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
  email: EMAIL,
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

    // Con segundo factor activo la contraseña NO abre sesión: devuelve un
    // desafío de 5 minutos que se canjea en /2fa/verificar.
    if (usuario.totpActivadoEn) {
      return res.json({ requiere2fa: true, desafio: firmarDesafio2fa(usuario.id) });
    }

    const sesion = await emitirSesion(usuario);
    res.json(respuestaSesion(usuario, sesion));
  }),
);

// ---------- Segundo paso del login: canjear el desafío por la sesión ----------
const verificar2faSchema = z.object({
  desafio: z.string().min(10),
  codigo: z.string().trim().min(6).max(12),
});

authRouter.post(
  "/2fa/verificar",
  asyncHandler(async (req, res) => {
    const { desafio, codigo } = verificar2faSchema.parse(req.body);

    const usuarioId = verificarDesafio2fa(desafio);
    if (!usuarioId) throw Unauthorized("El desafío ha caducado. Vuelve a iniciar sesión.");

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario || usuario.bloqueado) throw Unauthorized("Sesión no válida");

    const resultado = await comprobarSegundoFactor(usuarioId, codigo);
    if (!resultado) throw Unauthorized("Código incorrecto");

    const sesion = await emitirSesion(usuario);
    res.json({ ...respuestaSesion(usuario, sesion), via: resultado.via });
  }),
);

// ---------- Iniciar sesión / registrarse con Google (Google Identity Services) ----------
// El frontend obtiene un "credential" (ID token JWT) del botón de Google y lo manda aquí.
// Verificamos la firma con Google, buscamos al usuario por email y emitimos nuestra sesión.
// Si el email no existe, se crea una cuenta de cliente ya verificada (self-signup).
const googleSchema = z.object({ credential: z.string().min(20) });

authRouter.post(
  "/google",
  asyncHandler(async (req, res) => {
    if (!env.googleClientId) {
      throw BadRequest("El acceso con Google no está configurado", "GOOGLE_NO_CONFIGURADO");
    }
    const { credential } = googleSchema.parse(req.body);

    const cliente = new OAuth2Client(env.googleClientId);
    let payload: TokenPayload | undefined;
    try {
      const ticket = await cliente.verifyIdToken({ idToken: credential, audience: env.googleClientId });
      payload = ticket.getPayload();
    } catch {
      throw Unauthorized("No se pudo verificar el token de Google");
    }

    const email = payload?.email?.toLowerCase();
    if (!email || payload?.email_verified === false) {
      throw Unauthorized("La cuenta de Google no tiene un email verificado");
    }
    const nombre = payload?.name?.trim() || email.split("@")[0];
    const fotoUrl = payload?.picture;

    let usuario = await prisma.usuario.findUnique({ where: { email } });

    if (!usuario) {
      // Alta nueva vía Google: cliente, ya verificado. Sin contraseña usable (hash aleatorio).
      usuario = await prisma.usuario.create({
        data: {
          nombre,
          telefono: "",
          email,
          passwordHash: await hashPassword(randomBytes(32).toString("hex")),
          rol: "cliente",
          fotoUrl: fotoUrl ?? null,
          emailVerificadoEn: new Date(),
        },
      });
    } else if (usuario.bloqueado) {
      throw Forbidden("Cuenta suspendida. Contacta con soporte.");
    } else if (!usuario.fotoUrl && fotoUrl) {
      // Completa la foto de perfil desde Google si aún no tiene.
      usuario = await prisma.usuario.update({ where: { id: usuario.id }, data: { fotoUrl } });
    }

    // Google verifica quién eres, no reemplaza al segundo factor de esta cuenta.
    if (usuario.totpActivadoEn) {
      return res.json({ requiere2fa: true, desafio: firmarDesafio2fa(usuario.id) });
    }

    const sesion = await emitirSesion(usuario);
    res.json(respuestaSesion(usuario, sesion));
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
    const { email } = z.object({ email: EMAIL }).parse(req.body);
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
      // Invalida el resto de tokens de reset pendientes de ese usuario.
      prisma.passwordResetToken.updateMany({
        where: { usuarioId: registro.usuarioId, usado: false },
        data: { usado: true },
      }),
    ]);

    // Cambiar la contraseña DEBE cerrar las sesiones abiertas: si alguien había
    // robado la sesión, antes seguía dentro aunque la víctima cambiara la clave.
    await revocarTodos(registro.usuarioId);
    await auditar(registro.usuarioId, "password_restablecida", `usuario=${registro.usuarioId}`);

    res.json({
      ok: true,
      mensaje: "Contraseña actualizada. Se han cerrado las sesiones abiertas.",
    });
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
    // Un superadmin no puede auto-eliminarse (evita quedarse sin administrador de la plataforma).
    if (req.user!.rol === "superadmin") {
      throw Forbidden("Un superadmin no puede eliminar su propia cuenta.");
    }
    // ANONIMIZACIÓN en lugar de borrado físico.
    // Antes se hacía `deleteMany` de todas las reservas donde el usuario era cliente
    // O profesional: eso borraba el historial y la contabilidad de negocios de
    // terceros. Ahora se eliminan los datos personales (que es lo que exige el
    // derecho al olvido) y se conserva el registro contable ya anonimizado.
    const ahora = new Date();
    await prisma.$transaction([
      // Cancela sus citas futuras para liberar la agenda de los profesionales.
      prisma.reservacion.updateMany({
        where: { clienteId: id, estadoCita: "confirmada", fecha: { gte: fechaUTC(fechaISO(ahora)) } },
        data: {
          estadoCita: "cancelada",
          canceladaEn: ahora,
          canceladaPor: "cliente",
          motivoCancelacion: "Cuenta eliminada por el usuario",
        },
      }),
      // Sus negocios dejan de ser visibles y de aceptar reservas.
      prisma.negocio.updateMany({ where: { duenoId: id }, data: { estadoSuscripcion: "vencido" } }),
      // Sus servicios dejan de ofertarse.
      prisma.servicio.updateMany({ where: { peluqueroId: id }, data: { activo: false } }),
      prisma.disponibilidad.deleteMany({ where: { peluqueroId: id } }),
      // Texto libre de reseñas: contenido personal, se elimina (la nota numérica
      // se conserva para no falsear la reputación del negocio).
      prisma.resena.updateMany({ where: { clienteId: id }, data: { comentario: null } }),
      prisma.refreshToken.deleteMany({ where: { usuarioId: id } }),
      prisma.passwordResetToken.deleteMany({ where: { usuarioId: id } }),
      prisma.emailVerificationToken.deleteMany({ where: { usuarioId: id } }),
      // Datos personales fuera: el email se sustituye por uno irreversible y no
      // enrutable, de modo que la cuenta no puede reutilizarse ni recibir correo.
      prisma.usuario.update({
        where: { id },
        data: {
          nombre: "Usuario eliminado",
          email: `eliminado-${id}-${randomBytes(6).toString("hex")}@cuenta.invalid`,
          telefono: "",
          fotoUrl: null,
          passwordHash: await hashPassword(randomBytes(32).toString("hex")),
          bloqueado: true,
        },
      }),
    ]);
    await auditar(id, "cuenta_anonimizada", `usuario=${id}`);
    res.json({
      ok: true,
      mensaje:
        "Cuenta eliminada: tus datos personales se han borrado y tus citas futuras se han cancelado.",
    });
  }),
);
