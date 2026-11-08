import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setToken, getToken, setSession, getRefreshToken, setRefreshToken, type Usuario } from "./api";

/**
 * Resultado de un intento de inicio de sesión.
 * Con segundo factor activo, la contraseña (o Google) NO abre sesión: devuelve
 * un desafío de pocos minutos que hay que canjear con el código del móvil.
 */
export type ResultadoLogin = { ok: true } | { ok: false; desafio: string };

interface AuthState {
  usuario: Usuario | null;
  cargando: boolean;
  /** Avisa de que esta cuenta DEBE activar el 2FA para usar su panel. */
  debeActivar2fa: boolean;
  login: (email: string, password: string) => Promise<ResultadoLogin>;
  loginGoogle: (credential: string) => Promise<ResultadoLogin>;
  verificar2fa: (desafio: string, codigo: string) => Promise<void>;
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

/** Respuesta de la API al iniciar sesión: o sesión, o desafío de 2FA. */
interface RespuestaLogin {
  usuario?: Usuario;
  token?: string;
  refreshToken?: string;
  requiere2fa?: boolean;
  desafio?: string;
  debeActivar2fa?: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [debeActivar2fa, setDebeActivar2fa] = useState(false);

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

  /** Aplica una respuesta de login: abre sesión o devuelve el desafío pendiente. */
  function aplicar(r: RespuestaLogin): ResultadoLogin {
    if (r.requiere2fa && r.desafio) return { ok: false, desafio: r.desafio };
    setSession(r.token ?? null, r.refreshToken ?? null);
    setUsuario(r.usuario ?? null);
    setDebeActivar2fa(Boolean(r.debeActivar2fa));
    return { ok: true };
  }

  async function login(email: string, password: string) {
    return aplicar(await api.post<RespuestaLogin>("/auth/login", { email, password }));
  }

  async function loginGoogle(credential: string) {
    return aplicar(await api.post<RespuestaLogin>("/auth/google", { credential }));
  }

  async function verificar2fa(desafio: string, codigo: string) {
    const r = await api.post<RespuestaLogin>("/auth/2fa/verificar", { desafio, codigo });
    aplicar(r);
  }

  async function registro(data: RegistroData) {
    const r = await api.post<RespuestaLogin>("/auth/registro", data);
    aplicar(r);
  }

  function logout() {
    const rt = getRefreshToken();
    if (rt) api.post("/auth/logout", { refreshToken: rt }).catch(() => {});
    setToken(null);
    setRefreshToken(null);
    setUsuario(null);
    setDebeActivar2fa(false);
  }

  async function refrescarUsuario() {
    try {
      const r = await api.get<{ usuario: Usuario }>("/auth/me");
      setUsuario(r.usuario);
    } catch { /* ignore */ }
  }

  return (
    <AuthContext.Provider
      value={{
        usuario,
        cargando,
        debeActivar2fa,
        login,
        loginGoogle,
        verificar2fa,
        registro,
        logout,
        refrescarUsuario,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
