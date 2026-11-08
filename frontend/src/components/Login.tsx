import { useState } from "react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useT } from "../i18n";
import { GoogleButton } from "./GoogleButton";
import { PasoDosFactores } from "./DosFactores";
import { evento } from "../analitica";

export function Login() {
  const { login, loginGoogle, registro } = useAuth();
  const { t } = useT();
  const [modo, setModo] = useState<"login" | "registro" | "olvide">("login");
  // Desafío pendiente de segundo factor: mientras exista, no hay sesión abierta.
  const [desafio2fa, setDesafio2fa] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [cargando, setCargando] = useState(false);

  const [form, setForm] = useState({
    nombre: "",
    telefono: "",
    email: "",
    password: "",
    rol: "cliente" as "admin_negocio" | "peluquero" | "cliente",
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setAviso("");
    setCargando(true);
    try {
      if (modo === "login") {
        const r = await login(form.email, form.password);
        if (r.ok) evento("login_completado");
        else setDesafio2fa(r.desafio);
      } else if (modo === "registro") {
        await registro(form);
        evento("registro_completado", { rol: form.rol });
      } else {
        const r = await api.post<{ mensaje: string }>("/auth/password/olvide", { email: form.email });
        setAviso(r.mensaje);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  async function onGoogle(credential: string) {
    setError(""); setAviso("");
    setCargando(true);
    try {
      const r = await loginGoogle(credential);
      if (r.ok) evento("login_completado", { via: "google" });
      else setDesafio2fa(r.desafio);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setCargando(false);
    }
  }

  // El segundo factor sustituye al formulario: no se vuelve atrás por error.
  if (desafio2fa) {
    return <PasoDosFactores desafio={desafio2fa} onCancelar={() => setDesafio2fa(null)} />;
  }

  const titulo = modo === "login" ? t("login.title") : modo === "registro" ? t("login.register") : t("login.recover");

  return (
    <div className="login-wrap">
      <div className="container" style={{ maxWidth: 440, position: "relative" }}>
        {/* Cabecera de bienvenida — emojis multi-rubro (no solo barbería) */}
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", fontSize: 34, lineHeight: 1 }}>
            {["💇", "💅", "🧖", "💆", "✨"].map((e, i) => (
              <span key={e} className="float-emoji" style={{ animationDelay: `${i * 0.25}s` }}>{e}</span>
            ))}
          </div>
          <h1 className="grad-text" style={{ fontSize: 38, marginTop: 16 }}>
            {t("mkt.heroTitle")}
          </h1>
          <p className="muted" style={{ maxWidth: 380, margin: "8px auto 0" }}>{t("brand.tagline")}</p>
        </div>

        <div className="card glass-card pop">
          <h2>{titulo}</h2>

          <form onSubmit={onSubmit}>
            {modo === "registro" && (
              <>
                <label htmlFor="login-login-name">{t("login.name")}</label>
                <input id="login-login-name" value={form.nombre} onChange={(e) => set("nombre", e.target.value)} required />
                <label htmlFor="login-login-phone">{t("login.phone")}</label>
                <input id="login-login-phone" value={form.telefono} onChange={(e) => set("telefono", e.target.value)} required />
                <label htmlFor="login-login-registeras">{t("login.registerAs")}</label>
                <select id="login-login-registeras" value={form.rol} onChange={(e) => set("rol", e.target.value as typeof form.rol)}>
                  <option value="cliente">{t("login.optClient")}</option>
                  <option value="peluquero">{t("login.optPro")}</option>
                  <option value="admin_negocio">{t("login.optOwner")}</option>
                </select>
              </>
            )}
            <label htmlFor="login-login-email">{t("login.email")}</label>
            <input id="login-login-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
            {modo !== "olvide" && (
              <>
                <label htmlFor="login-login-password">{t("login.password")}</label>
                <input id="login-login-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  required
                  minLength={modo === "registro" ? 8 : undefined}
                />
              </>
            )}

            {error && <p className="error">{error}</p>}
            {aviso && <p className="success">{aviso}</p>}

            <button className="primary" type="submit" disabled={cargando} style={{ width: "100%", marginTop: 18 }}>
              {cargando ? "..." : modo === "login" ? t("login.enter") : modo === "registro" ? t("login.doRegister") : t("login.sendLink")}
            </button>
          </form>

          {modo !== "olvide" && (
            <GoogleButton onCredential={onGoogle} texto={modo === "registro" ? "signup_with" : "continue_with"} />
          )}

          {modo === "login" && (
            <p className="small muted" style={{ marginTop: 14 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setModo("olvide"); setError(""); setAviso(""); }}>
                {t("login.forgot")}
              </a>
            </p>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            {modo === "registro" ? t("login.haveAccountQ") : modo === "olvide" ? "" : t("login.noAccountQ")}{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setModo(modo === "login" ? "registro" : "login"); setError(""); setAviso(""); }}>
              {modo === "login" ? t("login.goRegister") : t("login.goLogin")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
