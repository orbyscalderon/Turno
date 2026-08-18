// WhatsApp: deep link (wa.me) y envío automático por la Cloud API oficial de Meta.
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface DatosMensaje {
  telefonoDestino: string; // teléfono del negocio/profesional (a donde se envía)
  nombreProfesional: string;
  nombreServicio: string;
  fecha: string; // "YYYY-MM-DD"
  hora: string; // "HH:MM"
  codigoValidacion: string;
}

function formatearFecha(fechaISO: string): string {
  const [y, m, d] = fechaISO.split("-");
  return `${d}/${m}/${y}`;
}

// Normaliza el teléfono a solo dígitos (formato requerido por wa.me).
function soloDigitos(telefono: string): string {
  return telefono.replace(/\D/g, "");
}

function textoMensaje(datos: DatosMensaje): string {
  return (
    `¡Hola! Confirmé mi reserva en Turno. ` +
    `Profesional: ${datos.nombreProfesional}. ` +
    `Servicio: ${datos.nombreServicio}. ` +
    `Fecha: ${formatearFecha(datos.fecha)}. ` +
    `Hora: ${datos.hora}. ` +
    `Código de Validación: ${datos.codigoValidacion}. ` +
    `Ya realicé el pago de la fianza por la app.`
  );
}

export function generarLinkWhatsApp(datos: DatosMensaje): string {
  const telefono = soloDigitos(datos.telefonoDestino);
  return `https://wa.me/${telefono}?text=${encodeURIComponent(textoMensaje(datos))}`;
}

/**
 * Envío AUTOMÁTICO por la WhatsApp Cloud API (Meta). Best-effort: nunca rompe el flujo.
 * - deeplink: no hace nada (el cliente usa el link generado).
 * - cloud: envía a `telefonoDestino`. Si hay WHATSAPP_TEMPLATE usa esa plantilla aprobada
 *   (necesaria para mensajes iniciados por el negocio); si no, envía texto (solo válido
 *   dentro de la ventana de 24h de atención al cliente).
 */
export async function enviarWhatsApp(datos: DatosMensaje): Promise<void> {
  if (env.whatsappProvider !== "cloud") return;
  const to = soloDigitos(datos.telefonoDestino);
  if (!to || !env.whatsappToken || !env.whatsappPhoneId) {
    logger.warn("[whatsapp] cloud activado pero faltan token/phoneId/destino");
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${env.whatsappPhoneId}/messages`;
  const body = env.whatsappTemplate
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env.whatsappTemplate,
          language: { code: env.whatsappLang },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: datos.nombreProfesional },
                { type: "text", text: datos.nombreServicio },
                { type: "text", text: formatearFecha(datos.fecha) },
                { type: "text", text: datos.hora },
                { type: "text", text: datos.codigoValidacion },
              ],
            },
          ],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: textoMensaje(datos) } };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.whatsappToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, resp: await res.text() }, "[whatsapp] envío falló");
    } else {
      logger.info({ to }, "[whatsapp] mensaje enviado");
    }
  } catch (e) {
    logger.warn({ err: e }, "[whatsapp] error de red");
  }
}
