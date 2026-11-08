import { useEffect, useState } from "react";
import { api, ApiError, assetUrl, formatPrecio, descargarCSV, MONEDAS, type Servicio, type Negocio } from "../api";
import { useT } from "../i18n";
import { Empty, Stat } from "./Ui";
import { ColaEspera } from "./ListaEspera";
import { useAuth } from "../auth";

const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
type Dia = (typeof DIAS)[number];
interface Rango { dia: Dia; horaInicio: string; horaFin: string; }

export function PeluqueroView() {
  const { t } = useT();
  const [tab, setTab] = useState<"servicios" | "horarios" | "bloqueos" | "agenda" | "ingresos" | "negocios" | "perfil">("servicios");
  return (
    <div className="container">
      <div className="tabs">
        <button className={`tab ${tab === "servicios" ? "active" : ""}`} onClick={() => setTab("servicios")}>{t("pro.tabServices")}</button>
        <button className={`tab ${tab === "horarios" ? "active" : ""}`} onClick={() => setTab("horarios")}>{t("pro.tabAvailability")}</button>
        <button className={`tab ${tab === "bloqueos" ? "active" : ""}`} onClick={() => setTab("bloqueos")}>{t("pro.tabBlocks")}</button>
        <button className={`tab ${tab === "agenda" ? "active" : ""}`} onClick={() => setTab("agenda")}>{t("pro.tabAgenda")}</button>
        <button className={`tab ${tab === "ingresos" ? "active" : ""}`} onClick={() => setTab("ingresos")}>{t("pro.tabEarnings")}</button>
        <button className={`tab ${tab === "negocios" ? "active" : ""}`} onClick={() => setTab("negocios")}>{t("pro.tabJoin")}</button>
        <button className={`tab ${tab === "perfil" ? "active" : ""}`} onClick={() => setTab("perfil")}>{t("pro.tabProfile")}</button>
      </div>
      {tab === "servicios" && <Servicios />}
      {tab === "horarios" && <Horarios />}
      {tab === "bloqueos" && <Bloqueos />}
      {tab === "agenda" && <Agenda />}
      {tab === "ingresos" && <Ingresos />}
      {tab === "negocios" && <UnirseNegocio />}
      {tab === "perfil" && <Perfil />}
    </div>
  );
}

interface IngresosData {
  desde: string;
  reservasPagadas: number;
  totalHistorico: number;
  fianzaNegocioUsd: number;
  fianzaPorReservaUsd: number;
  valorServicios: { moneda: string; total: number }[];
  reservas: { id: number; fecha: string; servicio: string; precio: string | number; moneda: string }[];
}

