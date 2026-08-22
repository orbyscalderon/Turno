import { useEffect, useState } from "react";
import { api, type Perfil } from "../api";
import { rubroTema } from "../rubroTema";

// Página principal de la plataforma (multi-rubro). No es específica de belleza.
export function PlatformHome({ onNegocio, onReservar }: { onNegocio: () => void; onReservar: () => void }) {
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  useEffect(() => { api.get<{ perfiles: Perfil[] }>("/perfiles").then((r) => setPerfiles(r.perfiles)).catch(() => {}); }, []);

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="mkt-hero">
        <h1 className="grad-text">Gestiona cualquier negocio<br />en una sola plataforma</h1>
        <p className="sub">Punto de venta, inventario, reservas, préstamos, restaurante, granja y más. Eliges tu rubro y activamos solo lo que necesitas.</p>
      </div>

      {/* Dos caminos: negocio o reservar */}
      <div className="grid grid-2" style={{ marginTop: 4 }}>
        <div className="card" style={{ borderColor: "var(--brand-500)" }}>
          <h2 style={{ marginTop: 0 }}>🏪 Para tu negocio</h2>
          <p className="muted">Digitaliza tu operación: ventas, stock, caja, clientes, cobros y más — según tu rubro.</p>
          <button className="primary" style={{ marginTop: 8 }} onClick={onNegocio}>Ver soluciones</button>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>💇 Reservar un servicio</h2>
          <p className="muted">¿Buscas barbería, salón, spa o estética? Encuentra y reserva cerca de ti.</p>
          <button className="ghost" style={{ marginTop: 8 }} onClick={onReservar}>Explorar y reservar</button>
        </div>
      </div>

      {/* Verticales */}
      <h2 style={{ marginTop: 30 }}>Un sistema para cada rubro</h2>
      <div className="mkt-grid">
        {perfiles.map((p) => (
          <a className="biz-card" key={p.slug} href={`/para/${p.slug}`} style={{ textDecoration: "none" }}>
            <div className="biz-cover" style={{ background: rubroTema(p.slug).grad, display: "grid", placeItems: "center" }}>
              <span style={{ fontSize: 40 }}>{p.emoji}</span>
            </div>
            <div className="biz-body">
              <h3>{p.nombre}</h3>
              <div className="biz-meta">{p.descripcion}</div>
            </div>
          </a>
        ))}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="value-grid">
          <div className="value-card"><span className="v-emoji">⚡</span><h3>Listo en minutos</h3><p className="muted small">Crea tu negocio, elige el rubro y empieza a operar.</p></div>
          <div className="value-card"><span className="v-emoji">🔒</span><h3>Seguro y en la nube</h3><p className="muted small">Tus datos protegidos, accesibles desde cualquier dispositivo.</p></div>
          <div className="value-card"><span className="v-emoji">🧩</span><h3>Solo lo que necesitas</h3><p className="muted small">Activamos los módulos de tu rubro, sin pagar de más.</p></div>
        </div>
      </div>
    </div>
  );
}
