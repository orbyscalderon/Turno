import { apiUrl, getToken } from "./api";

// Analítica de producto propia: mide dónde abandona la gente el embudo de
// reserva. Los eventos van a NUESTRO backend, no a un tercero, así que no hay
// nada que consentir aparte de lo que ya cubre la política de privacidad.
//
// Dos decisiones que importan:
//  - Se envían en lotes con `sendBeacon`, para que un evento no bloquee nunca
//    una interacción ni se pierda al cerrar la pestaña.
//  - El identificador de sesión es anónimo y vive en sessionStorage: identifica
//    una visita, no a una persona, y desaparece al cerrar el navegador.

export type EventoNombre =
  | "landing_vista"
  | "busqueda_realizada"
  | "negocio_visto"
  | "profesional_elegido"
  | "servicio_elegido"
  | "slots_vistos"
  | "slot_elegido"
  | "reserva_iniciada"
  | "pago_abierto"
  | "pago_completado"
  | "pago_fallido"
  | "registro_completado"
  | "login_completado"
  | "espera_apuntada"
  | "resena_enviada";

type Meta = Record<string, string | number | boolean>;

interface EventoPendiente {
  nombre: EventoNombre;
  sesion: string;
  ruta?: string;
  meta?: Meta;
}

const CLAVE_SESION = "turno_sesion_analitica";
const MAX_LOTE = 20;
const ESPERA_MS = 2000;

function idSesion(): string {
  try {
    let id = sessionStorage.getItem(CLAVE_SESION);
    if (!id) {
      id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)).replace(/-/g, "").slice(0, 32);
      sessionStorage.setItem(CLAVE_SESION, id);
    }
    return id;
  } catch {
    // Navegación privada o storage bloqueado: la visita cuenta como una sola.
    return "sin-storage-0000000000000000";
  }
}

let cola: EventoPendiente[] = [];
let temporizador: ReturnType<typeof setTimeout> | null = null;

function enviar() {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  if (!cola.length) return;

  const lote = cola.slice(0, MAX_LOTE);
  cola = cola.slice(MAX_LOTE);
  const cuerpo = JSON.stringify({ eventos: lote });
  const url = apiUrl("/api/eventos");
  const token = getToken();

  // sendBeacon no admite cabeceras, así que con sesión se usa fetch para que el
  // evento quede atribuido al usuario; sin sesión, beacon (no bloquea al cerrar).
  //
  // Todo va envuelto: `sendBeacon` LANZA si la extensión del navegador o la
  // política de la página lo bloquean, y esto se ejecuta desde un setTimeout,
  // donde una excepción se convierte en un error no capturado de la página.
  try {
    if (token) {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: cuerpo,
        keepalive: true,
      }).catch(() => {});
    } else if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(url, new Blob([cuerpo], { type: "application/json" }));
    } else {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cuerpo,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Un evento perdido no es nada; un error en pantalla sí.
  }

  if (cola.length) programar();
}

function programar() {
  if (temporizador) return;
  temporizador = setTimeout(enviar, ESPERA_MS);
}

/** Registra un evento del embudo. Nunca lanza: la analítica no puede romper la app. */
export function evento(nombre: EventoNombre, meta?: Meta): void {
  try {
    cola.push({
      nombre,
      sesion: idSesion(),
      ruta: window.location.pathname.slice(0, 160),
      meta,
    });
    if (cola.length >= MAX_LOTE) enviar();
    else programar();
  } catch {
    /* ignorar */
  }
}

/** Vacía la cola al salir, para no perder el último paso del embudo. */
export function iniciarAnalitica(): void {
  if (typeof window === "undefined") return;
  // `pagehide` y `visibilitychange` son los que sí se disparan en iOS; `unload` no.
  window.addEventListener("pagehide", enviar);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") enviar();
  });
}
