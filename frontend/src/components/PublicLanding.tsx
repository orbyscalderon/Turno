import { useEffect, useState } from "react";
import {
  api, assetUrl, formatPrecio, categoriaLabel, categoriaEmoji, categoriaGrad, mapsUrl, CATEGORIAS,
  type Negocio, type Peluquero, type Servicio,
} from "../api";
import { useT } from "../i18n";
import { Empty, SkeletonCards } from "./Ui";
import { Stars } from "./Stars";

// Pantalla pública (estilo Fresha): cualquiera navega los negocios sin login.
// Al querer reservar, se pide iniciar sesión (onReservar).
export function PublicLanding({ onReservar }: { onReservar: () => void }) {
  const { t } = useT();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [categoria, setCategoria] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState<Negocio | null>(null);
  const [favs, setFavs] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("turno_favs") ?? "[]")));
  const [stats, setStats] = useState<{ negocios: number; profesionales: number; reservas: number } | null>(null);

  // Estadísticas reales para la prueba social (no un número inventado).
  useEffect(() => {
    api.get<{ negocios: number; profesionales: number; reservas: number }>("/stats").then(setStats).catch(() => {});
  }, []);

  function toggleFav(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("turno_favs", JSON.stringify([...next]));
      return next;
    });
  }

  function usarMiUbicacion() {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setUbicacion(""); setUbicando(false); },
      () => setUbicando(false),
    );
  }

  // Busca negocios con los filtros actuales.
  function buscarNegocios() {
    const params = new URLSearchParams();
    if (busqueda) params.set("q", busqueda);
    if (ubicacion) params.set("ubicacion", ubicacion);
    if (categoria) params.set("categoria", categoria);
    if (coords) { params.set("lat", String(coords.lat)); params.set("lng", String(coords.lng)); }
    const qs = params.toString();
    setCargando(true);
    return api.get<{ negocios: Negocio[] }>(`/negocios${qs ? `?${qs}` : ""}`)
      .then((r) => setNegocios(r.negocios))
      .catch(() => {})
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    const to = setTimeout(buscarNegocios, 250);
    return () => clearTimeout(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, ubicacion, categoria, coords]);

  if (sel) return <DetalleNegocio negocio={sel} onBack={() => setSel(null)} onReservar={onReservar} />;

  return (
    <div className="container">
      {/* Hero centrado con buscador multi-segmento (estilo Fresha) */}
      <div className="mkt-hero">
        <h1>{t("mkt.heroTitle")}</h1>
        <p className="sub">{t("mkt.heroSub")}</p>

        <div className="mkt-search">
          <div className="mkt-seg">
            <span className="seg-ico">🔍</span>
            <input placeholder={t("mkt.segTreatment")} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
          <div className="mkt-seg">
            <button className="seg-ico" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: coords ? "var(--brand-400)" : undefined }}
              onClick={usarMiUbicacion} disabled={ubicando} title={t("mkt.useLocation")} aria-label={t("mkt.useLocation")}>📍</button>
            <input
              placeholder={ubicando ? t("mkt.locating") : coords ? t("mkt.near") : t("mkt.segLocation")}
              value={ubicacion}
              onChange={(e) => { setUbicacion(e.target.value); if (coords) setCoords(null); }}
            />
          </div>
          <div className="mkt-seg">
            <span className="seg-ico">📅</span>
            <span className="seg-btn placeholder">{t("mkt.segWhen")}</span>
          </div>
          <button className="primary go" onClick={() => buscarNegocios()}>{t("mkt.search")}</button>
        </div>

        {stats && (
          <div className="hero-count">
            <b>{stats.negocios}</b> {t("mkt.statBusinesses")} · <b>{stats.profesionales}</b> {t("mkt.statPros")} · <b>{stats.reservas}</b> {t("mkt.statBookings")}
          </div>
        )}

        <div className="mkt-trust">
          <span>⭐ {t("mkt.trust1")}</span>
          <span>🔒 {t("mkt.trust2")}</span>
          <span>💬 {t("mkt.trust3")}</span>
          {coords && <span className="badge ok">{t("mkt.sortedByDistance")}</span>}
        </div>
      </div>

      {/* Categorías */}
      <div className="cat-scroll">
        <div className={`cat-chip ${categoria === "" ? "on" : ""}`} onClick={() => setCategoria("")}>
          <span className="cat-emoji">🗂️</span>
          <span className="cat-name">{t("mkt.all")}</span>
        </div>
        {CATEGORIAS.filter((c) => c.value !== "otro").map((c) => (
          <div key={c.value} className={`cat-chip ${categoria === c.value ? "on" : ""}`} onClick={() => setCategoria(categoria === c.value ? "" : c.value)}>
            <span className="cat-emoji">{categoriaEmoji(c.value)}</span>
            <span className="cat-name">{c.label}</span>
          </div>
        ))}
      </div>

      <h2 style={{ marginBottom: 14 }}>{t("mkt.recommended")}</h2>

      {/* Grid de negocios */}
      {cargando ? (
        <SkeletonCards n={6} />
      ) : negocios.length === 0 ? (
        <div className="card"><Empty emoji="🔍">{t("client.noBusinesses")}</Empty></div>
      ) : (
        <div className="mkt-grid">
          {negocios.map((n) => {
            const cover = assetUrl(n.coverUrl ?? n.logoUrl);
            const destacado = (n.ratingPromedio ?? 0) >= 4.5;
            return (
              <div className="biz-card" key={n.id} onClick={() => setSel(n)}>
                <div className="biz-cover" style={{ background: categoriaGrad(n.categoria) }}>
                  {cover ? <img src={cover} alt={n.nombreComercial} loading="lazy" decoding="async" /> : <span>{categoriaEmoji(n.categoria)}</span>}
                  {destacado && <span className="biz-featured">{t("mkt.featured")}</span>}
                  <button className={`biz-fav ${favs.has(n.id) ? "on" : ""}`} onClick={(e) => toggleFav(n.id, e)} aria-label="favorito">
                    {favs.has(n.id) ? "♥" : "♡"}
                  </button>
                </div>
                <div className="biz-body">
                  <div className="row spread">
                    <h3>{n.nombreComercial}</h3>
                    {(n.ratingConteo ?? 0) > 0 && <span className="small" style={{ color: "#ffd76a", fontWeight: 700 }}>★ {n.ratingPromedio}</span>}
                  </div>
                  <div className="biz-meta">
                    <span className="badge">{categoriaLabel(n.categoria)}</span>
                    {typeof n.distanciaKm === "number" && <span>📍 {n.distanciaKm} km</span>}
                  </div>
                  <div className="biz-meta">{n.direccion}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sección de valor */}
      <div className="card" style={{ marginTop: 22 }}>
        <div className="value-grid">
          <div className="value-card"><span className="v-emoji">⚡</span><h3>{t("mkt.value1t")}</h3><p className="muted small">{t("mkt.value1d")}</p></div>
          <div className="value-card"><span className="v-emoji">🔒</span><h3>{t("mkt.value2t")}</h3><p className="muted small">{t("mkt.value2d")}</p></div>
          <div className="value-card"><span className="v-emoji">📲</span><h3>{t("mkt.value3t")}</h3><p className="muted small">{t("mkt.value3d")}</p></div>
        </div>
      </div>
    </div>
  );
}

// Ficha pública del negocio: portada, info, profesionales y sus servicios. Reservar => login.
function DetalleNegocio({ negocio, onBack, onReservar }: { negocio: Negocio; onBack: () => void; onReservar: () => void }) {
  const { t } = useT();
  const [profesionales, setProfesionales] = useState<Peluquero[]>([]);
  const [sel, setSel] = useState<Peluquero | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [resenas, setResenas] = useState<{ id: number; puntuacion: number; comentario: string | null; createdAt: string; cliente: { nombre: string } }[]>([]);

  useEffect(() => {
    api.get<{ profesionales: Peluquero[] }>(`/negocios/${negocio.slug}`).then((r) => setProfesionales(r.profesionales));
    api.get<{ resenas: typeof resenas }>(`/resenas/negocio/${negocio.id}`).then((r) => setResenas(r.resenas)).catch(() => {});
  }, [negocio.slug]);

  async function verPro(p: Peluquero) {
    setSel(p);
    const r = await api.get<{ servicios: Servicio[] }>(`/servicios/peluquero/${p.id}`);
    setServicios(r.servicios);
  }

  const cover = assetUrl(negocio.coverUrl ?? negocio.logoUrl);

  return (
    <div className="container">
      <p><button className="ghost small" onClick={onBack}>{t("common.back")}</button></p>

      {/* Portada + info */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="biz-cover" style={{ height: 200, background: categoriaGrad(negocio.categoria) }}>
          {cover ? <img src={cover} alt={negocio.nombreComercial} /> : <span style={{ fontSize: 64 }}>{categoriaEmoji(negocio.categoria)}</span>}
          {(negocio.ratingConteo ?? 0) > 0 && <span className="rating-pill">★ {negocio.ratingPromedio} ({negocio.ratingConteo})</span>}
        </div>
        <div style={{ padding: 20 }}>
          <div className="row spread">
            <h1 style={{ margin: 0 }}>{negocio.nombreComercial}</h1>
            <span className="badge">{categoriaLabel(negocio.categoria)}</span>
          </div>
          {(negocio.ratingConteo ?? 0) > 0 && (
            <div style={{ marginTop: 6 }}><Stars valor={negocio.ratingPromedio ?? 0} size={16} /> <span className="muted small">{negocio.ratingPromedio}</span></div>
          )}
          <p className="muted small" style={{ marginTop: 8 }}>
            📍 {negocio.direccion} · <a href={mapsUrl(negocio)} target="_blank" rel="noreferrer">{t("mkt.viewMap")}</a>
          </p>
          <button className="primary" style={{ marginTop: 6 }} onClick={onReservar}>{t("pub.bookCta")}</button>
        </div>
      </div>

      {/* Profesionales */}
      <div className="card">
        <h2>{t("pub.team")}</h2>
        {profesionales.length === 0 && <Empty emoji="🙍">{t("client.noProfessionals")}</Empty>}
        <div className="mkt-grid">
          {profesionales.map((p) => (
            <div className={`biz-card ${sel?.id === p.id ? "" : ""}`} key={p.id} onClick={() => verPro(p)}>
              <div className="pro-cover" style={{ background: categoriaGrad(negocio.categoria) }}>
                {p.fotoUrl ? <img src={assetUrl(p.fotoUrl)} alt={p.nombre} /> : <span className="pro-initials">{p.nombre.split(" ").map((s) => s[0]).slice(0, 2).join("")}</span>}
              </div>
              <div className="biz-body"><h3>{p.nombre}</h3><div className="biz-meta">{t("role.peluquero")}</div></div>
            </div>
          ))}
        </div>
      </div>

      {/* Servicios del profesional elegido */}
      {sel && (
        <div className="card">
          <h2>{sel.nombre} — {t("pub.services")}</h2>
          {servicios.map((s) => (
            <div className="list-item" key={s.id}>
              <div className="row" style={{ gap: 12 }}>
                {s.imagenUrl
                  ? <img src={assetUrl(s.imagenUrl)} alt={s.nombreServicio} style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 10 }} />
                  : <span style={{ width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "var(--surface-2)" }}>✂️</span>}
                <div><h3>{s.nombreServicio}</h3><span className="muted small">⏱️ {s.duracionMinutos} min</span></div>
              </div>
              <div className="row">
                <strong>{formatPrecio(s.precio, s.moneda)}</strong>
                <button className="primary" onClick={onReservar}>{t("client.tabBook")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reseñas del negocio */}
      {resenas.length > 0 && (
        <div className="card">
          <h2>{t("pub.reviews")} ({resenas.length})</h2>
          {resenas.map((r) => (
            <div className="list-item" key={r.id} style={{ alignItems: "flex-start" }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <Stars valor={r.puntuacion} size={14} />
                  <strong className="small">{r.cliente.nombre}</strong>
                </div>
                {r.comentario && <p className="muted small" style={{ margin: "4px 0 0" }}>{r.comentario}</p>}
              </div>
              <span className="faint small">{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
