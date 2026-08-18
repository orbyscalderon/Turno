import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setToken, getToken, setSession, getRefreshToken, setRefreshToken, type Usuario } from "./api";

interface AuthState {
  usuario: Usuario | null;
  cargando: boolean;
  login: (email: string, password: string) => Promise<void>;
  registro: (data: RegistroData) => Promise<void>;
  logout: () => void;
  refrescarUsuario: () => Promise<void>;
}

interface RegistroData {
  nombre: string;
  telefono: string;
  email: string;
  password: string;
  rol: "admin_negocio" | "peluquero" | "cliente";
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setCargando(false);
      return;
    }
    api
      .get<{ usuario: Usuario }>("/auth/me")
      .then((r) => setUsuario(r.usuario))
      .catch(() => setToken(null))
      .finally(() => setCargando(false));
  }, []);

  async function login(email: string, password: string) {
    const r = await api.post<{ usuario: Usuario; token: string; refreshToken: string }>("/auth/login", { email, password });
    setSession(r.token, r.refreshToken);
    setUsuario(r.usuario);
  }

  async function registro(data: RegistroData) {
    const r = await api.post<{ usuario: Usuario; token: string; refreshToken: string }>("/auth/registro", data);
    setSession(r.token, r.refreshToken);
    setUsuario(r.usuario);
  }

  function logout() {
    const rt = getRefreshToken();
    if (rt) api.post("/auth/logout", { refreshToken: rt }).catch(() => {});
    setToken(null);
    setRefreshToken(null);
    setUsuario(null);
  }

  async function refrescarUsuario() {
    try {
      const r = await api.get<{ usuario: Usuario }>("/auth/me");
      setUsuario(r.usuario);
    } catch { /* ignore */ }
  }

  return (
    <AuthContext.Provider value={{ usuario, cargando, login, registro, logout, refrescarUsuario }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
