import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo GASTOS (casi todos los rubros).
interface Gasto { id: string; categoria: string | null; descripcion: string; monto: string | number; fecha: string }
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const hoy = () => new Date().toISOString().slice(0, 10);
const mesActual = () => new Date().toISOString().slice(0, 7);

export function GastosView({ negocio }: { negocio: Negocio }) {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [total, setTotal] = useState(0);
  const [mes, setMes] = useState(mesActual());
  const [f, setF] = useState({ categoria: "", descripcion: "", monto: "", fecha: hoy() });
  const [error, setError] = useState("");

  function cargar() {
    api.get<{ gastos: Gasto[]; total: number }>(`/gastos?negocioId=${negocio.id}&mes=${mes}`).then((r) => { setGastos(r.gastos); setTotal(r.total); }).catch(() => {});
  }
  useEffect(cargar, [negocio.id, mes]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/gastos", { ...f, negocioId: negocio.id }); setF({ categoria: "", descripcion: "", monto: "", fecha: hoy() }); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }
  async function borrar(id: string) { await api.del(`/gastos/${id}`); cargar(); }

  return (
    <div className="card">
      <div className="row spread">
        <h2>🧾 Gastos</h2>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: "auto" }} />
      </div>
      <div className="card" style={{ background: "var(--surface-2)" }}>
        <div className="row spread"><strong>Total del mes</strong><span className="grad-text" style={{ fontWeight: 800 }}>{money(total)}</span></div>
      </div>
      <form onSubmit={crear} className="grid grid-2" style={{ marginTop: 10 }}>
        <div><label>Descripción</label><input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} required /></div>
        <div><label>Categoría (opcional)</label><input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder="alquiler, luz, sueldos…" /></div>
        <div><label>Monto</label><input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} required /></div>
        <div><label>Fecha</label><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} required /></div>
        <button className="primary" style={{ gridColumn: "1 / -1" }}>+ Registrar gasto</button>
      </form>
      {error && <p className="error small">{error}</p>}
      {gastos.map((g) => (
        <div className="list-item" key={g.id}>
          <div><strong>{g.descripcion}</strong> {g.categoria ? <span className="muted small">· {g.categoria}</span> : null}<br /><span className="muted small">{new Date(g.fecha).toLocaleDateString()}</span></div>
          <div className="row"><strong>{money(g.monto)}</strong><button className="ghost small" onClick={() => borrar(g.id)}>✕</button></div>
        </div>
      ))}
      {gastos.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>Sin gastos este mes.</p>}
    </div>
  );
}
