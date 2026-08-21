import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo POS + Inventario + Caja (rubros de retail/alimentos: supermercado, vape, ferretería, farmacia…).
interface Producto {
  id: string; nombre: string; sku: string | null; categoria: string | null; unidad: string;
  precioVenta: string | number; impuestoPct: string | number; costo: string | number | null;
  stock: string | number; stockMinimo: string | number; activo: boolean;
}
interface Sesion { id: string; montoInicial: string | number; abiertaEn: string; estado: string }
interface Venta { id: string; total: string | number; metodoPago: string; createdAt: string }

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const num = (n: number | string | null) => Number(n ?? 0);

export function ComercioView({ negocio }: { negocio: Negocio }) {
  const [tab, setTab] = useState<"vender" | "productos" | "caja">("vender");
  return (
    <div className="card">
      <h2>🛒 Comercio (POS)</h2>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={`tab ${tab === "vender" ? "active" : ""}`} onClick={() => setTab("vender")}>Vender</button>
        <button className={`tab ${tab === "productos" ? "active" : ""}`} onClick={() => setTab("productos")}>Productos</button>
        <button className={`tab ${tab === "caja" ? "active" : ""}`} onClick={() => setTab("caja")}>Caja</button>
      </div>
      {tab === "vender" && <Vender negocio={negocio} />}
      {tab === "productos" && <Productos negocio={negocio} />}
      {tab === "caja" && <Caja negocio={negocio} />}
    </div>
  );
}

// ---------- VENDER (POS) ----------
interface LineaCarrito { productoId?: string; nombre: string; cantidad: number; precioUnit: number; impuestoPct: number }