function Ingresos() {
  const { t } = useT();
  const [data, setData] = useState<IngresosData | null>(null);
  useEffect(() => { api.get<IngresosData>("/reservas/mis-ingresos").then(setData).catch(() => {}); }, []);

  if (!data) return <p className="muted">{t("common.loading")}</p>;

  return (
    <div>
      <div className="card">
        <h2>{t("pro.earningsTitle")}</h2>
        <p className="muted small">{t("pro.earningsHelp")}</p>
        <div className="grid grid-2" style={{ marginTop: 12 }}>
          <Stat label={t("pro.paidBookings")} value={data.reservasPagadas} icon="📅" />
          <Stat label={t("pro.generatedForBusiness")} value={`$${data.fianzaNegocioUsd.toFixed(2)}`} icon="💰" variant="green" />
          <Stat label={t("pro.serviceValue")} icon="✂️" variant="accent"
            value={data.valorServicios.length === 0 ? "—" : data.valorServicios.map((v) => formatPrecio(v.total, v.moneda)).join(" · ")} />
          <Stat label={t("pro.allTime")} value={data.totalHistorico} icon="📈" />
        </div>
      </div>

      <div className="card">
        <div className="row spread">
          <h2>{t("pro.detail")}</h2>
          {data.reservas.length > 0 && (
            <button className="ghost small" onClick={() => descargarCSV(
              `ingresos-${data.desde}.csv`,
              ["Fecha", "Servicio", "Precio", "Moneda", "Fianza negocio (USD)"],
              data.reservas.map((r) => [r.fecha, r.servicio, Number(r.precio).toFixed(2), r.moneda, data.fianzaPorReservaUsd.toFixed(2)]),
            )}>⬇ {t("common.download")}</button>
          )}
        </div>
        {data.reservas.length === 0 ? (
          <Empty emoji="🧾">{t("pro.noEarnings")}</Empty>
        ) : (
          data.reservas.map((r) => (
            <div className="list-item" key={r.id}>
              <div><h3>{r.servicio}</h3><span className="muted small">{r.fecha}</span></div>
              <div className="row" style={{ gap: 10 }}>
                <span>{formatPrecio(r.precio, r.moneda)}</span>
                <span className="badge ok">+${data.fianzaPorReservaUsd.toFixed(2)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface BloqueoItem { id: number; fecha: string; horaInicio: string | null; horaFin: string | null; motivo: string | null; }

function Bloqueos() {
  const { t } = useT();
  const [bloqueos, setBloqueos] = useState<BloqueoItem[]>([]);
  const [form, setForm] = useState({ fecha: "", todoElDia: true, horaInicio: "09:00", horaFin: "13:00", motivo: "" });
  const [error, setError] = useState("");

  function cargar() {
    api.get<{ bloqueos: BloqueoItem[] }>("/disponibilidad/bloqueos").then((r) => setBloqueos(r.bloqueos));
  }
  useEffect(cargar, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/disponibilidad/bloqueos", {
        fecha: form.fecha,
        motivo: form.motivo || undefined,
        ...(form.todoElDia ? {} : { horaInicio: form.horaInicio, horaFin: form.horaFin }),
      });
      setForm({ ...form, fecha: "", motivo: "" });
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function eliminar(id: number) {
    await api.del(`/disponibilidad/bloqueos/${id}`);
    cargar();
  }

  return (
    <div>
      <div className="card">
        <h2>{t("pro.blockTitle")}</h2>
        <p className="muted small">{t("pro.blockHelp")}</p>
        <form onSubmit={crear}>
          <label htmlFor="peluqu-pro-date">{t("pro.date")}</label>
          <input id="peluqu-pro-date" type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} required />
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.todoElDia} onChange={(e) => setForm({ ...form, todoElDia: e.target.checked })} />
            {t("pro.allDay")}
          </label>
          {!form.todoElDia && (
            <div className="row">
              <div style={{ flex: 1 }}><label htmlFor="peluqu-pro-from">{t("pro.from")}</label><input id="peluqu-pro-from" type="time" value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label htmlFor="peluqu-pro-to">{t("pro.to")}</label><input id="peluqu-pro-to" type="time" value={form.horaFin} onChange={(e) => setForm({ ...form, horaFin: e.target.value })} /></div>
            </div>
          )}
          <label htmlFor="peluqu-pro-reason">{t("pro.reason")}</label>
          <input id="peluqu-pro-reason" value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
          {error && <p className="error">{error}</p>}
          <button className="primary" style={{ marginTop: 12 }}>{t("pro.addBlock")}</button>
        </form>
      </div>
      <div className="card">
        <h2>{t("pro.upcomingBlocks")}</h2>
        {bloqueos.length === 0 && <Empty emoji="🏖️">{t("pro.noBlocks")}</Empty>}
        {bloqueos.map((b) => (
          <div className="list-item" key={b.id}>
            <div>
              <h3>{new Date(b.fecha).toISOString().slice(0, 10)}</h3>
              <span className="muted small">{b.horaInicio && b.horaFin ? `${b.horaInicio}–${b.horaFin}` : t("pro.allDay")}{b.motivo ? ` · ${b.motivo}` : ""}</span>
            </div>
            <button className="ghost" onClick={() => eliminar(b.id)}>{t("common.remove")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Perfil() {
  const { t } = useT();
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const r = await api.upload<{ fotoUrl: string }>("/uploads/foto", "imagen", file);
      setFotoUrl(r.fotoUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }
  return (
    <div className="card">
      <h2>{t("pro.profilePhoto")}</h2>
      <p className="muted small">{t("pro.photoHelp")}</p>
      <input type="file" accept="image/*" onChange={subir} />
      {error && <p className="error">{error}</p>}
      {fotoUrl && <div style={{ marginTop: 10 }}><img src={assetUrl(fotoUrl)} alt="foto" style={{ height: 96, width: 96, objectFit: "cover", borderRadius: "50%" }} /></div>}
    </div>
  );
}

function Servicios() {
  const { t } = useT();
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [form, setForm] = useState({ nombreServicio: "", precio: "", moneda: "USD", duracionMinutos: "" });
  const [error, setError] = useState("");

  function cargar() {
    api.get<{ servicios: Servicio[] }>("/servicios/mios").then((r) => setServicios(r.servicios));
  }
  useEffect(cargar, []);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/servicios", {
        nombreServicio: form.nombreServicio,
        precio: Number(form.precio),
        moneda: form.moneda,
        duracionMinutos: Number(form.duracionMinutos),
      });
      setForm({ nombreServicio: "", precio: "", moneda: form.moneda, duracionMinutos: "" });
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function eliminar(id: number) {
    await api.del(`/servicios/${id}`);
    cargar();
  }

  const activos = servicios.filter((s) => s.activo !== false);

  return (
    <div>
      <div className="card">
        <h2>{t("pro.newService")}</h2>
        <form onSubmit={crear}>
          <label htmlFor="peluqu-pro-name">{t("pro.name")}</label>
          <input id="peluqu-pro-name" value={form.nombreServicio} onChange={(e) => setForm({ ...form, nombreServicio: e.target.value })} required />
          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="peluqu-pro-price">{t("pro.price")}</label>
              <input id="peluqu-pro-price" type="number" step="0.01" min="0" value={form.precio} onChange={(e) => setForm({ ...form, precio: e.target.value })} required />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="peluqu-pro-currency">{t("pro.currency")}</label>
              <select id="peluqu-pro-currency" value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value })}>
                {MONEDAS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="peluqu-pro-duration">{t("pro.duration")}</label>
              <input id="peluqu-pro-duration" type="number" min="1" value={form.duracionMinutos} onChange={(e) => setForm({ ...form, duracionMinutos: e.target.value })} required />
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary" style={{ marginTop: 12 }}>{t("pro.addService")}</button>
        </form>
      </div>

      <div className="card">
        <h2>{t("pro.myServices")}</h2>
        {activos.length === 0 && <Empty emoji="✂️">{t("pro.noServices")}</Empty>}
        {activos.map((s) => (
          <div className="list-item" key={s.id}>
            <div className="row" style={{ gap: 12 }}>
              <ImagenServicio servicio={s} onSubida={cargar} />
              <div><h3>{s.nombreServicio}</h3><span className="muted small">{formatPrecio(s.precio, s.moneda)} · {s.duracionMinutos} min</span></div>
            </div>
            <button className="ghost" onClick={() => eliminar(s.id)}>{t("common.delete")}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Miniatura + subida de imagen del servicio (foto del resultado: corte, peinado, etc.).
function ImagenServicio({ servicio, onSubida }: { servicio: Servicio; onSubida: () => void }) {
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(servicio.imagenUrl ?? null);
  const inputId = `svc-img-${servicio.id}`;
  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const r = await api.upload<{ imagenUrl: string }>(`/uploads/servicio/${servicio.id}`, "imagen", file);
      setUrl(r.imagenUrl);
      onSubida();
    } catch { /* noop */ }
  }
  return (
    <label htmlFor={inputId} title={t("pro.serviceImage")} style={{ cursor: "pointer", margin: 0 }}>
      {url ? (
        <img src={assetUrl(url)} alt={servicio.nombreServicio}
          style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} />
      ) : (
        <span style={{ width: 52, height: 52, display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 10, border: "1px dashed var(--border-strong)", background: "var(--surface-2)", fontSize: 20 }}>📷</span>
      )}
      <input id={inputId} type="file" accept="image/*" onChange={subir} style={{ display: "none" }} />
    </label>
  );
}

function Horarios() {
  const { t } = useT();
  const [rangos, setRangos] = useState<Rango[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get<{ disponibilidad: Rango[] }>("/disponibilidad/mia").then((r) => setRangos(r.disponibilidad));
  }, []);

  function agregar() {
    setRangos([...rangos, { dia: "lunes", horaInicio: "09:00", horaFin: "18:00" }]);
  }
  function actualizar(i: number, campo: keyof Rango, valor: string) {
    setRangos(rangos.map((r, idx) => (idx === i ? { ...r, [campo]: valor } : r)));
  }
  function eliminar(i: number) {
    setRangos(rangos.filter((_, idx) => idx !== i));
  }
  async function guardar() {
    setMsg("");
    try {
      await api.put("/disponibilidad/mia", { rangos });
      setMsg(t("pro.availSaved"));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="card">
      <h2>{t("pro.weeklyAvail")}</h2>
      <p className="muted small">{t("pro.availHelp")}</p>
      {rangos.map((r, i) => (
        <div className="row" key={i} style={{ marginTop: 8 }}>
          <select value={r.dia} onChange={(e) => actualizar(i, "dia", e.target.value)} style={{ flex: 2 }}>
            {DIAS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="time" value={r.horaInicio} onChange={(e) => actualizar(i, "horaInicio", e.target.value)} style={{ flex: 1 }} />
          <input type="time" value={r.horaFin} onChange={(e) => actualizar(i, "horaFin", e.target.value)} style={{ flex: 1 }} />
          <button className="ghost" onClick={() => eliminar(i)}>✕</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={agregar}>{t("pro.addRange")}</button>
        <button className="primary" onClick={guardar}>{t("common.save")}</button>
      </div>
      {msg && <p className="success">{msg}</p>}
    </div>
  );
}

interface CitaAgenda {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estadoCita: string;
  pagoReservaStatus: string;
  codigoValidacion: string;
  cliente: { nombre: string; telefono?: string };
  servicio: { nombreServicio: string; duracionMinutos: number };
}

/**
 * Validación del código del cliente en el local.
 *
 * Es la pieza que faltaba por completo: ninguna cita llegaba nunca al estado
 * "completada", así que el cliente no podía dejar reseña y la analítica de
 * ingresos del negocio salía siempre a cero.
 */
function ValidarCodigo({ onValidado }: { onValidado: () => void }) {
  const { t } = useT();
  const [codigo, setCodigo] = useState("");
  const [propina, setPropina] = useState("");
  const [cargando, setCargando] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  async function validar() {
    if (codigo.trim().length < 4) return;
    setCargando(true);
    setOk("");
    setError("");
    try {
      const r = await api.post<{
        yaCompletada: boolean;
        reserva: { cliente: string; servicio: string; fecha: string; horaInicio: string };
      }>("/reservas/validar", {
        codigo: codigo.trim(),
        // La propina se entrega en mano: aquí solo se registra para los ingresos.
        ...(propina ? { propina: Number(propina) } : {}),
      });
      setOk(
        `${r.yaCompletada ? t("close.already") : t("close.validated")} — ${r.reserva.cliente} · ${r.reserva.servicio} · ${r.reserva.fecha} ${r.reserva.horaInicio}`,
      );
      setCodigo("");
      setPropina("");
      onValidado();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("close.invalid"));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card" style={{ borderColor: "var(--brand-600)" }}>
      <h2>{t("close.title")}</h2>
      <p className="small muted">{t("close.help")}</p>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && validar()}
          placeholder={t("close.codePlaceholder")}
          maxLength={12}
          style={{ textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}
        />
        <input
          type="number"
          min={0}
          step="0.5"
          value={propina}
          onChange={(e) => setPropina(e.target.value)}
          placeholder={t("tip.label")}
          aria-label={t("tip.label")}
          style={{ maxWidth: 140 }}
        />
        <button className="primary" onClick={validar} disabled={cargando || codigo.trim().length < 4}>
          {cargando ? t("pay.processing") : t("close.validate")}
        </button>
      </div>
      <p className="small muted">{t("tip.help")}</p>
      {ok && <p className="success small">{ok}</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function Agenda() {
  const { t } = useT();
  const { usuario } = useAuth();
  const miId = usuario?.id ?? 0;
  const [reservas, setReservas] = useState<CitaAgenda[]>([]);
  // Día cuya cola de espera se consulta: por defecto hoy.
  const [diaCola] = useState(() => new Date().toISOString().slice(0, 10));
  const [zona, setZona] = useState("");
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState("");

  function cargar() {
    const hoy = new Date().toISOString().slice(0, 10);
    api
      .get<{ reservas: CitaAgenda[]; timezone: string }>(`/reservas/agenda?desde=${hoy}`)
      .then((r) => {
        setReservas(r.reservas);
        setZona(r.timezone);
      })
      .catch(() => {});
  }
  useEffect(cargar, []);

  async function completar(id: number) {
    setAviso("");
    try {
      await api.patch(`/reservas/${id}/completar`);
      setAviso(t("close.validated"));
      cargar();
    } catch (e) {
      setAviso(e instanceof ApiError ? e.message : t("common.error"));
    }
  }

  async function noAsistio(id: number) {
    if (!window.confirm(t("close.noShowConfirm"))) return;
    setAviso("");
    try {
      await api.patch(`/reservas/${id}/no-asistio`);
      cargar();
    } catch (e) {
      setAviso(e instanceof ApiError ? e.message : t("common.error"));
    }
  }

  async function cancelarNegocio(id: number) {
    setAviso("");
    try {
      await api.patch(`/reservas/${id}/cancelar-negocio`, { motivo: motivo.trim() || undefined });
      setAviso(t("close.cancelled"));
      setCancelando(null);
      setMotivo("");
      cargar();
    } catch (e) {
      setAviso(e instanceof ApiError ? e.message : t("common.error"));
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <ValidarCodigo onValidado={cargar} />

      {/* Quién quería hueco y no lo encontró: demanda real, no intuición. */}
      {miId > 0 && <ColaEspera peluqueroId={miId} fecha={diaCola} />}

      <div className="card">
        <div className="row spread">
          <h2>{t("pro.upcomingAppts")}</h2>
          {zona && <span className="badge">{zona}</span>}
        </div>
        {aviso && <p className="success small">{aviso}</p>}
        {reservas.length === 0 && <Empty emoji="📅">{t("pro.noAppts")}</Empty>}
        {reservas.map((r) => (
          <div key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>{r.servicio.nombreServicio}</h3>
                <span className="muted small">
                  {r.fecha} · {r.horaInicio}–{r.horaFin} · {r.cliente.nombre}
                  {r.cliente.telefono ? ` · ${r.cliente.telefono}` : ""}
                </span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {r.pagoReservaStatus === "pendiente" && (
                  <span className="badge warn">{t("close.pendingPayment")}</span>
                )}
                <span className={`badge ${r.estadoCita === "cancelada" || r.estadoCita === "no_asistio" ? "warn" : "ok"}`}>
                  {r.estadoCita}
                </span>
              </div>
            </div>

            {/* Acciones de cierre: solo con la cita viva. */}
            {r.estadoCita === "confirmada" && (
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <code className="small faint">{r.codigoValidacion}</code>
                <button
                  className="primary small"
                  onClick={() => completar(r.id)}
                  disabled={r.pagoReservaStatus === "pendiente"}
                >
                  {t("close.complete")}
                </button>
                <button className="ghost small" onClick={() => noAsistio(r.id)}>
                  {t("close.noShow")}
                </button>
                <button
                  className="ghost small"
                  onClick={() => setCancelando(cancelando === r.id ? null : r.id)}
                >
                  {t("close.cancelBiz")}
                </button>
              </div>
            )}

            {cancelando === r.id && (
              <div className="card" style={{ marginTop: 8 }}>
                <label htmlFor="peluqu-close-cancelreason">{t("close.cancelReason")}</label>
                <input id="peluqu-close-cancelreason" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
                <p className="small warn">{t("close.cancelConfirm")}</p>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary small" onClick={() => cancelarNegocio(r.id)}>
                    {t("close.cancelBiz")}
                  </button>
                  <button className="ghost small" onClick={() => setCancelando(null)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnirseNegocio() {
  const { t } = useT();
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api.get<{ negocios: Negocio[] }>("/negocios").then((r) => setNegocios(r.negocios));
  }, []);

  async function solicitar(n: Negocio) {
    setMsg("");
    try {
      await api.post(`/negocios/${n.id}/solicitudes`);
      setMsg(`✓ ${n.nombreComercial}: ${t("pro.requestSent")}`);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="card">
      <h2>{t("pro.requestJoin")}</h2>
      {msg && <p className="success">{msg}</p>}
      {negocios.map((n) => (
        <div className="list-item" key={n.id}>
          <div><h3>{n.nombreComercial}</h3><span className="muted small">{n.direccion}</span></div>
          <button className="primary" onClick={() => solicitar(n)}>{t("pro.requestJoinBtn")}</button>
        </div>
      ))}
    </div>
  );
}
