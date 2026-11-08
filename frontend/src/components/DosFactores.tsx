import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";

// Segundo factor (TOTP): el paso del login y la pantalla de configuración.

// ---------------------------------------------------------------------------
// Paso del login: canjear el desafío por la sesión
// ---------------------------------------------------------------------------

export function PasoDosFactores({ desafio, onCancelar }: { desafio: string; onCancelar: () => void }) {
  const { verificar2fa } = useAuth();
  const { t } = useT();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      await verificar2fa(desafio, codigo.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
      setCodigo("");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="container" style={{ maxWidth: 420 }}>
        <div className="card glass-card pop">
          <h2>{t("twofa.title")}</h2>
          <p className="muted small">{t("twofa.loginHelp")}</p>

          <form onSubmit={enviar}>
            <label htmlFor="codigo-2fa">{t("twofa.code")}</label>
            <input
              id="codigo-2fa"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              // Teclado numérico en el móvil y autorrelleno del gestor de contraseñas.
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456"
              style={{ fontSize: 24, letterSpacing: 4, textAlign: "center" }}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" type="submit" disabled={cargando} style={{ width: "100%", marginTop: 16 }}>
              {cargando ? "..." : t("twofa.verify")}
            </button>
          </form>

          <p className="small muted" style={{ marginTop: 14 }}>
            {t("twofa.lostPhone")}
          </p>
          <button className="ghost small" onClick={onCancelar} style={{ marginTop: 10 }}>
            {t("common.back")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuración desde el perfil
// ---------------------------------------------------------------------------

interface Estado {
  activo: boolean;
  codigosRestantes: number;
}

export function ConfigurarDosFactores({ obligatorio = false }: { obligatorio?: boolean }) {
  const { t } = useT();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [alta, setAlta] = useState<{ secreto: string; uri: string; qr: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [password, setPassword] = useState("");
  const [codigos, setCodigos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    try {
      setEstado(await api.get<Estado>("/auth/2fa/estado"));
    } catch {
      /* sin sesión válida no hay nada que mostrar */
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  async function iniciar() {
    setError("");
    setCargando(true);
    try {
      setAlta(await api.post<{ secreto: string; uri: string; qr: string }>("/auth/2fa/iniciar"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  async function activar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      const r = await api.post<{ codigosRecuperacion: string[] }>("/auth/2fa/activar", {
        codigo: codigo.trim(),
      });
      setCodigos(r.codigosRecuperacion);
      setAlta(null);
      setCodigo("");
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  async function desactivar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      await api.post("/auth/2fa/desactivar", { password });
      setPassword("");
      setCodigos([]);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  function descargarCodigos() {
    const blob = new Blob([codigos.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "turno-codigos-recuperacion.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!estado) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t("twofa.settingsTitle")}</h3>

      {obligatorio && !estado.activo && (
        <p className="error" role="alert">
          {t("twofa.required")}
        </p>
      )}

      {/* Códigos de recuperación recién generados: se muestran UNA sola vez. */}
      {codigos.length > 0 && (
        <div className="card" style={{ background: "rgba(255,200,0,.08)", marginBottom: 14 }}>
          <b>{t("twofa.recoveryTitle")}</b>
          <p className="small">{t("twofa.recoveryHelp")}</p>
          <pre
            style={{
              fontFamily: "monospace",
              fontSize: 15,
              lineHeight: 1.7,
              userSelect: "all",
              whiteSpace: "pre-wrap",
            }}
          >
            {codigos.join("   ")}
          </pre>
          <button className="ghost small" onClick={descargarCodigos}>
            {t("twofa.download")}
          </button>
        </div>
      )}

      {estado.activo ? (
        <>
          <p className="success">{t("twofa.active")}</p>
          <p className="small muted">
            {t("twofa.codesLeft", { n: estado.codigosRestantes })}
          </p>
          <form onSubmit={desactivar} style={{ marginTop: 12 }}>
            <label htmlFor="pw-2fa">{t("twofa.passwordToDisable")}</label>
            <input
              id="pw-2fa"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="danger" type="submit" disabled={cargando} style={{ marginTop: 10 }}>
              {t("twofa.disable")}
            </button>
          </form>
        </>
      ) : alta ? (
        <form onSubmit={activar}>
          <p className="small">{t("twofa.scanHelp")}</p>
          <img
            src={alta.qr}
            alt={t("twofa.qrAlt")}
            width={200}
            height={200}
            style={{ background: "#fff", padding: 8, borderRadius: 10 }}
          />
          <p className="small muted" style={{ marginTop: 10 }}>
            {t("twofa.manualKey")}
          </p>
          {/* Alternativa para quien no pueda escanear el QR. */}
          <code style={{ userSelect: "all", wordBreak: "break-all" }}>{alta.secreto}</code>

          <label htmlFor="cod-activar" style={{ marginTop: 14, display: "block" }}>
            {t("twofa.enterCode")}
          </label>
          <input
            id="cod-activar"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="primary" type="submit" disabled={cargando}>
              {t("twofa.activate")}
            </button>
            <button type="button" className="ghost" onClick={() => setAlta(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted small">{t("twofa.inactiveHelp")}</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" onClick={iniciar} disabled={cargando}>
            {t("twofa.enable")}
          </button>
        </>
      )}
    </div>
  );
}
