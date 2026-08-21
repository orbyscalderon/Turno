import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo ÓRDENES DE SERVICIO (taller / servicio técnico).
interface Orden {
  id: string; clienteNombre: string; clienteTelefono: string | null; equipo: string;
  problema: string | null; diagnostico: string | null; estado: string;
  costoEstimado: string | number | null; costoFinal: string | number | null; createdAt: string;
}
const ESTADOS = ["recibido", "diagnostico", "reparacion", "listo", "entregado", "cancelado"];
const LABEL: Record<string, string> = { recibido: "Recibido", diagnostico: "Diagnóstico", reparacion: "En reparación", listo: "Listo", entregado: "Entregado", cancelado: "Cancelado" };
const CLASE: Record<string, string> = { recibido: "warn", diagnostico: "warn", reparacion: "warn", listo: "ok", entregado: "ok", cancelado: "err" };
const money = (n: number | string | null) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);

export function ServiceOrdersView({ negocio }: { negocio: Negocio }) {
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ clienteNombre: "", clienteTelefono: "", equipo: "", problema: "", costoEstimado: "" });
  const [error, setError] = useState("");

  function cargar() { api.get<{ ordenes: Orden[] }>(`/ordenes-servicio?negocioId=${negocio.id}`).then((r) => setOrdenes(r.ordenes)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/ordenes-servicio", { ...f, negocioId: negocio.id }); setF({ clienteNombre: "", clienteTelefono: "", equipo: "", problema: "", costoEstimado: "" }); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }

  async function actualizar(id: string, data: Record<string, unknown>) { await api.patch(`/ordenes-servicio/${id}`, data); cargar(); }

  return (
    <div className="card">
      <div className="row spread">
        <h2>🔧 Órdenes de servicio</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? "Cerrar" : "+ Nueva orden"}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <div className="grid grid-2">
            <div><label>Cliente</label><input value={f.clienteNombre} onChange={(e) => setF({ ...f, clienteNombre: e.target.value })} required /></div>
            <div><label>Teléfono</label><input value={f.clienteTelefono} onChange={(e) => setF({ ...f, clienteTelefono: e.target.value })} /></div>
          </div>
          <label>Equipo / vehículo recibido</label>
          <input value={f.equipo} onChange={(e) => setF({ ...f, equipo: e.target.value })} required placeholder="Ej: Laptop HP 15, Honda Civic 2015…" />
          <label>Problema reportado</label>
          <input value={f.problema} onChange={(e) => setF({ ...f, problema: e.target.value })} />
          <label>Costo estimado (opcional)</label>
          <input type="number" step="0.01" min="0" value={f.costoEstimado} onChange={(e) => setF({ ...f, costoEstimado: e.target.value })} />
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>Crear orden</button>
        </form>
      )}

      {ordenes.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>Sin órdenes todavía.</p>
      ) : (
        ordenes.map((o) => (
          <div className="list-item" key={o.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div><strong>{o.equipo}</strong><br /><span className="muted small">{o.clienteNombre}{o.clienteTelefono ? ` · ${o.clienteTelefono}` : ""}</span></div>
              <span className={`badge ${CLASE[o.estado]}`}>{LABEL[o.estado]}</span>
            </div>
            {o.problema && <span className="small muted">Problema: {o.problema}</span>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label className="small muted" style={{ margin: 0 }}>Estado:</label>
              <select value={o.estado} onChange={(e) => actualizar(o.id, { estado: e.target.value })} style={{ width: "auto" }}>
                {ESTADOS.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
              </select>
              <span className="small muted">Est.: {money(o.costoEstimado)}</span>
              <button className="ghost small" onClick={() => { const v = prompt("Costo final:"); if (v) actualizar(o.id, { costoFinal: Number(v) }); }}>
                Final: {money(o.costoFinal)}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
