import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";
import { Stat } from "./Ui";

// Módulo AGRO (granja avícola): lotes/camadas con mortalidad, alimento y conversión (FCR).
interface LoteResumen {
  id: string; nombre: string; especie: string; tipoProduccion: string; cantidadInicial: number;
  estado: string; avesVivas: number; mortalidadPct: number; alimentoTotalKg: number; produccionTotal: number; edadDias: number; fcr: number | null;
}
interface Registro { id: string; fecha: string; mortalidad: number; alimentoKg: string | number; pesoPromedioG: string | number | null; produccion: number; notas: string | null }
const hoy = () => new Date().toISOString().slice(0, 10);
const fecha = (s: string) => new Date(s).toLocaleDateString();

export function AgroView({ negocio }: { negocio: Negocio }) {
  const [lotes, setLotes] = useState<LoteResumen[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [f, setF] = useState({ nombre: "", especie: "broiler", tipoProduccion: "meat", cantidadInicial: "", fechaInicio: hoy() });
  const [error, setError] = useState("");

  function cargar() { api.get<{ lotes: LoteResumen[] }>(`/agro/lotes?negocioId=${negocio.id}`).then((r) => setLotes(r.lotes)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/agro/lotes", { ...f, negocioId: negocio.id }); setF({ nombre: "", especie: "broiler", tipoProduccion: "meat", cantidadInicial: "", fechaInicio: hoy() }); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>🥚 Producción avícola</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? "Cerrar" : "+ Nuevo lote"}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <label>Nombre del lote/camada</label>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required placeholder="Ej: Galpón 3 — Agosto" />
          <div className="grid grid-2">
            <div><label>Especie</label>
              <select value={f.especie} onChange={(e) => setF({ ...f, especie: e.target.value })}>
                <option value="broiler">Pollo de engorde (broiler)</option>
                <option value="layer">Gallina ponedora (layer)</option>
              </select>
            </div>
            <div><label>Producción</label>
              <select value={f.tipoProduccion} onChange={(e) => setF({ ...f, tipoProduccion: e.target.value })}>
                <option value="meat">Carne</option>
                <option value="eggs">Huevos</option>
              </select>
            </div>
            <div><label>Cantidad inicial de aves</label><input type="number" min="1" value={f.cantidadInicial} onChange={(e) => setF({ ...f, cantidadInicial: e.target.value })} required /></div>
            <div><label>Fecha de ingreso</label><input type="date" value={f.fechaInicio} onChange={(e) => setF({ ...f, fechaInicio: e.target.value })} required /></div>
          </div>
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>Crear lote</button>
        </form>
      )}

      {lotes.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>Aún no hay lotes.</p>
      ) : (
        lotes.map((l) => (
          <div className="list-item" key={l.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>{l.nombre}</h3>
                <span className="muted small">{l.especie === "broiler" ? "Engorde" : "Ponedora"} · {l.tipoProduccion === "meat" ? "carne" : "huevos"} · {l.edadDias} días</span>
              </div>
              <span className={`badge ${l.estado === "cerrado" ? "" : "ok"}`}>{l.estado}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="badge ok">Vivas: {l.avesVivas}/{l.cantidadInicial}</span>
              <span className={`badge ${l.mortalidadPct > 5 ? "err" : "warn"}`}>Mortalidad: {l.mortalidadPct}%</span>
              <span className="badge">Alimento: {l.alimentoTotalKg} kg</span>
              {l.tipoProduccion === "eggs" && <span className="badge">Huevos: {l.produccionTotal}</span>}
              {l.fcr != null && <span className="badge">FCR: {l.fcr}</span>}
            </div>
            <div className="row spread">
              <span className="muted small" />
              <button className="ghost small" onClick={() => setAbierto(abierto === l.id ? null : l.id)}>{abierto === l.id ? "Ocultar" : "Registrar día / ver historial"}</button>
            </div>
            {abierto === l.id && <DetalleLote loteId={l.id} onCambio={cargar} />}
          </div>
        ))
      )}
    </div>
  );
}

function DetalleLote({ loteId, onCambio }: { loteId: string; onCambio: () => void }) {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [metricas, setMetricas] = useState<{ avesVivas: number; alimentoTotalKg: number; fcr: number | null; produccionTotal: number } | null>(null);
  const [r, setR] = useState({ fecha: hoy(), mortalidad: "0", alimentoKg: "0", pesoPromedioG: "", produccion: "0" });
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<{ lote: { registros: Registro[] }; metricas: { avesVivas: number; alimentoTotalKg: number; fcr: number | null; produccionTotal: number } }>(`/agro/lotes/${loteId}`)
      .then((res) => { setRegistros(res.lote.registros); setMetricas(res.metricas); }).catch(() => {});
  }
  useEffect(cargar, [loteId]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    await api.post(`/agro/lotes/${loteId}/registros`, r);
    setMsg("Registro guardado.");
    cargar(); onCambio();
  }

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
      <form onSubmit={guardar}>
        <div className="grid grid-2">
          <div><label>Fecha</label><input type="date" value={r.fecha} onChange={(e) => setR({ ...r, fecha: e.target.value })} required /></div>
          <div><label>Mortalidad (aves)</label><input type="number" min="0" value={r.mortalidad} onChange={(e) => setR({ ...r, mortalidad: e.target.value })} /></div>
          <div><label>Alimento (kg)</label><input type="number" step="0.001" min="0" value={r.alimentoKg} onChange={(e) => setR({ ...r, alimentoKg: e.target.value })} /></div>
          <div><label>Peso promedio (g)</label><input type="number" step="0.1" min="0" value={r.pesoPromedioG} onChange={(e) => setR({ ...r, pesoPromedioG: e.target.value })} /></div>
          <div><label>Producción (huevos)</label><input type="number" min="0" value={r.produccion} onChange={(e) => setR({ ...r, produccion: e.target.value })} /></div>
        </div>
        <button className="primary" style={{ marginTop: 10 }}>Guardar registro del día</button>
        {msg && <span className="success small" style={{ marginLeft: 10 }}>{msg}</span>}
      </form>

      {registros.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--faint)" }}>
              <th style={{ padding: "4px 6px" }}>Fecha</th><th style={{ padding: "4px 6px", textAlign: "right" }}>Mort.</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Alim. kg</th><th style={{ padding: "4px 6px", textAlign: "right" }}>Peso g</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Prod.</th>
            </tr></thead>
            <tbody>
              {registros.map((x) => (
                <tr key={x.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px" }}>{fecha(x.fecha)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.mortalidad}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{Number(x.alimentoKg)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.pesoPromedioG != null ? Number(x.pesoPromedioG) : "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.produccion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {metricas && (
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <Stat label="Aves vivas" value={metricas.avesVivas} icon="🐔" />
          <Stat label="Alimento total" value={`${metricas.alimentoTotalKg} kg`} icon="🌾" variant="accent" />
          {metricas.fcr != null && <Stat label="Conversión (FCR)" value={metricas.fcr} icon="📉" variant="green" />}
          {metricas.produccionTotal > 0 && <Stat label="Producción total" value={metricas.produccionTotal} icon="🥚" />}
        </div>
      )}
    </div>
  );
}
