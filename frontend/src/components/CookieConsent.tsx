import { useState } from "react";
import { useT } from "../i18n";

// Banner de consentimiento de cookies (persistencia en localStorage).
export function CookieConsent() {
  const { lang } = useT();
  const es = lang === "es";
  const [aceptado, setAceptado] = useState(() => localStorage.getItem("turno_cookies") === "1");

  if (aceptado) return null;

  function aceptar() {
    localStorage.setItem("turno_cookies", "1");
    setAceptado(true);
  }

  return (
    <div style={{
      position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 50,
      maxWidth: 620, margin: "0 auto",
    }}>
      <div className="card glass-card" style={{ marginBottom: 0 }}>
        <div className="row spread">
          <span className="small" style={{ flex: 1, minWidth: 220 }}>
            🍪 {es
              ? "Usamos almacenamiento local para tu sesión e idioma. Sin cookies publicitarias."
              : "We use local storage for your session and language. No advertising cookies."}
            {" "}<a href="/privacidad">{es ? "Más info" : "Learn more"}</a>
          </span>
          <button className="primary" onClick={aceptar}>{es ? "Aceptar" : "Accept"}</button>
        </div>
      </div>
    </div>
  );
}
