// Cliente HTTP de la API de Turno. Adjunta el JWT y renueva con el refresh token ante un 401.

// Base del backend. En dev queda vacía (rutas relativas + proxy de Vite).
// En producción se define VITE_API_URL al build (p. ej. la URL de Railway).
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Resuelve URLs de imágenes servidas por el backend (/uploads/...) contra la base correcta.
export function assetUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  if (/^https?:\/\//.test(u)) return u; // ya absoluta (p. ej. S3/R2)
  return `${API_BASE}${u}`;
}

// URL absoluta de un endpoint (para fetch directos como descargas de archivos).
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// Genera y descarga un CSV a partir de encabezados + filas.
export function descargarCSV(nombre: string, headers: string[], filas: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...filas].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

const TOKEN_KEY = "turno_token";
const REFRESH_KEY = "turno_refresh";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}
export function setSession(token: string | null, refreshToken?: string | null) {
  setToken(token);
  if (refreshToken !== undefined) setRefreshToken(refreshToken);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// Renueva el token de acceso con el refresh token. Evita renovaciones simultáneas.
let refreshing: Promise<boolean> | null = null;
async function intentarRefrescar(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const d = await r.json();
        setSession(d.token, d.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, _retry = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token expirado: intenta refrescar una vez y reintenta la petición.
  if (res.status === 401 && !_retry && path !== "/auth/refresh" && (await intentarRefrescar())) {
    return request<T>(method, path, body, true);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "Error de red", data?.code);
  }
  return data as T;
}

async function uploadFile<T>(path: string, campo: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append(campo, file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api${path}`, { method: "POST", headers, body: fd });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Error de subida", data?.code);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: uploadFile,
};

// ----- Tipos compartidos -----
export type Rol = "superadmin" | "admin_negocio" | "peluquero" | "cliente";

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  telefono?: string;
  emailVerificadoEn?: string | null;
}

export interface Negocio {
  id: string;
  nombreComercial: string;
  categoria?: string;
  perfil?: string | null;
  slug: string;
  direccion: string;
  telefonoContacto: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  ratingPromedio?: number;
  ratingConteo?: number;
  distanciaKm?: number | null;
}

// Rubro del motor de nicho (activa sus módulos).
export interface Perfil {
  slug: string;
  nombre: string;
  categoria: string;
  emoji: string;
  modoPrimario: string;
  descripcion: string;
  modulos: string[];
}

// URL de Google Maps para un negocio (usa coords si existen, si no la dirección).
export function mapsUrl(n: { lat?: number | null; lng?: number | null; direccion?: string }): string {
  if (n.lat != null && n.lng != null) return `https://www.google.com/maps/search/?api=1&query=${n.lat},${n.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.direccion ?? "")}`;
}

// Etiquetas legibles de las categorías de negocio (plataforma multi-rubro).
export const CATEGORIAS: { value: string; label: string }[] = [
  { value: "barberia", label: "Barbería" },
  { value: "peluqueria", label: "Peluquería" },
  { value: "estetica", label: "Estética" },
  { value: "unas", label: "Uñas" },
  { value: "spa", label: "Spa" },
  { value: "masajes", label: "Masajes" },
  { value: "tatuajes", label: "Tatuajes" },
  { value: "depilacion", label: "Depilación" },
  { value: "maquillaje", label: "Maquillaje" },
  { value: "otro", label: "Otro" },
];

export function categoriaLabel(value?: string): string {
  return CATEGORIAS.find((c) => c.value === value)?.label ?? "Servicios";
}

// Emoji + degradado de portada por categoría (para tarjetas estilo marketplace).
const CAT_META: Record<string, { emoji: string; grad: string }> = {
  barberia:  { emoji: "💈", grad: "linear-gradient(135deg,#1e63e6,#08090c)" },
  peluqueria:{ emoji: "💇", grad: "linear-gradient(135deg,#2f7bff,#12131a)" },
  estetica:  { emoji: "💆", grad: "linear-gradient(135deg,#ff3b47,#12131a)" },
  unas:      { emoji: "💅", grad: "linear-gradient(135deg,#e11d2b,#191b22)" },
  spa:       { emoji: "🧖", grad: "linear-gradient(135deg,#1550c0,#08090c)" },
  masajes:   { emoji: "💆", grad: "linear-gradient(135deg,#2f7bff,#ff3b47)" },
  tatuajes:  { emoji: "🖋️", grad: "linear-gradient(135deg,#08090c,#e11d2b)" },
  depilacion:{ emoji: "✨", grad: "linear-gradient(135deg,#1e63e6,#ff3b47)" },
  maquillaje:{ emoji: "💄", grad: "linear-gradient(135deg,#ff3b47,#08090c)" },
  otro:      { emoji: "🏬", grad: "linear-gradient(135deg,#21242d,#08090c)" },
};
export function categoriaEmoji(value?: string): string {
  return CAT_META[value ?? "otro"]?.emoji ?? "🏬";
}
export function categoriaGrad(value?: string): string {
  return CAT_META[value ?? "otro"]?.grad ?? CAT_META.otro.grad;
}

export interface Peluquero {
  id: number;
  nombre: string;
  telefono?: string;
  fotoUrl?: string | null;
}

export interface Servicio {
  id: number;
  nombreServicio: string;
  precio: string | number;
  moneda?: string;
  duracionMinutos: number;
  imagenUrl?: string | null;
}

// Monedas soportadas (código ISO 4217) con etiqueta legible.
export const MONEDAS: { value: string; label: string }[] = [
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "MXN", label: "MXN (peso mexicano)" },
  { value: "COP", label: "COP (peso colombiano)" },
  { value: "ARS", label: "ARS (peso argentino)" },
  { value: "CLP", label: "CLP (peso chileno)" },
  { value: "PEN", label: "PEN (sol)" },
  { value: "GBP", label: "GBP (£)" },
  { value: "BRL", label: "BRL (real)" },
  { value: "DOP", label: "DOP (peso dominicano)" },
];

// Formatea un precio con su moneda (símbolo y separadores correctos vía Intl).
export function formatPrecio(precio: string | number, moneda?: string): string {
  const n = Number(precio);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: moneda || "USD" }).format(n);
  } catch {
    return `${moneda || "USD"} ${n.toFixed(2)}`;
  }
}

export interface Slot {
  inicio: string;
  fin: string;
}

export interface Reserva {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estadoCita: string;
  pagoReservaStatus: string;
  codigoValidacion: string;
  peluqueroId: number;
  servicioId: number;
  peluquero: string;
  servicio: string;
  precio: string | number;
  moneda?: string;
  whatsappUrl: string | null;
}
