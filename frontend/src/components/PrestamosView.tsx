import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo de PRÉSTAMOS (rubro prestamista). Se muestra en el panel del negocio.
interface PrestamoResumen {
  id: string; deudorNombre: string; deudorTelefono: string | null;
  capital: number; tasaInteresMensual: number; plazoCuotas: number; frecuencia: string;
  estado: string; totalCuotas: number; cuotasPagadas: number; saldoPendiente: number;
  proximaCuota: string | null; enMora: boolean;
}
interface Cuota {
  id: string; numero: number; fechaVencimiento: string; monto: string | number;
  capital: string | number; interes: string | number; montoPagado: string | number; pagada: boolean; fechaPago: string | null;
}
interface PrestamoDetalle extends PrestamoResumen { cuotas: Cuota[] }

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "—");
const hoy = () => new Date().toISOString().slice(0, 10);

export function PrestamosView({ negocio }: { negocio: Negocio }) {
  const [prestamos, setPrestamos] = useState<PrestamoResumen[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [nuevo, setNuevo] = useState(false);

  function cargar() {
    api.get<{ prestamos: PrestamoResumen[] }>(`/lending?negocioId=${negocio.id}`).then((r) => setPrestamos(r.prestamos)).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  return (
    <div className="card">
      <div className="row spread">
        <h2>💵 Préstamos</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>
          {nuevo ? "Cerrar" : "+ Nuevo préstamo"}
        </button>
      </div>
      {msg && <p className="success small">{msg}</p>}

      {nuevo && <FormNuevo negocioId={negocio.id} onCreado={() => { setNuevo(false); setMsg("Préstamo creado con su cronograma."); cargar(); }} />}

      {prestamos.length === 0 ? (
        <p className="muted small">Aún no hay préstamos. Crea el primero.</p>
      ) : (
        prestamos.map((p) => (
          <div className="list-item" key={p.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>{p.deudorNombre}</h3>
                <span className="muted small">
                  {money(p.capital)} · {p.tasaInteresMensual}%/mes · {p.plazoCuotas} cuotas ({p.frecuencia})
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={`badge ${p.estado === "pagado" ? "ok" : p.enMora ? "err" : "warn"}`}>
                  {p.estado === "pagado" ? "Pagado" : p.enMora ? "En mora" : "Activo"}
                </span>
                <div className="small" style={{ marginTop: 4 }}>Saldo: <strong>{money(p.saldoPendiente)}</strong></div>
              </div>
            </div>
            <div className="row spread">
              <span className="muted small">
                {p.cuotasPagadas}/{p.totalCuotas} cuotas · próx.: {fecha(p.proximaCuota)}
              </span>
              <button className="ghost small" onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                {abierto === p.id ? "Ocultar" : "Ver cuotas / cobrar"}
              </button>
            </div>
            {abierto === p.id && <Detalle prestamoId={p.id} onPago={() => { cargar(); }} />}
          </div>
        ))
      )}
    </div>
  );
}

function FormNuevo({ negocioId, onCreado }: { negocioId: string; onCreado: () => void }) {
  const [f, setF] = useState({ deudorNombre: "", deudorTelefono: "", capital: "", tasaInteresMensual: "5", plazoCuotas: "6", frecuencia: "mensual", fechaInicio: hoy(), notas: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  function set<K extends keyof typeof f>(k: K, v: string) { setF((p) => ({ ...p, [k]: v })); }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setEnviando(true);
    try {
      await api.post("/lending", { ...f, negocioId });
      onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    } finally { setEnviando(false); }
  }

  return (
    <form onSubmit={enviar} className="card" style={{ background: "var(--surface-2)", marginTop: 10 }}>
      <label>Nombre del deudor</label>
      <input value={f.deudorNombre} onChange={(e) => set("deudorNombre", e.target.value)} required />
      <label>Teléfono (opcional)</label>
      <input value={f.deudorTelefono} onChange={(e) => set("deudorTelefono", e.target.value)} />
      <div className="grid grid-2">
        <div>
          <label>Capital (monto prestado)</label>
          <input type="number" step="0.01" min="1" value={f.capital} onChange={(e) => set("capital", e.target.value)} required />
        </div>
        <div>
          <label>Interés % mensual</label>
          <input type="number" step="0.01" min="0" value={f.tasaInteresMensual} onChange={(e) => set("tasaInteresMensual", e.target.value)} required />
        </div>
        <div>
          <label>N.º de cuotas</label>
          <input type="number" min="1" max="360" value={f.plazoCuotas} onChange={(e) => set("plazoCuotas", e.target.value)} required />
        </div>
        <div>
          <label>Frecuencia</label>
          <select value={f.frecuencia} onChange={(e) => set("frecuencia", e.target.value)}>
            <option value="semanal">Semanal</option>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
        </div>
      </div>
      <label>Fecha de inicio</label>
      <input type="date" value={f.fechaInicio} onChange={(e) => set("fechaInicio", e.target.value)} required />
      <label>Notas (opcional)</label>
      <input value={f.notas} onChange={(e) => set("notas", e.target.value)} />
      {error && <p className="error small">{error}</p>}
      <button className="primary" style={{ marginTop: 10 }} disabled={enviando}>{enviando ? "Creando…" : "Crear préstamo"}</button>
    </form>
  );
}

function Detalle({ prestamoId, onPago }: { prestamoId: string; onPago: () => void }) {
  const [det, setDet] = useState<PrestamoDetalle | null>(null);
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function cargar() {
    api.get<{ prestamo: PrestamoDetalle }>(`/lending/${prestamoId}`).then((r) => setDet(r.prestamo)).catch(() => {});
  }
  useEffect(cargar, [prestamoId]);

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    try {
      const r = await api.post<{ excedente: number }>(`/lending/${prestamoId}/pagar`, { monto });
      setMsg(`Pago registrado.${r.excedente > 0 ? ` Excedente: ${money(r.excedente)}` : ""}`);
      setMonto("");
      cargar(); onPago();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error");
    }
  }

  if (!det) return <p className="muted small" style={{ marginTop: 8 }}>Cargando…</p>;

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
      {det.estado === "activo" && (
        <form onSubmit={pagar} className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input type="number" step="0.01" min="0.01" placeholder="Monto a cobrar" value={monto} onChange={(e) => setMonto(e.target.value)} required style={{ flex: 1 }} />
          <button className="primary" type="submit">Registrar pago</button>
        </form>
      )}
      {msg && <p className="success small">{msg}</p>}
      {error && <p className="error small">{error}</p>}
      <div style={{ overflowX: "auto" }}>
        <table className="tabla-cuotas" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--faint)" }}>
              <th style={{ padding: "4px 6px" }}>#</th>
              <th style={{ padding: "4px 6px" }}>Vence</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Cuota</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Capital</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Interés</th>
              <th style={{ padding: "4px 6px", textAlign: "center" }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {det.cuotas.map((c) => {
              const vencida = !c.pagada && new Date(c.fechaVencimiento) < new Date();
              return (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px" }}>{c.numero}</td>
                  <td style={{ padding: "4px 6px" }}>{fecha(c.fechaVencimiento)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{money(c.monto)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{money(c.capital)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{money(c.interes)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <span className={`badge ${c.pagada ? "ok" : vencida ? "err" : "warn"}`}>
                      {c.pagada ? "Pagada" : vencida ? "Vencida" : "Pendiente"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
