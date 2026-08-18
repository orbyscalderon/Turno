import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

// URL base de la API. En emulador Android usar 10.0.2.2; en dispositivo real, la IP de tu PC.
const API_URL =
  (Constants.expoConfig?.extra as any)?.apiUrl ?? "http://localhost:4000";

const TOKEN_KEY = "turno_token";

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}
export async function setToken(token: string | null) {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Error de red");
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b),
};

export interface Negocio { id: string; nombreComercial: string; slug: string; direccion: string; }
export interface Peluquero { id: number; nombre: string; }
export interface Servicio { id: number; nombreServicio: string; precio: string | number; duracionMinutos: number; }
export interface Slot { inicio: string; fin: string; }
