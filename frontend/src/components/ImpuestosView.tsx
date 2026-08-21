import { useEffect, useState } from "react";
import { api, type Negocio } from "../api";
import { Stat } from "./Ui";

// Módulo IMPUESTOS: reporte del ITBIS/IVA cobrado en ventas del mes.
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const mesActual = () => new Date().toISOString().slice(0, 7);

export function ImpuestosView({ negocio }: { negocio: Negocio }) {
  const [mes, setMes] = useState(mesActual());
  const [r, setR] = useState<{ conteo: number; subtotal: number; impuesto: number; total: number } | null>(null);

  useEffect(() => {
    api.get<{ conteo: number; subtotal: number; impuesto: number; total: number }>(`/impuestos/reporte?negocioId=${negocio.id}&mes=${mes}`)
      .then(setR).catch(() => setR(null));
  }, [negocio.id, mes]);

  return (
    <div className="card">
      <div className="row spread">
        <h2>🧮 Impuestos</h2>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: "auto" }} />
      </div>
      <p className="muted small">ITBIS/IVA cobrado en las ventas del mes (declaración).</p>
      {r ? (
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <Stat label="Ventas (subtotal)" value={money(r.subtotal)} icon="🛒" />
          <Stat label="Impuesto cobrado" value={money(r.impuesto)} icon="🧮" variant="green" />
          <Stat label="Total facturado" value={money(r.total)} icon="💵" variant="accent" />
          <Stat label="N.º de ventas" value={r.conteo} icon="🧾" />
        </div>
      ) : (
        <p className="muted small">Sin datos para este mes.</p>
      )}
    </div>
  );
}
