import { useEffect, useState } from "react";
import { api, ApiError, type Rol } from "../api";
import { useT } from "../i18n";

export function AceptarInvitacion({ token, rol }: { token: string; rol: Rol }) {
  const { t } = useT();
  const [negocio, setNegocio] = useState<{ nombreComercial: string } | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api
      .get<{ negocio: { nombreComercial: string } }>(`/negocios/invitaciones/${token}`)
      .then((r) => setNegocio(r.negocio))
      .catch((e) => setError(e instanceof ApiError ? e.message : t("invite.invalid")));
  }, [token]);

  async function aceptar() {
    setError(""); setMsg("");
    try {
      await api.post(`/negocios/invitaciones/${token}/aceptar`);
      setMsg(t("invite.joined"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480, marginTop: 40 }}>
      <div className="card">
        <h1>{t("invite.title")}</h1>
        {rol !== "peluquero" && <p className="error">{t("invite.mustPro")}</p>}
        {error && <p className="error">{error}</p>}
        {msg && <p className="success">{msg}</p>}
        {negocio && rol === "peluquero" && !msg && (
          <>
            <p>{t("invite.invited")} <strong>{negocio.nombreComercial}</strong>.</p>
            <button className="primary" onClick={aceptar}>{t("invite.accept")}</button>
          </>
        )}
        <p style={{ marginTop: 16 }}><a href="/">{t("common.back")}</a></p>
      </div>
    </div>
  );
}
