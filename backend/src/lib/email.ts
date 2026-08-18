import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

// Servicio de email con dos transportes:
//  - "dev": no envía; registra el email en el log (ideal para desarrollo).
//  - "smtp": envía de verdad usando SMTP_* (SendGrid, SES, Mailgun, Gmail, etc.).

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (env.emailTransport !== "smtp") return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transporter;
}

export async function enviarEmail(params: { to: string; subject: string; html: string; text?: string }) {
  const t = getTransporter();
  if (!t) {
    // Modo dev: solo log.
    logger.info(
      { to: params.to, subject: params.subject },
      `📧 [email:dev] Para: ${params.to} | Asunto: ${params.subject}`,
    );
    return { dev: true };
  }
  await t.sendMail({ from: env.emailFrom, ...params });
  return { dev: false };
}

// ---------- Plantillas ----------
function layout(titulo: string, cuerpo: string) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1d24">
    <h2 style="color:#4f8cff">Turno</h2>
    <h3>${titulo}</h3>
    ${cuerpo}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#888">Este es un mensaje automático de Turno · Operado por ${env.companyName} · ${env.companySupportEmail}</p>
  </div>`;
}

export function emailVerificacion(nombre: string, url: string) {
  return {
    subject: "Verifica tu email en Turno",
    html: layout(
      `¡Hola ${nombre}!`,
      `<p>Confirma tu cuenta pulsando el botón:</p>
       <p><a href="${url}" style="background:#4f8cff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Verificar email</a></p>
       <p style="font-size:12px;color:#888">O copia este enlace: ${url}</p>`,
    ),
  };
}

export function emailConfirmacionReserva(datos: {
  nombre: string; negocio: string; profesional: string; servicio: string; fecha: string; hora: string; codigo: string;
}) {
  return {
    subject: `Reserva confirmada — ${datos.fecha} ${datos.hora}`,
    html: layout(
      "Tu reserva está confirmada ✅",
      `<p>Hola ${datos.nombre}, tu cita quedó confirmada:</p>
       <ul>
         <li><b>Negocio:</b> ${datos.negocio}</li>
         <li><b>Profesional:</b> ${datos.profesional}</li>
         <li><b>Servicio:</b> ${datos.servicio}</li>
         <li><b>Fecha:</b> ${datos.fecha} a las ${datos.hora}</li>
         <li><b>Código de validación:</b> ${datos.codigo}</li>
       </ul>`,
    ),
  };
}

export function emailNuevaReservaPro(datos: {
  profesional: string; cliente: string; servicio: string; fecha: string; hora: string;
}) {
  return {
    subject: `Nueva reserva — ${datos.fecha} ${datos.hora}`,
    html: layout(
      "Tienes una nueva reserva 🎉",
      `<p>Hola ${datos.profesional}, ${datos.cliente} reservó contigo:</p>
       <ul>
         <li><b>Cliente:</b> ${datos.cliente}</li>
         <li><b>Servicio:</b> ${datos.servicio}</li>
         <li><b>Fecha:</b> ${datos.fecha} a las ${datos.hora}</li>
       </ul>
       <p>Puedes verla en tu agenda.</p>`,
    ),
  };
}

export function emailRecordatorio(datos: {
  nombre: string; profesional: string; servicio: string; fecha: string; hora: string;
}) {
  return {
    subject: `Recordatorio: tu cita mañana ${datos.hora}`,
    html: layout(
      "Recordatorio de tu cita ⏰",
      `<p>Hola ${datos.nombre}, te recordamos tu cita de <b>${datos.servicio}</b> con <b>${datos.profesional}</b> el <b>${datos.fecha}</b> a las <b>${datos.hora}</b>.</p>`,
    ),
  };
}

export function emailReset(nombre: string, url: string) {
  return {
    subject: "Restablece tu contraseña en Turno",
    html: layout(
      `Hola ${nombre}`,
      `<p>Pulsa para crear una nueva contraseña (válido 1 hora):</p>
       <p><a href="${url}" style="background:#4f8cff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Cambiar contraseña</a></p>`,
    ),
  };
}
