import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useT } from "../i18n";

export function VerificarEmail({ token }: { token: string }) {
  const { t } = useT();
  const [estado, setEstado] = useState<"verificando" | "ok" | "error">("verificando");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api
      .post<{ mensaje: string }>("/auth/email/verificar", { token })
      .then(() => { setEstado("ok"); setMsg("✓"); })
      .catch((e) => { setEstado("error"); setMsg(e instanceof ApiError ? e.message : t("common.error")); });
  }, [token]);

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: 40 }}>
      <div className="card">
        <h1>{t("verify.title")}</h1>
        {estado === "verificando" && <p className="muted">{t("verify.verifying")}</p>}
        {estado === "ok" && <p className="success">{t("verify.done")}</p>}
        {estado === "error" && <p className="error">{msg}</p>}
        <a href="/"><button className="primary" style={{ marginTop: 12 }}>{t("verify.goHome")}</button></a>
      </div>
    </div>
  );
}
