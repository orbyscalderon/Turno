import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo MESAS / COMANDAS (restaurante).
interface Linea { id: string; nombre: string; cantidad: string | number; precioUnit: string | number; notas: string | null }
interface Comanda { id: string; estado: string; total: string | number; lineas: Linea[] }
interface Mesa { id: string; nombre: string; estado: string; comandas: Comanda[] }
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function MesasView({ negocio }: { negocio: Negocio }) {
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [nombreMesa, setNombreMesa] = useState("");
  const [activa, setActiva] = useState<string | null>(null); // comandaId abierta en edición

  function cargar() { api.get<{ mesas: Mesa[] }>(`/mesas/mesas?negocioId=${negocio.id}`).then((r) => setMesas(r.mesas)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  async function crearMesa(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreMesa.trim()) return;
    await api.post("/mesas/mesas", { negocioId: negocio.id, nombre: nombreMesa });
    setNombreMesa(""); cargar();
  }

  async function abrirComanda(mesa: Mesa) {
    const r = await api.post<{ comanda: Comanda }>("/mesas/comandas", { negocioId: negocio.id, mesaId: mesa.id });
    setActiva(r.comanda.id); cargar();
  }

  return (
    <div className="card">
      <h2>🍽️ Mesas y comandas</h2>
      <form onSubmit={crearMesa} className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input placeholder="Nombre de mesa (ej: Mesa 1)" value={nombreMesa} onChange={(e) => setNombreMesa(e.target.value)} style={{ flex: 1 }} />
        <button className="ghost" type="submit">+ Mesa</button>
      </form>

      {mesas.length === 0 ? (
        <p className="muted small">Crea tu primera mesa.</p>
      ) : (
        <div className="grid grid-2">
          {mesas.map((m) => {
            const comanda = m.comandas[0];
            return (
              <div className="card" key={m.id} style={{ margin: 0, borderColor: m.estado === "ocupada" ? "var(--brand-600)" : undefined }}>
                <div className="row spread">
                  <strong>{m.nombre}</strong>
                  <span className={`badge ${m.estado === "ocupada" ? "warn" : "ok"}`}>{m.estado}</span>
                </div>
                {comanda ? (
                  <>
                    <div className="row spread" style={{ marginTop: 6 }}>
                      <span className="muted small">{comanda.lineas.length} ítems</span>
                      <strong>{money(comanda.total)}</strong>
                    </div>
                    <button className="primary small" style={{ width: "100%", marginTop: 8 }} onClick={() => setActiva(comanda.id)}>Abrir comanda</button>
                  </>
                ) : (
                  <button className="ghost small" style={{ width: "100%", marginTop: 8 }} onClick={() => abrirComanda(m)}>Abrir comanda</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activa && <ComandaEditor comandaId={activa} onCerrar={() => { setActiva(null); cargar(); }} />}
    </div>
  );
}

function ComandaEditor({ comandaId, onCerrar }: { comandaId: string; onCerrar: () => void }) {
  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [l, setL] = useState({ nombre: "", cantidad: "1", precioUnit: "", notas: "" });
  const [error, setError] = useState("");

  function cargar() { api.get<{ comanda: Comanda }>(`/mesas/comandas/${comandaId}`).then((r) => setComanda(r.comanda)).catch(() => {}); }
  useEffect(cargar, [comandaId]);

  async function agregar(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post(`/mesas/comandas/${comandaId}/lineas`, l); setL({ nombre: "", cantidad: "1", precioUnit: "", notas: "" }); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }
  async function quitar(lineaId: string) { await api.del(`/mesas/comandas/${comandaId}/lineas/${lineaId}`); cargar(); }
  async function cobrar() { await api.post(`/mesas/comandas/${comandaId}/cobrar`, {}); onCerrar(); }

  if (!comanda) return null;

  return (
    <div className="card pop" style={{ background: "var(--surface-2)", marginTop: 12, borderColor: "var(--brand-600)" }}>
      <div className="row spread"><h3 style={{ margin: 0 }}>Comanda</h3><button className="ghost small" onClick={onCerrar}>Cerrar</button></div>
      {comanda.lineas.map((x) => (
        <div className="list-item" key={x.id}>
          <div>{Number(x.cantidad)}× {x.nombre} {x.notas ? <span className="muted small">({x.notas})</span> : null}</div>
          <div className="row"><strong>{money(Number(x.cantidad) * Number(x.precioUnit))}</strong><button className="ghost small" onClick={() => quitar(x.id)}>✕</button></div>
        </div>
      ))}
      <form onSubmit={agregar} className="grid grid-2" style={{ marginTop: 8 }}>
        <div><label>Plato / ítem</label><input value={l.nombre} onChange={(e) => setL({ ...l, nombre: e.target.value })} required /></div>
        <div><label>Precio</label><input type="number" step="0.01" min="0" value={l.precioUnit} onChange={(e) => setL({ ...l, precioUnit: e.target.value })} required /></div>
        <div><label>Cantidad</label><input type="number" min="1" value={l.cantidad} onChange={(e) => setL({ ...l, cantidad: e.target.value })} /></div>
        <div><label>Notas (opcional)</label><input value={l.notas} onChange={(e) => setL({ ...l, notas: e.target.value })} placeholder="sin cebolla…" /></div>
        <button className="ghost" type="submit" style={{ gridColumn: "1 / -1" }}>+ Agregar a la comanda</button>
      </form>
      {error && <p className="error small">{error}</p>}
      <div className="row spread" style={{ marginTop: 10, fontSize: 18, fontWeight: 800 }}><span>Total</span><span className="grad-text">{money(comanda.total)}</span></div>
      <button className="primary" style={{ width: "100%", marginTop: 10 }} onClick={cobrar} disabled={comanda.lineas.length === 0}>Cobrar y liberar mesa</button>
    </div>
  );
}
