import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { esc } from "./html.js";

// Servicio de email con dos transportes:
//  - "dev": no envía; registra el email en el log (ideal para desarrollo).
//  - "smtp": envía de verdad usando SMTP_* (SendGrid, SES, Mailgun, Postmark...).
//
// TODO el contenido variable va escapado con esc(): los nombres de cliente,
// servicio y los motivos de cancelación los escribe el usuario.

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

export async function enviarEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  if (!params.to) return { dev: true, omitido: true };
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

/** Envío "best-effort": nunca propaga el error (no debe romper una reserva). */
export function enviarEmailSeguro(params: { to: string; subject: string; html: string }) {
  return enviarEmail(params).catch((err) => {
    logger.warn({ err, to: params.to }, "no se pudo enviar el email");
    return { dev: false, error: true };
  });
}

// ---------- Plantillas ----------
function layout(titulo: string, cuerpo: string) {
  return `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1d24">
    <h2 style="color:#4f8cff">Turno</h2>
    <h3>${esc(titulo)}</h3>
    ${cuerpo}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#888">Este es un mensaje automático de Turno · Operado por ${esc(
      env.companyName,
    )} · ${esc(env.companySupportEmail)}</p>
  </div>`;
}

const boton = (url: string, texto: string) =>
  `<p><a href="${esc(url)}" style="background:#4f8cff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(
    texto,
  )}</a></p>`;

export function emailVerificacion(nombre: string, url: string) {
  return {
    subject: "Verifica tu email en Turno",
    html: layout(
      `¡Hola ${nombre}!`,
      `<p>Confirma tu cuenta pulsando el botón:</p>
       ${boton(url, "Verificar email")}
       <p style="font-size:12px;color:#888">O copia este enlace: ${esc(url)}</p>`,
    ),
  };
}

export function emailConfirmacionReserva(datos: {
  nombre: string;
  negocio: string;
  profesional: string;
  servicio: string;
  fecha: string;
  hora: string;
  codigo: string;
}) {
  return {
    subject: `Reserva confirmada — ${datos.fecha} ${datos.hora}`,
    html: layout(
      "Tu reserva está confirmada ✅",
      `<p>Hola ${esc(datos.nombre)}, tu cita quedó confirmada:</p>
       <ul>
         <li><b>Negocio:</b> ${esc(datos.negocio)}</li>
         <li><b>Profesional:</b> ${esc(datos.profesional)}</li>
         <li><b>Servicio:</b> ${esc(datos.servicio)}</li>
         <li><b>Fecha:</b> ${esc(datos.fecha)} a las ${esc(datos.hora)}</li>
         <li><b>Código de validación:</b> ${esc(datos.codigo)}</li>
       </ul>
       <p style="font-size:12px;color:#888">Enseña este código en el local para dar entrada a tu cita.</p>`,
    ),
  };
}

export function emailNuevaReservaPro(datos: {
  profesional: string;
  cliente: string;
  servicio: string;
  fecha: string;
  hora: string;
}) {
  return {
    subject: `Nueva reserva — ${datos.fecha} ${datos.hora}`,
    html: layout(
      "Tienes una nueva reserva 🎉",
      `<p>Hola ${esc(datos.profesional)}, ${esc(datos.cliente)} reservó contigo:</p>
       <ul>
         <li><b>Cliente:</b> ${esc(datos.cliente)}</li>
         <li><b>Servicio:</b> ${esc(datos.servicio)}</li>
         <li><b>Fecha:</b> ${esc(datos.fecha)} a las ${esc(datos.hora)}</li>
       </ul>
       <p>Puedes verla en tu agenda.</p>`,
    ),
  };
}

export function emailRecordatorio(datos: {
  nombre: string;
  profesional: string;
  servicio: string;
  fecha: string;
  hora: string;
  // "manana" = recordatorio de 24h; número de horas = recordatorio corto.
  cuando?: "manana" | number;
}) {
  const corto = typeof datos.cuando === "number";
  return {
    subject: corto
      ? `Tu cita es en ${datos.cuando} h — ${datos.hora}`
      : `Recordatorio: tu cita mañana ${datos.hora}`,
    html: layout(
      corto ? "Tu cita es dentro de poco ⏰" : "Recordatorio de tu cita ⏰",
      `<p>Hola ${esc(datos.nombre)}, te recordamos tu cita de <b>${esc(
        datos.servicio,
      )}</b> con <b>${esc(datos.profesional)}</b> el <b>${esc(datos.fecha)}</b> a las <b>${esc(
        datos.hora,
      )}</b>.</p>`,
    ),
  };
}

export function emailReset(nombre: string, url: string) {
  return {
    subject: "Restablece tu contraseña en Turno",
    html: layout(
      `Hola ${nombre}`,
      `<p>Pulsa para crear una nueva contraseña (válido 1 hora):</p>
       ${boton(url, "Cambiar contraseña")}
       <p style="font-size:12px;color:#888">Al cambiarla se cerrarán todas tus sesiones abiertas.</p>`,
    ),
  };
}

