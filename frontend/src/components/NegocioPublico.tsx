import { useEffect, useState } from "react";
import {
  api,
  assetUrl,
  formatPrecio,
  categoriaLabel,
  categoriaEmoji,
  categoriaGrad,
  mapsUrl,
  type Negocio,
  type Peluquero,
  type Servicio,
} from "../api";
import { useT } from "../i18n";
import { Stars } from "./Stars";
import { Empty, SkeletonCards } from "./Ui";
import { navegar } from "../router";

interface Resena {
  id: number;
  puntuacion: number;
  comentario: string | null;
  createdAt: string;
  cliente: { nombre: string };
}

/**
 * Ficha pública del negocio en /negocio/:slug.
 *
 * Antes no existía ninguna URL propia por negocio: el marketplace vivía entero
 * dentro del estado de React, así que no había enlace que compartir por WhatsApp
 * ni página que pudiera indexar un buscador — justo el canal de captación natural
 * de este producto.
 */
export function NegocioPublico({ slug, onReservar }: { slug: string; onReservar: () => void }) {
  const { t } = useT();
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [profesionales, setProfesionales] = useState<Peluquero[]>([]);
  const [servicios, setServicios] = useState<Record<number, Servicio[]>>({});
  const [resenas, setResenas] = useState<Resena[]>([]);
  const [cargando, setCargando] = useState(true);
  const [noExiste, setNoExiste] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setNoExiste(false);
    (async () => {
      try {
        const r = await api.get<{ negocio: Negocio; profesionales: Peluquero[] }>(
          `/negocios/${encodeURIComponent(slug)}`,
        );
        if (!vivo) return;
        setNegocio(r.negocio);
        setProfesionales(r.profesionales);

        // Catálogo de cada profesional (para mostrar precios reales en la ficha).
        const entradas = await Promise.all(
          r.profesionales.map(async (p) => {
            try {
              const s = await api.get<{ servicios: Servicio[] }>(`/servicios/peluquero/${p.id}`);
              return [p.id, s.servicios] as const;
            } catch {
              return [p.id, []] as const;
            }
          }),
        );
        if (!vivo) return;
        setServicios(Object.fromEntries(entradas));

        const res = await api.get<{ resenas: Resena[] }>(
          `/resenas/negocio/${r.negocio.id}?limit=10`,
        );
        if (vivo) setResenas(res.resenas);
      } catch {
        if (vivo) setNoExiste(true);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [slug]);

  // Título y descripción reales de la página: lo que ven Google y las vistas
  // previas de WhatsApp/Twitter al compartir el enlace.
  useEffect(() => {
    if (!negocio) return;
    const titulo = `${negocio.nombreComercial} — ${categoriaLabel(negocio.categoria)} | Turno`;
    document.title = titulo;
    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute(
      "content",
      `Reserva en ${negocio.nombreComercial} (${negocio.direccion}). Elige profesional y horario en segundos.`,
    );
    const og = document.querySelector('meta[property="og:title"]');
    og?.setAttribute("content", titulo);
    return () => {
      document.title = "Turno — Reserva belleza y bienestar cerca de ti";
    };
  }, [negocio]);

  async function compartir() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: negocio?.nombreComercial, url });
      else await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      /* el usuario canceló */
    }
  }

  if (cargando) {
    return (
      <div className="container">
        <SkeletonCards n={3} />
      </div>
    );
  }

  if (noExiste || !negocio) {
    return (
      <div className="container">
        <div className="card">
          <Empty emoji="🔍">{t("pub.notFound")}</Empty>
          <button className="ghost" onClick={() => navegar("/")}>
            {t("pub.backToSearch")}
          </button>
        </div>
      </div>
    );
  }

  const cover = assetUrl(negocio.coverUrl ?? negocio.logoUrl);

  return (
    <div className="container">
      <button className="ghost small" onClick={() => navegar("/")} style={{ marginBottom: 12 }}>
        {t("pub.backToSearch")}
      </button>

      <div className="card" style={{ overflow: "hidden", padding: 0 }}>
        <div
          className="biz-cover"
          style={{ background: categoriaGrad(negocio.categoria), height: 200 }}
        >
          {cover ? (
            <img src={cover} alt={negocio.nombreComercial} />
          ) : (
            <span style={{ fontSize: 56 }}>{categoriaEmoji(negocio.categoria)}</span>
          )}
        </div>
        <div style={{ padding: 16 }}>
          <div className="row spread">
            <h1 style={{ margin: 0 }}>{negocio.nombreComercial}</h1>
            <button className="ghost small" onClick={compartir}>
              {copiado ? t("pub.shared") : t("pub.share")}
            </button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <span className="badge">{categoriaLabel(negocio.categoria)}</span>
            {(negocio.ratingConteo ?? 0) > 0 && (
              <span className="row" style={{ gap: 4 }}>
                <Stars valor={negocio.ratingPromedio ?? 0} />
                <span className="small muted">
                  {negocio.ratingPromedio} ({negocio.ratingConteo})
                </span>
              </span>
            )}
            {negocio.timezone && <span className="small faint">{negocio.timezone}</span>}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            {negocio.direccion} ·{" "}
            <a href={mapsUrl(negocio)} target="_blank" rel="noreferrer">
              {t("mkt.viewMap")}
            </a>
            {negocio.telefonoContacto ? ` · ${negocio.telefonoContacto}` : ""}
          </p>
          <button className="primary" style={{ marginTop: 12 }} onClick={onReservar}>
            {t("pub.bookHere")}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>{t("pub.professionals")}</h2>
        {profesionales.length === 0 && <p className="muted small">{t("client.noSlots")}</p>}
        {profesionales.map((p) => (
          <div key={p.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
            <div className="row" style={{ gap: 10 }}>
              {assetUrl(p.fotoUrl) ? (
                <img
                  src={assetUrl(p.fotoUrl)}
                  alt={p.nombre}
                  style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: categoriaGrad(negocio.categoria),
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {p.nombre[0]}
                </div>
              )}
              <strong>{p.nombre}</strong>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {(servicios[p.id] ?? []).map((s) => (
                <span key={s.id} className="badge">
                  {s.nombreServicio} · {formatPrecio(s.precio, s.moneda)} · {s.duracionMinutos}′
                </span>
              ))}
              {(servicios[p.id] ?? []).length === 0 && <span className="small faint">—</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>{t("pub.reviews")}</h2>
        {resenas.length === 0 ? (
          <p className="muted small">{t("pub.noReviews")}</p>
        ) : (
          resenas.map((r) => (
            <div key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
              <div className="row" style={{ gap: 8 }}>
                <Stars valor={r.puntuacion} />
                <strong className="small">{r.cliente.nombre}</strong>
                <span className="faint small">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              {r.comentario && <p className="small">{r.comentario}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
