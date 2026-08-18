import { useState } from "react";
import { api, ApiError } from "../api";
import { useT } from "../i18n";

export function ResetPassword({ token }: { token: string }) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    try {
      await api.post("/auth/password/reset", { token, password });
      setListo(true);
      setMsg(t("reset.saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 420, marginTop: 40 }}>
      <div className="card">
        <h1>{t("reset.title")}</h1>
        {!listo ? (
          <form onSubmit={enviar}>
            <label>{t("reset.prompt")}</label>
            <input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <p className="error">{error}</p>}
            <button className="primary" style={{ width: "100%", marginTop: 12 }}>{t("common.save")}</button>
          </form>
        ) : (
          <>
            <p className="success">{msg}</p>
            <a href="/"><button className="primary">{t("reset.goLogin")}</button></a>
          </>
        )}
      </div>
    </div>
  );
}