/** El negocio/profesional cancela una cita ya confirmada. */
export function emailCancelacionNegocio(datos: {
  nombre: string;
  profesional: string;
  servicio: string;
  fecha: string;
  hora: string;
  motivo?: string | null;
  reembolsado: boolean;
}) {
  return {
    subject: `Cita cancelada — ${datos.fecha} ${datos.hora}`,
    html: layout(
      "Tu cita ha sido cancelada",
      `<p>Hola ${esc(datos.nombre)}, lamentamos informarte de que <b>${esc(
        datos.profesional,
      )}</b> ha cancelado tu cita de <b>${esc(datos.servicio)}</b> del <b>${esc(
        datos.fecha,
      )}</b> a las <b>${esc(datos.hora)}</b>.</p>
       ${datos.motivo ? `<p><b>Motivo:</b> ${esc(datos.motivo)}</p>` : ""}
       <p>${
         datos.reembolsado
           ? "Se ha emitido el <b>reembolso completo</b> de tu fianza; según tu banco puede tardar unos días en reflejarse."
           : "Si abonaste una fianza y no ves el reembolso, escríbenos y lo revisamos."
       }</p>
       <p>Puedes reservar otro horario cuando quieras.</p>`,
    ),
  };
}

/** Cita cerrada en el local: invita a dejar una reseña. */
export function emailCitaCompletada(datos: {
  nombre: string;
  negocio: string;
  servicio: string;
  url: string;
}) {
  return {
    subject: "¿Cómo fue tu cita?",
    html: layout(
      "Gracias por tu visita 💈",
      `<p>Hola ${esc(datos.nombre)}, esperamos que disfrutaras tu ${esc(
        datos.servicio,
      )} en ${esc(datos.negocio)}.</p>
       <p>Deja una reseña: ayuda al negocio y a otros clientes.</p>
       ${boton(datos.url, "Valorar mi cita")}`,
    ),
  };
}

/** Aviso al dueño de que su suscripción venció y su negocio dejó de ser visible. */
export function emailSuscripcionVencida(datos: { nombre: string; negocio: string; url: string }) {
  return {
    subject: `Tu suscripción de ${datos.negocio} ha vencido`,
    html: layout(
      "Suscripción vencida",
      `<p>Hola ${esc(datos.nombre)}, la suscripción de <b>${esc(
        datos.negocio,
      )}</b> ha vencido, así que el negocio ya no aparece en las búsquedas y no acepta reservas nuevas.</p>
       <p>Reactívalo en un minuto desde tu panel:</p>
       ${boton(datos.url, "Reactivar suscripción")}`,
    ),
  };
}

/**
 * Aviso de que se ha liberado un hueco a alguien de la lista de espera.
 * El hueco NO se reserva: se avisa a varios y lo coge el primero que entra.
 */
export function emailHuecoLibre(datos: {
  nombre: string;
  negocio: string;
  profesional: string;
  servicio: string;
  fecha: string;
  hora: string;
  url: string;
}) {
  return {
    subject: `Se ha liberado un hueco — ${datos.fecha} ${datos.hora}`,
    html: layout(
      "¡Hay un hueco libre! 🎉",
      `<p>Hola ${esc(datos.nombre)}, estabas en la lista de espera y acaba de quedar
       libre un hueco en <b>${esc(datos.negocio)}</b>:</p>
       <p><b>${esc(datos.servicio)}</b> con ${esc(datos.profesional)}<br/>
       ${esc(datos.fecha)} a las ${esc(datos.hora)}</p>
       <p>No está reservado para ti: lo coge quien reserve primero.</p>
       ${boton(datos.url, "Reservar este hueco")}`,
    ),
  };
}

/** Confirmación de que el negocio ha registrado un bono de sesiones a su nombre. */
export function emailBonoEmitido(datos: {
  nombre: string;
  negocio: string;
  paquete: string;
  sesiones: number;
  caduca: string | null;
  url: string;
}) {
  return {
    subject: `Tu bono de ${datos.sesiones} sesiones en ${datos.negocio}`,
    html: layout(
      "Bono activado 🎟️",
      `<p>Hola ${esc(datos.nombre)}, <b>${esc(datos.negocio)}</b> ha registrado a tu nombre
       el bono <b>${esc(datos.paquete)}</b> con <b>${datos.sesiones}</b> sesiones.</p>
       <p>Al reservar se descuenta una sesión automáticamente y no tendrás que pagar fianza.</p>
       ${datos.caduca ? `<p>Caduca el <b>${esc(datos.caduca)}</b>.</p>` : ""}
       ${boton(datos.url, "Ver mis bonos")}`,
    ),
  };
}
