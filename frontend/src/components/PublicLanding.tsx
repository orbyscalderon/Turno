import { useEffect, useState } from "react";
import {
  api, assetUrl, categoriaLabel, categoriaEmoji, categoriaGrad, CATEGORIAS,
  type Negocio,
} from "../api";
import { useT } from "../i18n";
import { navegar } from "../router";
import { Empty, SkeletonCards } from "./Ui";

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
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      <div className="cat-scroll" tabIndex={0} role="group" aria-label={t("pub.categories")}>
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
              <div className="biz-card" key={n.id} onClick={() => navegar(`/negocio/${n.slug}`)}>
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
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="primary" onClick={onReservar}>{t("pub.bookCta")}</button>
        </div>
      </div>
    </div>
  );
}
