import { useEffect, useState } from "react";
import { api, ApiError, assetUrl, formatPrecio, categoriaLabel, categoriaEmoji, categoriaGrad, mapsUrl, CATEGORIAS, type Negocio, type Peluquero, type Servicio, type Slot, type Reserva } from "../api";
import { Stars } from "./Stars";
import { useT } from "../i18n";
import { Empty, SkeletonCards } from "./Ui";

type Tab = "reservar" | "historial";

export function ClienteView() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("reservar");
  return (
    <div className="container">
      <div className="tabs">
        <button className={`tab ${tab === "reservar" ? "active" : ""}`} onClick={() => setTab("reservar")}>
          {t("client.tabBook")}
        </button>
        <button className={`tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>
          {t("client.tabHistory")}
        </button>
      </div>
      {tab === "reservar" ? <FlujoReserva onReservado={() => setTab("historial")} /> : <Historial />}
    </div>
  );
}

function fechaHoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// Iniciales (máx 2) a partir de un nombre.
function iniciales(nombre: string): string {
  return nombre.split(" ").map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// Degradado azul/rojo estable según el nombre (para portadas sin foto).
const GRADS = [
  "linear-gradient(135deg,#2f7bff,#08090c)",
  "linear-gradient(135deg,#ff3b47,#12131a)",
  "linear-gradient(135deg,#1e63e6,#e11d2b)",
  "linear-gradient(135deg,#1550c0,#08090c)",
  "linear-gradient(135deg,#e11d2b,#191b22)",
];
function avatarGrad(nombre: string): string {
  const idx = Math.abs([...nombre].reduce((a, c) => a + c.charCodeAt(0), 0)) % GRADS.length;
  return GRADS[idx];
}

// Emoji para el servicio según su nombre (heurística) o la categoría del negocio.
function servicioEmoji(nombre: string, categoria?: string): string {
  const n = nombre.toLowerCase();
  if (/(barba|afeit)/.test(n)) return "🧔";
  if (/(corte|pelo|cabello)/.test(n)) return "💇";
  if (/(tinte|color)/.test(n)) return "🎨";
  if (/(uña|manicur|pedicur)/.test(n)) return "💅";
  if (/(facial|piel|limpieza)/.test(n)) return "💆";
  if (/(depila|cejas)/.test(n)) return "✨";
  if (/(masaj)/.test(n)) return "🧖";
  if (/(maquilla)/.test(n)) return "💄";
  const map: Record<string, string> = { barberia: "💈", peluqueria: "💇", estetica: "💆", unas: "💅", spa: "🧖", masajes: "🧖", tatuajes: "🖋️", depilacion: "✨", maquillaje: "💄" };
  return map[categoria ?? ""] ?? "✂️";
}

function FlujoReserva({ onReservado }: { onReservado: () => void }) {
  const { t } = useT();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [peluqueros, setPeluqueros] = useState<Peluquero[]>([]);
  const [peluquero, setPeluquero] = useState<Peluquero | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [servicio, setServicio] = useState<Servicio | null>(null);
  const [fecha, setFecha] = useState(fechaHoy());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [categoria, setCategoria] = useState<string>("");
  const [ubicacion, setUbicacion] = useState("");
  const [cargandoNeg, setCargandoNeg] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [montoFianza, setMontoFianza] = useState(2);

  // Monto real de la fianza (el cliente puede asumir el fee de Stripe según configuración).
  useEffect(() => { api.get<{ montoCobradoUsd: number }>("/reservas/split").then((s) => setMontoFianza(s.montoCobradoUsd)).catch(() => {}); }, []);

  // Pide la ubicación del navegador para ordenar por cercanía.
  function usarMiUbicacion() {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setUbicacion(""); setUbicando(false); },
      () => setUbicando(false),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  // Busca negocios con los filtros actuales (búsqueda + ubicación + categoría + cercanía).
  function buscarNegocios() {
    const params = new URLSearchParams();
    if (busqueda) params.set("q", busqueda);
    if (ubicacion) params.set("ubicacion", ubicacion);
    if (categoria) params.set("categoria", categoria);
    if (coords) { params.set("lat", String(coords.lat)); params.set("lng", String(coords.lng)); }
    const qs = params.toString();
    setCargandoNeg(true);
    return api
      .get<{ negocios: Negocio[] }>(`/negocios${qs ? `?${qs}` : ""}`)
      .then((r) => setNegocios(r.negocios))
      .catch(() => {})
      .finally(() => setCargandoNeg(false));
  }

  // Búsqueda reactiva (con debounce) al cambiar cualquier filtro.
  useEffect(() => {
    const t = setTimeout(buscarNegocios, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, ubicacion, categoria, coords]);

  async function elegirNegocio(n: Negocio) {
    setNegocio(n);
    setPeluquero(null); setServicio(null); setSlots([]); setSlot(null);
    const r = await api.get<{ peluqueros: Peluquero[] }>(`/negocios/${n.slug}`);
    setPeluqueros(r.peluqueros);
  }

  async function elegirPeluquero(p: Peluquero) {
    setPeluquero(p);
    setServicio(null); setSlots([]); setSlot(null);
    const r = await api.get<{ servicios: Servicio[] }>(`/servicios/peluquero/${p.id}`);
    setServicios(r.servicios);
  }

  async function cargarSlots(s: Servicio, f: string) {
    if (!peluquero) return;
    setSlot(null);
    try {
      const r = await api.get<{ slots: Slot[] }>(
        `/reservas/slots?peluqueroId=${peluquero.id}&servicioId=${s.id}&fecha=${f}`,
      );
      setSlots(r.slots);
    } catch {
      setSlots([]);
    }
  }

  function elegirServicio(s: Servicio) {
    setServicio(s);
    cargarSlots(s, fecha);
  }

  function cambiarFecha(f: string) {
    setFecha(f);
    if (servicio) cargarSlots(servicio, f);
  }

  async function reservar() {
    if (!peluquero || !servicio || !slot) return;
    setError("");
    setProcesando(true);
    try {
      // 1) Crear la reserva (queda pendiente de pago).
      const creada = await api.post<{ reserva: { id: number }; pago: { transaccionId: string } }>("/reservas", {
        peluqueroId: peluquero.id,
        servicioId: servicio.id,
        fecha,
        horaInicio: slot.inicio,
      });

      // 2) Confirmar el pago de la fianza (modo mock/dev): endpoint AUTENTICADO sobre la reserva propia.
      //    En producción con Stripe, el pago lo confirma el webhook real de la pasarela.
      await api.post(`/reservas/${creada.reserva.id}/pagar`, {});

      onReservado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo completar la reserva");
      // Recargar slots por si el horario fue tomado.
      if (servicio) cargarSlots(servicio, fecha);
    } finally {
      setProcesando(false);
    }
  }

  const paso = !negocio ? 1 : !peluquero ? 2 : !servicio ? 3 : !slot ? 4 : 5;

  return (
    <div>
      <div className="stepper">
        <span className={`step ${paso === 1 ? "active" : paso > 1 ? "done" : ""}`}>{t("step.business")}</span>
        <span className={`step ${paso === 2 ? "active" : paso > 2 ? "done" : ""}`}>{t("step.professional")}</span>
        <span className={`step ${paso === 3 ? "active" : paso > 3 ? "done" : ""}`}>{t("step.service")}</span>
        <span className={`step ${paso === 4 ? "active" : paso > 4 ? "done" : ""}`}>{t("step.time")}</span>
        <span className={`step ${paso === 5 ? "active" : ""}`}>{t("step.payment")}</span>
      </div>

      {/* Paso 1: marketplace (hero + categorías + tarjetas) */}
      {!negocio && (
        <div>
          {/* Hero de búsqueda multi-segmento (consistente con la landing pública) */}
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

          {/* Tarjetas de negocio con portada */}
          {cargandoNeg ? (
            <SkeletonCards n={4} />
          ) : negocios.length === 0 ? (
            <div className="card"><Empty emoji="🔍">{t("client.noBusinesses")}</Empty></div>
          ) : (
            <div className="mkt-grid">
              {negocios.map((n) => {
                const cover = assetUrl(n.coverUrl ?? n.logoUrl);
                return (
                  <div className="biz-card" key={n.id} onClick={() => elegirNegocio(n)}>
                    <div className="biz-cover" style={{ background: categoriaGrad(n.categoria) }}>
                      {cover ? <img src={cover} alt={n.nombreComercial} loading="lazy" decoding="async" /> : <span>{categoriaEmoji(n.categoria)}</span>}
                      {(n.ratingConteo ?? 0) > 0 && <span className="rating-pill">★ {n.ratingPromedio}</span>}
                    </div>
                    <div className="biz-body">
                      <h3>{n.nombreComercial}</h3>
                      <div className="biz-meta">
                        <span className="badge">{categoriaLabel(n.categoria)}</span>
                        {typeof n.distanciaKm === "number" && <span>📍 {n.distanciaKm} km</span>}
                      </div>
                      <div className="biz-meta">
                        {n.direccion} ·{" "}
                        <a href={mapsUrl(n)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{t("mkt.viewMap")}</a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sección de valor / confianza */}
          <div className="card" style={{ marginTop: 22 }}>
            <div className="value-grid">
              <div className="value-card"><span className="v-emoji">⚡</span><h3>{t("mkt.value1t")}</h3><p className="muted small">{t("mkt.value1d")}</p></div>
              <div className="value-card"><span className="v-emoji">🔒</span><h3>{t("mkt.value2t")}</h3><p className="muted small">{t("mkt.value2d")}</p></div>
              <div className="value-card"><span className="v-emoji">📲</span><h3>{t("mkt.value3t")}</h3><p className="muted small">{t("mkt.value3d")}</p></div>
            </div>
          </div>
        </div>
      )}

      {/* Paso 2: profesional (tarjetas con foto) */}
      {negocio && !peluquero && (
        <div>
          <div className="row spread" style={{ marginBottom: 12 }}>
            <h2>{negocio.nombreComercial} — {t("client.chooseProfessional")}</h2>
            <button className="ghost small" onClick={() => setNegocio(null)}>{t("common.change")}</button>
          </div>
          {peluqueros.length === 0 ? (
            <div className="card"><Empty emoji="🙍">{t("client.noProfessionals")}</Empty></div>
          ) : (
            <div className="mkt-grid">
              {peluqueros.map((p, i) => (
                <div className="biz-card" key={p.id} onClick={() => elegirPeluquero(p)}>
                  <div className="pro-cover" style={{ background: avatarGrad(p.nombre) }}>
                    {p.fotoUrl ? <img src={assetUrl(p.fotoUrl)} alt={p.nombre} /> : <span className="pro-initials">{iniciales(p.nombre)}</span>}
                  </div>
                  <div className="biz-body">
                    <h3>{p.nombre}</h3>
                    <div className="biz-meta">{t("role.peluquero")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Paso 3: servicio (tarjetas con portada) */}
      {peluquero && !servicio && (
        <div>
          <div className="row spread" style={{ marginBottom: 12 }}>
            <h2>{peluquero.nombre} — {t("client.chooseService")}</h2>
            <button className="ghost small" onClick={() => setPeluquero(null)}>{t("common.change")}</button>
          </div>
          {servicios.length === 0 ? (
            <div className="card"><Empty emoji="✂️">{t("client.noServices")}</Empty></div>
          ) : (
            <div className="mkt-grid">
              {servicios.map((s) => (
                <div className="biz-card" key={s.id} onClick={() => elegirServicio(s)}>
                  <div className="svc-cover" style={{ background: avatarGrad(s.nombreServicio) }}>
                    {s.imagenUrl ? <img src={assetUrl(s.imagenUrl)} alt={s.nombreServicio} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span className="svc-emoji">{servicioEmoji(s.nombreServicio, negocio?.categoria)}</span>}
                    <span className="svc-price">{formatPrecio(s.precio, s.moneda)}</span>
                  </div>
                  <div className="biz-body">
                    <h3>{s.nombreServicio}</h3>
                    <div className="biz-meta">⏱️ {s.duracionMinutos} {t("client.min")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Paso 4 y 5: fecha, slots y pago */}
      {servicio && (
        <div className="card">
          <div className="row spread">
            <h2>{servicio.nombreServicio} · {servicio.duracionMinutos} {t("client.min")}</h2>
            <button className="ghost small" onClick={() => { setServicio(null); setSlots([]); setSlot(null); }}>{t("common.change")}</button>
          </div>

          <label>{t("client.date")}</label>
          <input type="date" value={fecha} min={fechaHoy()} onChange={(e) => cambiarFecha(e.target.value)} />

          <label style={{ marginTop: 16 }}>{t("client.availableSlots")}</label>
          {slots.length === 0 ? (
            <p className="muted small">{t("client.noSlots")}</p>
          ) : (
            <div className="grid grid-slots">
              {slots.map((s) => (
                <button
                  key={s.inicio}
                  className={`slot ${slot?.inicio === s.inicio ? "selected" : ""}`}
                  onClick={() => setSlot(s)}
                >
                  {s.inicio}
                </button>
              ))}
            </div>
          )}

          {slot && (
            <div className="card pop" style={{ background: "linear-gradient(180deg, var(--surface-2), var(--surface-3))", marginTop: 16, borderColor: "var(--brand-600)" }}>
              <h3>{t("client.summary")}</h3>
              <p className="small">
                {servicio.nombreServicio} {t("client.with")} {peluquero?.nombre}<br />
                {fecha} · {slot.inicio}–{slot.fin}
              </p>
              <div className="row spread">
                <span className="muted small">{t("client.deposit")}</span>
                <strong>${montoFianza.toFixed(2)} USD</strong>
              </div>
              {error && <p className="error">{error}</p>}
              <button className="primary" style={{ width: "100%", marginTop: 12 }} disabled={procesando} onClick={reservar}>
                {procesando ? t("client.processing") : `${t("client.payAndBook")} · $${montoFianza.toFixed(2)}`}
              </button>
              <p className="muted small" style={{ marginTop: 8 }}>
                {t("client.depositNote")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Historial() {
  const { t } = useT();
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [cargando, setCargando] = useState(true);

  function cargar() {
    api.get<{ reservas: Reserva[] }>("/reservas/mias").then((r) => setReservas(r.reservas)).finally(() => setCargando(false));
  }
  useEffect(cargar, []);

  const [aviso, setAviso] = useState("");
  const [reprogramando, setReprogramando] = useState<number | null>(null);

  async function cancelar(id: number) {
    const r = await api.patch<{ reembolsado: boolean; politica?: string }>(`/reservas/${id}/cancelar`);
    setAviso(r.politica ?? (r.reembolsado ? "OK" : "OK"));
    cargar();
  }

  if (cargando) return <SkeletonCards n={3} />;
  if (reservas.length === 0) return <div className="card"><Empty emoji="📭">{t("history.empty")}</Empty></div>;

  return (
    <div>
      {aviso && <p className="success">{aviso}</p>}
      {reservas.map((r) => (
        <div className="card" key={r.id}>
          <div className="row spread">
            <h3>{r.servicio} {t("client.with")} {r.peluquero}</h3>
            <EstadoBadge estado={r.estadoCita} />
          </div>
          <p className="small muted">{r.fecha} · {r.horaInicio}–{r.horaFin} · {formatPrecio(r.precio, r.moneda)}</p>
          <p className="small">{t("history.validationCode")}: <strong>{r.codigoValidacion}</strong> ·{" "}
            <span className={`badge ${r.pagoReservaStatus === "pagado" ? "ok" : "warn"}`}>{r.pagoReservaStatus}</span>
          </p>
          <div className="row">
            {r.whatsappUrl && (
              <a href={r.whatsappUrl} target="_blank" rel="noreferrer">
                <button className="whatsapp">{t("history.whatsapp")}</button>
              </a>
            )}
            {r.estadoCita === "confirmada" && (
              <>
                <button className="ghost" onClick={() => setReprogramando(reprogramando === r.id ? null : r.id)}>{t("history.reschedule")}</button>
                <button className="ghost" onClick={() => cancelar(r.id)}>{t("common.cancel")}</button>
              </>
            )}
            {r.estadoCita === "completada" && <ResenaInline reservaId={r.id} onHecho={cargar} />}
          </div>
          {reprogramando === r.id && (
            <Reprogramar reserva={r} onHecho={() => { setReprogramando(null); cargar(); }} />
          )}
        </div>
      ))}
    </div>
  );
}

// Formulario en línea para reprogramar (elige nueva fecha y slot libre).
function Reprogramar({ reserva, onHecho }: { reserva: Reserva; onHecho: () => void }) {
  const { t } = useT();
  const [fecha, setFecha] = useState(reserva.fecha);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState("");

  // Nota: reusa el endpoint de slots del profesional/servicio de la reserva.
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    api.get<{ slots: Slot[] }>(`/reservas/slots?peluqueroId=${reserva.peluqueroId}&servicioId=${reserva.servicioId}&fecha=${fecha}`)
      .then((r) => setSlots(r.slots)).catch(() => setSlots([]));
  }, [fecha]);

  async function elegir(slot: Slot) {
    setError("");
    try {
      await api.patch(`/reservas/${reserva.id}/reprogramar`, { fecha, horaInicio: slot.inicio });
      onHecho();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error");
    }
  }

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 10 }}>
      <label>{t("history.newDate")}</label>
      <input type="date" value={fecha} min={fechaHoy()} onChange={(e) => setFecha(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <div className="grid grid-slots" style={{ marginTop: 8 }}>
        {slots.length === 0 && <span className="muted small">{t("client.noSlots")}</span>}
        {slots.map((s) => (
          <button key={s.inicio} className="slot" onClick={() => elegir(s)}>{s.inicio}</button>
        ))}
      </div>
    </div>
  );
}

// Reseña en línea para una cita completada.
function ResenaInline({ reservaId, onHecho }: { reservaId: number; onHecho: () => void }) {
  const { t } = useT();
  const [puntuacion, setPuntuacion] = useState(5);
  const [comentario, setComentario] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");

  async function enviar() {
    setError("");
    try {
      await api.post("/resenas", { reservacionId: reservaId, puntuacion, comentario: comentario || undefined });
      onHecho();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error"));
    }
  }

  if (!abierto) return <button className="ghost" onClick={() => setAbierto(true)}>{t("history.review")}</button>;
  return (
    <div className="card" style={{ background: "var(--surface-2)", width: "100%", marginTop: 8 }}>
      <Stars valor={puntuacion} onChange={setPuntuacion} />
      <textarea
        placeholder={t("history.reviewComment")}
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        style={{ width: "100%", marginTop: 8, minHeight: 60 }}
      />
      {error && <p className="error">{error}</p>}
      <button className="primary" style={{ marginTop: 8 }} onClick={enviar}>{t("history.sendReview")}</button>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const cls = estado === "confirmada" || estado === "completada" ? "ok" : estado === "cancelada" ? "err" : "warn";
  return <span className={`badge ${cls}`}>{estado}</span>;
}

// Colores estables derivados del nombre para el avatar de respaldo.
const AVATAR_COLORS = ["#4f8cff", "#25d366", "#f5b942", "#ff5c6c", "#a978ff", "#2ec5c5", "#ff8a4c"];

function Avatar({ nombre, fotoUrl }: { nombre: string; fotoUrl?: string | null }) {
  const iniciales = nombre
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const idx = Math.abs([...nombre].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length;

  if (fotoUrl) {
    return <img className="avatar" src={assetUrl(fotoUrl)} alt={nombre} />;
  }
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[idx] }}>
      {iniciales}
    </span>
  );
}