function Vender({ negocio }: { negocio: Negocio }) {
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Busca productos por nombre o código de barras (un escáner escribe el código + Enter).
  useEffect(() => {
    if (!busqueda.trim()) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}&q=${encodeURIComponent(busqueda)}`)
        .then((r) => setResultados(r.productos)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [busqueda, negocio.id]);

  function agregar(p: Producto) {
    setCarrito((c) => {
      const i = c.findIndex((l) => l.productoId === p.id);
      if (i >= 0) { const cp = [...c]; cp[i] = { ...cp[i], cantidad: cp[i].cantidad + 1 }; return cp; }
      return [...c, { productoId: p.id, nombre: p.nombre, cantidad: 1, precioUnit: num(p.precioVenta), impuestoPct: num(p.impuestoPct) }];
    });
    setBusqueda(""); setResultados([]); inputRef.current?.focus();
  }

  function setCant(i: number, cantidad: number) {
    setCarrito((c) => c.map((l, k) => (k === i ? { ...l, cantidad: Math.max(0, cantidad) } : l)).filter((l) => l.cantidad > 0));
  }

  // Al escanear/enter: si hay un único resultado, lo agrega directo.
  function onEnter(e: React.KeyboardEvent) {
    if (e.key === "Enter" && resultados.length > 0) { e.preventDefault(); agregar(resultados[0]); }
  }

  const subtotal = carrito.reduce((s, l) => s + l.cantidad * l.precioUnit, 0);
  const impuesto = carrito.reduce((s, l) => s + (l.cantidad * l.precioUnit * l.impuestoPct) / 100, 0);
  const total = subtotal + impuesto;

  async function cobrar() {
    setError(""); setMsg("");
    if (carrito.length === 0) return;
    try {
      await api.post("/pos/ventas", { negocioId: negocio.id, metodoPago, lineas: carrito });
      setMsg(`Venta registrada: ${money(total)}`);
      setCarrito([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Error al cobrar");
    }
  }

  return (
    <div>
      <input ref={inputRef} placeholder="Escanea o busca un producto (nombre o código)…" value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)} onKeyDown={onEnter} autoFocus />
      {resultados.length > 0 && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
          {resultados.map((p) => (
            <div className="list-item" key={p.id} style={{ cursor: "pointer" }} onClick={() => agregar(p)}>
              <div><strong>{p.nombre}</strong> <span className="muted small">{p.sku ?? ""}</span><br /><span className="muted small">Stock: {num(p.stock)} {p.unidad}</span></div>
              <strong>{money(p.precioVenta)}</strong>
            </div>
          ))}
        </div>
      )}

      {carrito.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>Carrito vacío. Escanea o busca productos para agregarlos.</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {carrito.map((l, i) => (
            <div className="list-item" key={i}>
              <div style={{ flex: 1 }}>
                <strong>{l.nombre}</strong><br /><span className="muted small">{money(l.precioUnit)} c/u{l.impuestoPct > 0 ? ` · ITBIS ${l.impuestoPct}%` : ""}</span>
              </div>
              <input type="number" min="0" step="1" value={l.cantidad} onChange={(e) => setCant(i, Number(e.target.value))} style={{ width: 70 }} />
              <strong style={{ minWidth: 80, textAlign: "right" }}>{money(l.cantidad * l.precioUnit)}</strong>
            </div>
          ))}
          <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
            <div className="row spread"><span className="muted small">Subtotal</span><span>{money(subtotal)}</span></div>
            {impuesto > 0 && <div className="row spread"><span className="muted small">Impuesto</span><span>{money(impuesto)}</span></div>}
            <div className="row spread" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}><span>Total</span><span className="grad-text">{money(total)}</span></div>
            <label style={{ marginTop: 10 }}>Método de pago</label>
            <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia</option>
              <option value="otro">Otro</option>
            </select>
            <button className="primary" style={{ width: "100%", marginTop: 12 }} onClick={cobrar}>Cobrar {money(total)}</button>
          </div>
        </div>
      )}
      {msg && <p className="success" style={{ marginTop: 8 }}>{msg}</p>}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

// ---------- PRODUCTOS (Inventario) ----------
function Productos({ negocio }: { negocio: Negocio }) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ nombre: "", sku: "", precioVenta: "", impuestoPct: "0", stock: "0", unidad: "UND", stockMinimo: "0" });
  const [error, setError] = useState("");

  function cargar() { api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}`).then((r) => setProductos(r.productos)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/inventario", { ...f, negocioId: negocio.id }); setF({ nombre: "", sku: "", precioVenta: "", impuestoPct: "0", stock: "0", unidad: "UND", stockMinimo: "0" }); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }

  async function ajustar(p: Producto, tipo: "entrada" | "salida") {
    const v = prompt(`${tipo === "entrada" ? "Entrada" : "Salida"} de stock para "${p.nombre}" (cantidad):`);
    if (!v) return;
    await api.post(`/inventario/${p.id}/stock`, { tipo, cantidad: Number(v), motivo: tipo });
    cargar();
  }

  return (
    <div>
      <div className="row spread">
        <span className="muted small">{productos.length} productos</span>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? "Cerrar" : "+ Producto"}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <label>Nombre</label>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required />
          <label>Código de barras / SKU (opcional)</label>
          <input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
          <div className="grid grid-2">
            <div><label>Precio de venta</label><input type="number" step="0.01" min="0" value={f.precioVenta} onChange={(e) => setF({ ...f, precioVenta: e.target.value })} required /></div>
            <div><label>Impuesto %</label><input type="number" step="0.01" min="0" value={f.impuestoPct} onChange={(e) => setF({ ...f, impuestoPct: e.target.value })} /></div>
            <div><label>Stock inicial</label><input type="number" step="0.001" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></div>
            <div><label>Stock mínimo</label><input type="number" step="0.001" min="0" value={f.stockMinimo} onChange={(e) => setF({ ...f, stockMinimo: e.target.value })} /></div>
          </div>
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>Guardar producto</button>
        </form>
      )}
      {productos.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>Sin productos todavía.</p>
      ) : (
        productos.map((p) => {
          const bajo = num(p.stock) <= num(p.stockMinimo);
          return (
            <div className="list-item" key={p.id}>
              <div>
                <strong>{p.nombre}</strong> <span className="muted small">{p.sku ?? ""}</span><br />
                <span className={`badge ${bajo ? "err" : "ok"}`}>Stock: {num(p.stock)} {p.unidad}</span> <span className="muted small">· {money(p.precioVenta)}</span>
              </div>
              <div className="row">
                <button className="ghost small" onClick={() => ajustar(p, "entrada")}>+ Entrada</button>
                <button className="ghost small" onClick={() => ajustar(p, "salida")}>− Salida</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------- CAJA ----------
function Caja({ negocio }: { negocio: Negocio }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [resumen, setResumen] = useState<{ conteo: number; total: number; porMetodo: Record<string, number> } | null>(null);
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<{ sesion: Sesion | null }>(`/pos/caja/actual?negocioId=${negocio.id}`).then((r) => setSesion(r.sesion)).catch(() => {});
    api.get<{ ventas: Venta[]; resumen: { conteo: number; total: number; porMetodo: Record<string, number> } }>(`/pos/ventas?negocioId=${negocio.id}`)
      .then((r) => { setVentas(r.ventas); setResumen(r.resumen); }).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  async function abrir() { await api.post("/pos/caja/abrir", { negocioId: negocio.id, montoInicial: monto || 0 }); setMonto(""); setMsg("Caja abierta."); cargar(); }
  async function cerrar() {
    const r = await api.post<{ esperado: number; descuadre: number }>("/pos/caja/cerrar", { negocioId: negocio.id, montoFinal: monto || 0 });
    setMsg(`Caja cerrada. Esperado: ${money(r.esperado)} · Descuadre: ${money(r.descuadre)}`); setMonto(""); cargar();
  }

  return (
    <div>
      {resumen && (
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <div className="row spread"><strong>Ventas de hoy</strong><span className="grad-text" style={{ fontWeight: 800 }}>{money(resumen.total)}</span></div>
          <span className="muted small">{resumen.conteo} ventas · {Object.entries(resumen.porMetodo).map(([m, t]) => `${m}: ${money(t)}`).join(" · ") || "—"}</span>
        </div>
      )}
      <div className="card" style={{ marginTop: 10 }}>
        {sesion ? (
          <>
            <p className="small">🟢 Caja <strong>abierta</strong> desde {new Date(sesion.abiertaEn).toLocaleString()} · inicial {money(sesion.montoInicial)}</p>
            <label>Monto final contado (cierre)</label>
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button className="primary" style={{ marginTop: 10 }} onClick={cerrar}>Cerrar caja</button>
          </>
        ) : (
          <>
            <p className="small">🔴 No hay caja abierta.</p>
            <label>Monto inicial (fondo)</label>
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button className="primary" style={{ marginTop: 10 }} onClick={abrir}>Abrir caja</button>
          </>
        )}
        {msg && <p className="success small" style={{ marginTop: 8 }}>{msg}</p>}
      </div>
      {ventas.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <strong className="small">Últimas ventas</strong>
          {ventas.slice(0, 10).map((v) => (
            <div className="list-item" key={v.id}><span className="muted small">{new Date(v.createdAt).toLocaleTimeString()} · {v.metodoPago}</span><strong>{money(v.total)}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}
