import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

interface Plan { id: string; nombre: string; mensualUsd: number; anualUsd: number; anualPorMes: number; ahorroAnualUsd: number; }

// Página pública de precios (para atraer negocios antes de registrarse).
export function Precios({ onRegistrar }: { onRegistrar: () => void }) {
  const { t } = useT();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [intervalo, setIntervalo] = useState<"mensual" | "anual">("anual");

  useEffect(() => { api.get<{ planes: Plan[] }>("/suscripcion/planes").then((r) => setPlanes(r.planes)).catch(() => {}); }, []);

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <div className="mkt-hero" style={{ paddingTop: 44, paddingBottom: 32 }}>
        <h1 style={{ fontSize: 38 }}>{t("pub.pricingTitle")}</h1>
        <p className="sub">{t("pub.pricingSub")}</p>
        <div className="lang-toggle" style={{ margin: "6px auto 0" }}>
          <button className={intervalo === "mensual" ? "on" : ""} onClick={() => setIntervalo("mensual")}>{t("own.monthly")}</button>
          <button className={intervalo === "anual" ? "on" : ""} onClick={() => setIntervalo("anual")}>{t("own.annual")} · {t("own.save2months")}</button>
        </div>
      </div>

      <div className="grid grid-2">
        {planes.map((p, i) => (
          <div className="card" key={p.id} style={{ borderColor: i === 1 ? "var(--brand-500)" : undefined, boxShadow: i === 1 ? "var(--glow)" : undefined }}>
            <div className="row spread">
              <h2>{p.nombre}</h2>
              {i === 1 && <span className="badge ok">★</span>}
            </div>
            {intervalo === "mensual" ? (
              <div style={{ margin: "8px 0" }}><span style={{ fontSize: 34, fontWeight: 800 }}>${p.mensualUsd}</span><span className="muted">{t("own.perMonth")}</span></div>
            ) : (
              <div style={{ margin: "8px 0" }}>
                <span style={{ fontSize: 34, fontWeight: 800 }}>${p.anualUsd}</span><span className="muted">{t("own.perYear")}</span>
                <div className="muted small">${p.anualPorMes}{t("own.perMonth")} · {t("own.save2months")} (−${p.ahorroAnualUsd})</div>
              </div>
            )}
            <ul className="muted small" style={{ paddingLeft: 18, marginTop: 6 }}>
              <li>Reservas online 24/7</li>
              <li>Hasta 5 profesionales</li>
              <li>Cobro de fianza + recordatorios</li>
              <li>Analítica y liquidación por empleado</li>
            </ul>
            <button className="primary" style={{ width: "100%", marginTop: 10 }} onClick={onRegistrar}>{t("pub.registerBiz")}</button>
          </div>
        ))}
      </div>
      <p style={{ textAlign: "center", marginTop: 20 }}><a href="/">← {t("common.back")}</a></p>
    </div>
  );
}
