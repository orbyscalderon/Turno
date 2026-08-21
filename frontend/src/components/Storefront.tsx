import { useEffect, useState } from "react";
import { api, ApiError, assetUrl } from "../api";

// Tienda online PÚBLICA de un negocio, con checkout por WhatsApp. Ruta: /tienda/:slug
interface ProductoTienda { id: string; nombre: string; precioVenta: string | number; categoria: string | null; sku: string | null; unidad: string; stock: string | number }
interface NegocioTienda { id: string; nombreComercial: string; telefonoContacto: string; logoUrl: string | null; coverUrl: string | null; direccion: string; categoria: string | null }
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function Storefront({ slug }: { slug: string }) {
  const [negocio, setNegocio] = useState<NegocioTienda | null>(null);
  const [productos, setProductos] = useState<ProductoTienda[]>([]);
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api.get<{ negocio: NegocioTienda; productos: ProductoTienda[] }>(`/storefront/${slug}`)
      .then((r) => { setNegocio(r.negocio); setProductos(r.productos); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Tienda no disponible"))
      .finally(() => setCargando(false));
  }, [slug]);

  function add(id: string, delta: number) {
    setCarrito((c) => { const n = Math.max(0, (c[id] ?? 0) + delta); const cp = { ...c }; if (n === 0) delete cp[id]; else cp[id] = n; return cp; });
  }

  const items = productos.filter((p) => carrito[p.id]);
  const total = items.reduce((s, p) => s + carrito[p.id] * Number(p.precioVenta), 0);

  function pedirPorWhatsApp() {
    if (!negocio || items.length === 0) return;
    const tel = negocio.telefonoContacto.replace(/\D/g, "");
    const lineas = items.map((p) => `• ${carrito[p.id]}× ${p.nombre} — ${money(carrito[p.id] * Number(p.precioVenta))}`).join("\n");
    const texto = `Hola ${negocio.nombreComercial}, quiero pedir:\n${lineas}\n\nTotal: ${money(total)}`;
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, "_blank");
  }

  if (cargando) return <div className="container"><p className="muted">Cargando tienda…</p></div>;
  if (error || !negocio) return <div className="container"><div className="card"><h2>Tienda no disponible</h2><p className="muted">{error}</p></div></div>;

  const cover = assetUrl(negocio.coverUrl ?? negocio.logoUrl);

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <div style={{ height: 140, background: cover ? `center/cover no-repeat url(${cover})` : "linear-gradient(135deg,#2f7bff,#12131a)" }} />
        <div style={{ padding: 18 }}>
          <h1 style={{ margin: 0 }}>{negocio.nombreComercial}</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>📍 {negocio.direccion}</p>
        </div>
      </div>

      {productos.length === 0 ? (
        <div className="card"><p className="muted">Esta tienda aún no tiene productos publicados.</p></div>
      ) : (
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          {productos.map((p) => (
            <div className="card" key={p.id} style={{ margin: 0 }}>
              <div className="row spread">
                <div><strong>{p.nombre}</strong><br /><span className="muted small">{p.categoria ?? ""}</span></div>
                <strong className="grad-text">{money(p.precioVenta)}</strong>
              </div>
              <div className="row spread" style={{ marginTop: 8, alignItems: "center" }}>
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <button className="ghost small" onClick={() => add(p.id, -1)}>−</button>
                  <strong>{carrito[p.id] ?? 0}</strong>
                  <button className="ghost small" onClick={() => add(p.id, 1)}>+</button>
                </div>
                <span className="muted small">Stock: {Number(p.stock)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="card pop" style={{ position: "sticky", bottom: 12, marginTop: 16, borderColor: "var(--brand-600)" }}>
          <div className="row spread" style={{ fontSize: 18, fontWeight: 800 }}><span>Total ({items.length})</span><span className="grad-text">{money(total)}</span></div>
          <button className="whatsapp" style={{ width: "100%", marginTop: 10 }} onClick={pedirPorWhatsApp}>Pedir por WhatsApp</button>
        </div>
      )}
    </div>
  );
}
