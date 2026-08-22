import { useEffect, useState } from "react";
import { api, ApiError, assetUrl, descargarCSV, type Negocio, type Perfil } from "../api";
import { useT } from "../i18n";
import { Stat } from "./Ui";
import { MapaUbicacion } from "./MapaUbicacion";
import { PrestamosView } from "./PrestamosView";
import { ComercioView } from "./ComercioView";
import { AgroView } from "./AgroView";
import { MesasView } from "./MesasView";
import { ServiceOrdersView } from "./ServiceOrdersView";
import { GastosView } from "./GastosView";
import { ClientesView } from "./ClientesView";
import { ComprasView } from "./ComprasView";
import { ImpuestosView } from "./ImpuestosView";

interface Miembro {
  id: number;
  estadoAprobacion: "pendiente" | "aceptado" | "rechazado";
  usuario: { id: number; nombre: string; email: string; telefono: string };
}

export function AdminView() {
  const { t } = useT();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [negocio, setNegocio] = useState<Negocio | null>(null);

  function cargar() {
    api.get<{ negocios: Negocio[] }>("/negocios/mios").then((r) => setNegocios(r.negocios));
  }
  useEffect(cargar, []);

  return (
    <div className="container">
      {!negocio ? (
        <>
          <CrearNegocio onCreado={cargar} />
          <div className="card">
            <h2>{t("own.selectBusiness")}</h2>
            <p className="muted small">{t("own.selectHelp")}</p>
            {negocios.map((n) => (
              <div className="list-item" key={n.id}>
                <div><h3>{n.nombreComercial}</h3><span className="muted small">{n.direccion}</span></div>
                <button className="primary" onClick={() => setNegocio(n)}>{t("own.manage")}</button>
              </div>
            ))}
            {negocios.length === 0 && <p className="muted small">{t("own.noBusinesses")}</p>}
          </div>
        </>
      ) : (
        <GestionEquipo negocio={negocio} onVolver={() => setNegocio(null)} />
      )}
    </div>
  );
}

