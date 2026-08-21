import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo COMPRAS (reposición de inventario desde proveedores).
interface Producto { id: string; nombre: string; costo: string | number | null }
interface LineaCompra { productoId?: string; nombre: string; cantidad: number; costoUnit: number }
interface Compra { id: string; proveedor: string | null; total: string | number; fecha: string; lineas: { nombre: string; cantidad: string | number; costoUnit: string | number }[] }
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const hoy = () => new Date().toISOString().slice(0, 10);

export function ComprasView({ negocio }: { negocio: Negocio }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [l, setL] = useState({ productoId: "", nombre: "", cantidad: "1", costoUnit: "" });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}`).then((r) => setProductos(r.productos)).catch(() => {});
    api.get<{ compras: Compra[] }>(`/compras?negocioId=${negocio.id}`).then((r) => setCompras(r.compras)).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  function agregarLinea() {
    const nombre = l.productoId ? (productos.find((p) => p.id === l.productoId)?.nombre ?? l.nombre) : l.nombre;
    if (!nombre || !l.costoUnit) return;
    setLineas((xs) => [...xs, { productoId: l.productoId || undefined, nombre, cantidad: Number(l.cantidad), costoUnit: Number(l.costoUnit) }]);
    setL({ productoId: "", nombre: "", cantidad: "1", costoUnit: "" });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setError(""); setMsg("");
    if (lineas.length === 0) { setError("Agrega al menos una línea."); return; }
    try {
      await api.post("/compras", { negocioId: negocio.id, proveedor, fecha, lineas });
      setMsg("Compra registrada y stock actualizado."); setLineas([]); setProveedor(""); cargar();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }

  const total = lineas.reduce((s, x) => s + x.cantidad * x.costoUnit, 0);

  return (
    <div className="card">
      <h2>📥 Compras</h2>
      <form onSubmit={guardar}>
        <div className="grid grid-2">
          <div><label>Proveedor (opcional)</label><input value={proveedor} onChange={(e) => setProveedor(e.target.value)} /></div>
          <div><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
        </div>

        <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <div className="grid grid-2">
            <div><label>Producto (o texto libre)</label>
              <select value={l.productoId} onChange={(e) => setL({ ...l, productoId: e.target.value })}>
                <option value="">— Otro (escribir abajo) —</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div><label>Nombre (si es otro)</label><input value={l.nombre} onChange={(e) => setL({ ...l, nombre: e.target.value })} disabled={!!l.productoId} /></div>
            <div><label>Cantidad</label><input type="number" step="0.001" min="0" value={l.cantidad} onChange={(e) => setL({ ...l, cantidad: e.target.value })} /></div>
            <div><label>Costo unitario</label><input type="number" step="0.01" min="0" value={l.costoUnit} onChange={(e) => setL({ ...l, costoUnit: e.target.value })} /></div>
          </div>
          <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={agregarLinea}>+ Agregar línea</button>
        </div>

        {lineas.map((x, i) => (
          <div className="list-item" key={i}>
            <div>{x.cantidad}× {x.nombre} {x.productoId ? <span className="badge ok">↑ stock</span> : null}</div>
            <div className="row"><strong>{money(x.cantidad * x.costoUnit)}</strong><button type="button" className="ghost small" onClick={() => setLineas((xs) => xs.filter((_, k) => k !== i))}>✕</button></div>
          </div>
        ))}
        {lineas.length > 0 && <div className="row spread" style={{ marginTop: 8, fontWeight: 800 }}><span>Total</span><span className="grad-text">{money(total)}</span></div>}
        {error && <p className="error small">{error}</p>}
        {msg && <p className="success small">{msg}</p>}
        <button className="primary" style={{ width: "100%", marginTop: 10 }} disabled={lineas.length === 0}>Registrar compra</button>
      </form>

      {compras.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong className="small">Compras recientes</strong>
          {compras.slice(0, 8).map((c) => (
            <div className="list-item" key={c.id}><span className="muted small">{new Date(c.fecha).toLocaleDateString()} · {c.proveedor ?? "—"} · {c.lineas.length} ítems</span><strong>{money(c.total)}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}
