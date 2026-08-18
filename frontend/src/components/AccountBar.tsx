import { useState } from "react";
import { api, getToken, apiUrl } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";

// Barra de cuenta: aviso de verificación de email + acciones GDPR (exportar/borrar datos).
export function AccountBar() {
  const { usuario, logout, refrescarUsuario } = useAuth();
  const { t } = useT();
  const [msg, setMsg] = useState("");
  const [abrirCuenta, setAbrirCuenta] = useState(false);

  if (!usuario) return null;

  async function reenviar() {
    const r = await api.post<{ mensaje: string }>("/auth/email/reenviar");
    setMsg(r.mensaje);
  }

  function exportar() {
    // Descarga autenticada del export GDPR.
    fetch(apiUrl("/api/auth/me/export"), { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "mis-datos-turno.json"; a.click();
        URL.revokeObjectURL(url);
      });
  }

  async function borrar() {
    if (!confirm(t("account.deleteConfirm"))) return;
    await api.del("/auth/me");
    logout();
  }

  const verificado = !!usuario.emailVerificadoEn;

  return (
    <div className="container" style={{ paddingTop: 12, paddingBottom: 0 }}>
      {!verificado && (
        <div className="card" style={{ borderColor: "var(--amber)", marginBottom: 8 }}>
          <div className="row spread">
            <span className="small">{t("account.verifyWarn")}</span>
            <button className="ghost small" onClick={reenviar}>{t("account.resend")}</button>
          </div>
          {msg && <p className="success small" style={{ margin: "6px 0 0" }}>{msg}</p>}
        </div>
      )}

      <div className="row spread">
        <button className="ghost small" onClick={() => setAbrirCuenta((v) => !v)}>
          {abrirCuenta ? "▲" : "▼"} {t("account.my")}
        </button>
      </div>
      {abrirCuenta && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="row">
            <button className="ghost small" onClick={exportar}>{t("account.export")}</button>
            <button className="ghost small" onClick={refrescarUsuario}>{t("account.refresh")}</button>
            {usuario.rol !== "superadmin" && (
              <button className="ghost small" style={{ color: "var(--danger)" }} onClick={borrar}>{t("account.delete")}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