function CrearNegocio({ onCreado }: { onCreado: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState({ nombreComercial: "", direccion: "", telefonoContacto: "" });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [ubicando, setUbicando] = useState(false);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [moduloLabels, setModuloLabels] = useState<Record<string, string>>({});
  const [disponibles, setDisponibles] = useState<string[]>([]);
  // Preselecciona el rubro si el usuario llegó desde una landing por rubro.
  const [perfilSel, setPerfilSel] = useState(() => {
    try { const p = localStorage.getItem("turno_perfil_preferido"); if (p) { localStorage.removeItem("turno_perfil_preferido"); return p; } } catch { /* ignore */ }
    return "";
  });

  // Catálogo de rubros (motor de nicho).
  useEffect(() => {
    api.get<{ perfiles: Perfil[]; moduloLabels: Record<string, string>; modulosDisponibles: string[] }>("/perfiles")
      .then((r) => { setPerfiles(r.perfiles); setModuloLabels(r.moduloLabels); setDisponibles(r.modulosDisponibles); })
      .catch(() => {});
  }, []);

  const perfilObj = perfiles.find((p) => p.slug === perfilSel);

  function usarUbicacion() {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setUbicando(false); },
      () => setUbicando(false),
    );
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!perfilSel) { setMsg(t("own.pickBusinessFirst")); return; }
    try {
      // El rubro elegido activa sus módulos; también sirve de categoría en el directorio.
      await api.post("/negocios", { ...form, perfil: perfilSel, categoria: perfilSel, ...(coords ?? {}) });
      setForm({ nombreComercial: "", direccion: "", telefonoContacto: "" });
      setPerfilSel(""); setCoords(null);
      setMsg(t("own.created"));
      onCreado();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="card">
      <h2>{t("own.createBusiness")}</h2>

      {/* Paso 1: elegir el rubro → activa sus módulos */}
      <label>{t("own.whatBusiness")}</label>
      <p className="muted small" style={{ margin: "0 0 10px" }}>{t("own.whatBusinessHelp")}</p>
      <div className="rubro-grid">
        {perfiles.map((p) => (
          <button
            type="button"
            key={p.slug}
            className={`rubro-card ${perfilSel === p.slug ? "on" : ""}`}
            onClick={() => setPerfilSel(p.slug)}
            title={p.descripcion}
          >
            <span className="rubro-emoji">{p.emoji}</span>
            <span className="rubro-name">{p.nombre}</span>
          </button>
        ))}
      </div>

      {perfilObj && (
        <div className="card pop" style={{ background: "var(--surface-2)", marginTop: 12, borderColor: "var(--brand-600)" }}>
          <p className="small muted" style={{ margin: "0 0 8px" }}>{perfilObj.descripcion}</p>
          <strong className="small">{t("own.modulesActivated")}</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {perfilObj.modulos.map((m) => {
              const ok = disponibles.includes(m);
              return (
                <span key={m} className={`badge ${ok ? "ok" : ""}`} title={ok ? t("own.available") : t("own.soon")}>
                  {ok ? "✓" : "🔜"} {moduloLabels[m] ?? m}
                </span>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: "8px 0 0" }}>✓ {t("own.available")} · 🔜 {t("own.soon")}</p>
        </div>
      )}

      {/* Paso 2: datos del negocio */}
      <form onSubmit={crear}>
        <label>{t("own.commercialName")}</label>
        <input value={form.nombreComercial} onChange={(e) => setForm({ ...form, nombreComercial: e.target.value })} required />
        <label>{t("own.address")}</label>
        <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} required />
        <label>{t("own.locationLabel")}</label>
        <MapaUbicacion lat={coords?.lat ?? null} lng={coords?.lng ?? null} onChange={(la, ln) => setCoords({ lat: la, lng: ln })} />
        <div className="row" style={{ marginTop: 6 }}>
          <button type="button" className="ghost small" onClick={usarUbicacion} disabled={ubicando}>
            📍 {ubicando ? t("own.locating") : t("own.useLocationOpt")}
          </button>
        </div>
        <label>{t("own.phone")}</label>
        <input value={form.telefonoContacto} onChange={(e) => setForm({ ...form, telefonoContacto: e.target.value })} required />
        <button className="primary" style={{ marginTop: 12 }} disabled={!perfilSel}>{t("own.create")}</button>
      </form>
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

// Tienda online: enlace público para compartir (módulo storefront).
function TiendaLink({ slug }: { slug: string }) {
  const url = `${window.location.origin}/tienda/${slug}`;
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="card">
      <h2>🛍️ Tienda online</h2>
      <p className="muted small">Comparte este enlace: tus clientes ven tu catálogo y te piden por WhatsApp.</p>
      <div className="row" style={{ marginTop: 8 }}>
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button className="ghost" onClick={() => { navigator.clipboard?.writeText(url); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}>{copiado ? "¡Copiado!" : "Copiar"}</button>
        <a href={url} target="_blank" rel="noreferrer"><button className="ghost">Abrir</button></a>
      </div>
    </div>
  );
}

function GestionEquipo({ negocio, onVolver }: { negocio: Negocio; onVolver: () => void }) {
  const { t } = useT();
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [activos, setActivos] = useState(0);
  const [limite, setLimite] = useState(5);
  const [error, setError] = useState("");
  // Módulos activos del negocio según su rubro (motor de nicho).
  const [modulos, setModulos] = useState<string[]>([]);
  useEffect(() => {
    if (!negocio.perfil) { setModulos([]); return; }
    api.get<{ perfiles: Perfil[] }>("/perfiles")
      .then((r) => setModulos(r.perfiles.find((p) => p.slug === negocio.perfil)?.modulos ?? []))
      .catch(() => {});
  }, [negocio.perfil]);

  function cargar() {
    api
      .get<{ miembros: Miembro[]; activos: number; limite: number }>(`/negocios/${negocio.id}/equipo`)
      .then((r) => { setMiembros(r.miembros); setActivos(r.activos); setLimite(r.limite); })
      .catch((e) => setError(e instanceof ApiError ? e.message : t("common.error")));
  }
  useEffect(cargar, [negocio.id]);

  async function decidir(solicitudId: number, decision: "aceptado" | "rechazado") {
    setError("");
    try {
      await api.patch(`/negocios/${negocio.id}/equipo/${solicitudId}`, { decision });
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  const pendientes = miembros.filter((m) => m.estadoAprobacion === "pendiente");
  const equipo = miembros.filter((m) => m.estadoAprobacion === "aceptado");

  return (
    <div>
      <div className="row spread">
        <h1>{negocio.nombreComercial}</h1>
        <button className="ghost" onClick={onVolver}>{t("common.back")}</button>
      </div>

      <div className="card">
        <div className="row spread">
          <h2>{t("own.activeTeam")}</h2>
          <span className={`badge ${activos >= limite ? "err" : "ok"}`}>{activos} / {limite} {t("own.professionals")}</span>
        </div>
        {error && <p className="error">{error}</p>}
        {equipo.map((m) => (
          <div className="list-item" key={m.id}>
            <div><h3>{m.usuario.nombre}</h3><span className="muted small">{m.usuario.email}</span></div>
            <button className="ghost" onClick={() => decidir(m.id, "rechazado")}>{t("own.remove")}</button>
          </div>
        ))}
        {equipo.length === 0 && <p className="muted small">{t("own.noActivePros")}</p>}
      </div>

      <div className="card">
        <h2>{t("own.pendingRequests")} ({pendientes.length})</h2>
        {pendientes.map((m) => (
          <div className="list-item" key={m.id}>
            <div><h3>{m.usuario.nombre}</h3><span className="muted small">{m.usuario.email} · {m.usuario.telefono}</span></div>
            <div className="row">
              <button className="primary" disabled={activos >= limite} onClick={() => decidir(m.id, "aceptado")}>{t("own.accept")}</button>
              <button className="ghost" onClick={() => decidir(m.id, "rechazado")}>{t("own.reject")}</button>
            </div>
          </div>
        ))}
        {pendientes.length === 0 && <p className="muted small">{t("own.noPending")}</p>}
        {activos >= limite && pendientes.length > 0 && <p className="error">{t("own.limitReached")}</p>}
      </div>

      {/* Módulos del motor de nicho, activados según el rubro */}
      {modulos.includes("lending") && <PrestamosView negocio={negocio} />}
      {modulos.includes("pos") && <ComercioView negocio={negocio} />}
      {modulos.includes("agro") && <AgroView negocio={negocio} />}
      {modulos.includes("tables") && <MesasView negocio={negocio} />}
      {modulos.includes("service_orders") && <ServiceOrdersView negocio={negocio} />}
      {modulos.includes("purchasing") && <ComprasView negocio={negocio} />}
      {modulos.includes("customers") && <ClientesView negocio={negocio} loyalty={modulos.includes("loyalty")} />}
      {modulos.includes("expenses") && <GastosView negocio={negocio} />}
      {modulos.includes("taxes") && <ImpuestosView negocio={negocio} />}
      {modulos.includes("storefront") && <TiendaLink slug={negocio.slug} />}

      <Ubicacion negocio={negocio} />
      <ImagenNegocio negocioId={negocio.id} tipo="cover" />
      <ImagenNegocio negocioId={negocio.id} tipo="logo" />
      <Cobros negocioId={negocio.id} />
      <Invitacion negocioId={negocio.id} />
      <Suscripcion negocioId={negocio.id} />
      <Analitica negocioId={negocio.id} />
    </div>
  );
}

interface Split { fianzaUsd: number; alNegocioUsd: number; turnoNetoUsd: number; feeStripeUsd: number; }
interface Liq { desde: string; empleados: { peluquero: string; reservasPagadas: number; fianzaNegocioUsd: number }[]; totalReservas: number; totalNegocioUsd: number; }

// Onboarding de Stripe Connect + desglose del reparto + liquidación por empleado.
function Cobros({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [estado, setEstado] = useState<{ conectado: boolean; cobrosActivos: boolean; payout?: { intervalo: string; anchor: number } } | null>(null);
  const [split, setSplit] = useState<Split | null>(null);
  const [liq, setLiq] = useState<Liq | null>(null);
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<{ conectado: boolean; cobrosActivos: boolean; payout?: { intervalo: string; anchor: number } }>(`/connect/estado/${negocioId}`).then(setEstado).catch(() => {});
    api.get<Liq>(`/negocios/${negocioId}/liquidacion`).then(setLiq).catch(() => {});
  }
  useEffect(cargar, [negocioId]);
  useEffect(() => { api.get<Split>("/reservas/split").then(setSplit).catch(() => {}); }, []);

  async function conectar() {
    setMsg("");
    const r = await api.post<{ onboardingUrl: string | null; mensaje?: string }>("/connect/onboard", { negocioId });
    if (r.onboardingUrl) window.location.href = r.onboardingUrl;
    else { setMsg(r.mensaje ?? "OK"); cargar(); }
  }

  async function cambiarPayout(intervalo: string) {
    setMsg("");
    await api.post("/connect/payout-schedule", { negocioId, intervalo, anchor: 1 });
    setMsg(t("own.payoutSaved"));
    cargar();
  }

  return (
    <div className="card">
      <h2>{t("own.payouts")}</h2>
      <p className="muted small">{t("own.payoutsHelp")}</p>
      {estado?.cobrosActivos ? (
        <p className="success">{t("own.payoutsActive")}</p>
      ) : (
        <>
          <button className="primary" onClick={conectar}>{t("own.payoutsConnect")}</button>
          {estado?.conectado && !estado.cobrosActivos && <p className="small" style={{ color: "var(--amber)" }}>{t("own.payoutsPending")}</p>}
        </>
      )}

      {/* Calendario de depósitos */}
      {estado && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted small">{t("own.payoutSchedule")}:</span>
          {(["daily", "weekly", "monthly"] as const).map((iv) => (
            <button key={iv} className={estado.payout?.intervalo === iv ? "selected small" : "ghost small"} onClick={() => cambiarPayout(iv)}>
              {iv === "daily" ? t("own.daily") : iv === "weekly" ? t("own.weekly") : t("own.monthly")}
            </button>
          ))}
        </div>
      )}
      {msg && <p className="success">{msg}</p>}

      {/* Desglose de cada fianza (contando la comisión de Stripe) */}
      {split && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 14, marginBottom: 0 }}>
          <h3 style={{ marginBottom: 8 }}>{t("own.splitTitle")}: ${split.fianzaUsd.toFixed(2)}</h3>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge ok">{t("own.splitBusiness")}: ${split.alNegocioUsd.toFixed(2)}</span>
            <span className="badge">{t("own.splitPlatform")}: ${split.turnoNetoUsd.toFixed(2)}</span>
            <span className="badge warn">{t("own.splitStripe")}: ${split.feeStripeUsd.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Liquidación por empleado */}
      {liq && (
        <div style={{ marginTop: 16 }}>
          <div className="row spread">
            <h3>{t("own.settlement")}</h3>
            {liq.empleados.length > 0 && liq.totalReservas > 0 && (
              <button className="ghost small" onClick={() => descargarCSV(
                `liquidacion-${liq.desde}.csv`,
                ["Empleado", "Reservas pagadas", "Para el negocio (USD)"],
                liq.empleados.map((e) => [e.peluquero, e.reservasPagadas, e.fianzaNegocioUsd.toFixed(2)]),
              )}>⬇ {t("common.download")}</button>
            )}
          </div>
          <p className="muted small">{t("own.settlementHelp")}</p>
          {liq.empleados.length === 0 || liq.totalReservas === 0 ? (
            <p className="muted small">{t("own.noSettlement")}</p>
          ) : (
            <>
              {liq.empleados.map((e) => (
                <div className="list-item" key={e.peluquero}>
                  <div><h3>{e.peluquero}</h3><span className="muted small">{e.reservasPagadas} {t("own.bookings")}</span></div>
                  <strong>${e.fianzaNegocioUsd.toFixed(2)}</strong>
                </div>
              ))}
              <div className="row spread" style={{ marginTop: 8 }}>
                <span className="muted small">{t("own.forBusiness")} · {liq.totalReservas} {t("own.bookings")}</span>
                <strong className="grad-text" style={{ fontSize: 16 }}>${liq.totalNegocioUsd.toFixed(2)}</strong>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Invitacion({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [url, setUrl] = useState("");
  async function generar() {
    const r = await api.post<{ url: string }>(`/negocios/${negocioId}/invitaciones`);
    setUrl(r.url);
  }
  return (
    <div className="card">
      <h2>{t("own.inviteTitle")}</h2>
      <p className="muted small">{t("own.inviteHelp")}</p>
      <button onClick={generar}>{t("own.inviteGen")}</button>
      {url && (
        <div className="row" style={{ marginTop: 10 }}>
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="ghost" onClick={() => navigator.clipboard?.writeText(url)}>{t("own.copy")}</button>
        </div>
      )}
    </div>
  );
}

interface Plan { id: string; nombre: string; mensualUsd: number; anualUsd: number; anualPorMes: number; ahorroAnualUsd: number; maxNegocios: number; maxPeluqueros: number; }
interface EstadoSub { estadoSuscripcion: string; plan: string | null; intervaloPlan: string | null; suscripcionHasta: string | null; }

function Suscripcion({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [estado, setEstado] = useState<EstadoSub | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [intervalo, setIntervalo] = useState<"mensual" | "anual">("anual");
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<EstadoSub>(`/suscripcion/estado/${negocioId}`).then(setEstado);
  }
  useEffect(cargar, [negocioId]);
  useEffect(() => { api.get<{ planes: Plan[] }>("/suscripcion/planes").then((r) => setPlanes(r.planes)); }, []);

  async function elegir(plan: string) {
    setMsg("");
    const r = await api.post<{ modo: string; checkoutUrl: string | null; mensaje?: string }>("/suscripcion/checkout", { negocioId, plan, intervalo });
    if (r.checkoutUrl) window.location.href = r.checkoutUrl;
    else { setMsg(r.mensaje ?? "OK"); cargar(); }
  }

  return (
    <div className="card">
      <h2>{t("own.subscription")}</h2>
      {estado && (
        <p className="small">
          {t("own.subStatus")}: <span className={`badge ${estado.estadoSuscripcion === "activo" ? "ok" : estado.estadoSuscripcion === "vencido" ? "err" : "warn"}`}>{estado.estadoSuscripcion}</span>
          {estado.plan && <> · {t("own.currentPlan")}: <strong>{estado.plan}</strong> ({estado.intervaloPlan})</>}
          {estado.suscripcionHasta && <> · {t("own.subUntil")} {new Date(estado.suscripcionHasta).toLocaleDateString()}</>}
        </p>
      )}

      {/* Toggle mensual / anual */}
      <div className="lang-toggle" style={{ margin: "10px 0 16px" }}>
        <button className={intervalo === "mensual" ? "on" : ""} onClick={() => setIntervalo("mensual")}>{t("own.monthly")}</button>
        <button className={intervalo === "anual" ? "on" : ""} onClick={() => setIntervalo("anual")}>{t("own.annual")} · {t("own.save2months")}</button>
      </div>

      <div className="grid grid-2">
        {planes.map((p) => {
          const activo = estado?.plan === p.id && estado?.estadoSuscripcion === "activo";
          return (
            <div className="card" key={p.id} style={{ margin: 0, borderColor: activo ? "var(--brand-500)" : undefined }}>
              <div className="row spread">
                <h3>{p.nombre}</h3>
                {intervalo === "anual" && <span className="badge ok">-${p.ahorroAnualUsd}</span>}
              </div>
              {intervalo === "mensual" ? (
                <div style={{ margin: "8px 0" }}><span style={{ fontSize: 30, fontWeight: 800 }}>${p.mensualUsd}</span><span className="muted">{t("own.perMonth")}</span></div>
              ) : (
                <div style={{ margin: "8px 0" }}>
                  <span style={{ fontSize: 30, fontWeight: 800 }}>${p.anualUsd}</span><span className="muted">{t("own.perYear")}</span>
                  <div className="muted small">${p.anualPorMes}{t("own.perMonth")} · {t("own.annualBilled")}</div>
                </div>
              )}
              <ul className="muted small" style={{ margin: "8px 0 10px", paddingLeft: 18 }}>
                <li>✅ {p.maxNegocios} {t("plan.businessesLabel")}</li>
                <li>✅ {t("plan.upTo")} {p.maxPeluqueros} {t("plan.prosLabel")}</li>
              </ul>
              <button className={activo ? "ghost" : "primary"} style={{ width: "100%", marginTop: 6 }} onClick={() => elegir(p.id)}>
                {activo ? `✓ ${t("own.currentPlan")}` : t("own.choosePlan")}
              </button>
            </div>
          );
        })}
      </div>
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

function Ubicacion({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [direccion, setDireccion] = useState(negocio.direccion);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    negocio.lat != null && negocio.lng != null ? { lat: negocio.lat, lng: negocio.lng } : null,
  );
  const [msg, setMsg] = useState("");
  const [ubicando, setUbicando] = useState(false);

  function usarUbicacion() {
    if (!navigator.geolocation) return;
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setUbicando(false); },
      () => setUbicando(false),
    );
  }

  async function guardar() {
    setMsg("");
    try {
      await api.patch(`/negocios/${negocio.id}`, { direccion, ...(coords ?? {}) });
      setMsg(t("own.locationSaved"));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="card">
      <h2>{t("own.locationTitle")}</h2>
      <p className="muted small">{t("own.locationHelp")}</p>
      <label>{t("own.address")}</label>
      <input value={direccion} onChange={(e) => setDireccion(e.target.value)} />

      <MapaUbicacion lat={coords?.lat ?? null} lng={coords?.lng ?? null} onChange={(la, ln) => setCoords({ lat: la, lng: ln })} />

      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="ghost small" onClick={usarUbicacion} disabled={ubicando}>
          📍 {ubicando ? t("own.locating") : t("own.useLocationOpt")}
        </button>
        {coords && <a href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">{t("mkt.viewMap")}</a>}
      </div>
      <button className="primary" style={{ marginTop: 12 }} onClick={guardar}>{t("own.saveLocation")}</button>
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

function ImagenNegocio({ negocioId, tipo }: { negocioId: string; tipo: "logo" | "cover" }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const esCover = tipo === "cover";
  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const r = await api.upload<{ logoUrl?: string; coverUrl?: string }>(`/uploads/${tipo}/${negocioId}`, "imagen", file);
      setUrl(r.coverUrl ?? r.logoUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }
  return (
    <div className="card">
      <h2>{esCover ? t("own.coverPhoto") : t("own.logo")}</h2>
      <p className="muted small">{esCover ? t("own.coverHelp") : t("own.logoHelp")}</p>
      <input type="file" accept="image/*" onChange={subir} />
      {error && <p className="error">{error}</p>}
      {url && <div style={{ marginTop: 10 }}><img src={assetUrl(url)} alt={tipo} style={{ height: esCover ? 120 : 64, width: esCover ? "100%" : 64, objectFit: "cover", borderRadius: esCover ? 12 : "50%" }} /></div>}
    </div>
  );
}

interface AnaliticaData {
  totalReservas: number;
  porEstado: { estado: string; total: number }[];
  ingresoServiciosUsd: number;
  porPeluquero: { peluquero: string; reservas: number }[];
}

function Analitica({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  const [data, setData] = useState<AnaliticaData | null>(null);
  useEffect(() => {
    api.get<AnaliticaData>(`/negocios/${negocioId}/analitica`).then(setData).catch(() => {});
  }, [negocioId]);

  if (!data) return null;
  return (
    <div className="card">
      <h2>{t("own.analytics")}</h2>
      <div className="grid grid-2">
        <Stat label={t("own.totalBookings")} value={data.totalReservas} icon="📅" />
        <Stat label={t("own.incomeCompleted")} value={`$${data.ingresoServiciosUsd.toFixed(2)}`} icon="💰" variant="green" />
      </div>
      {data.porEstado.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          {data.porEstado.map((e) => <span className="badge" key={e.estado}>{e.estado}: {e.total}</span>)}
        </div>
      )}
      {data.porPeluquero.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>{t("own.bookingsByPro")}</h3>
          {data.porPeluquero.map((p) => (
            <div className="list-item" key={p.peluquero}><span>{p.peluquero}</span><strong>{p.reservas}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}
