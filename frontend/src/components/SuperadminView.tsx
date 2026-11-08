import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { Stat, Empty } from "./Ui";

interface Metricas {
  negocios: number;
  negociosActivos: number;
  reservasPagadas: number;
  ingresoFianzasUsd: number;
  usuariosPorRol: { rol: string; total: number }[];
}

interface NegocioAdmin {
  id: string;
  nombreComercial: string;
  estadoSuscripcion: "activo" | "vencido" | "prueba";
  suscripcionHasta: string | null;
  dueno: { nombre: string; email: string };
  _count: { equipo: number };
}

interface UsuarioAdmin { id: number; nombre: string; email: string; rol: string; bloqueado: boolean; emailVerificadoEn: string | null; }
interface SerieIngreso { dia: string; reservas: number; ingresoUsd: number; }
interface LogItem { id: number; actorId: number | null; accion: string; detalle: string | null; createdAt: string; }

type Tab = "resumen" | "usuarios" | "ingresos" | "auditoria" | "embudo";

export function SuperadminView() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("resumen");
  return (
    <div className="container">
      <h1>{t("sa.platform")}</h1>
      <div className="tabs">
        <button className={`tab ${tab === "resumen" ? "active" : ""}`} onClick={() => setTab("resumen")}>{t("sa.tabSummary")}</button>
        <button className={`tab ${tab === "usuarios" ? "active" : ""}`} onClick={() => setTab("usuarios")}>{t("sa.tabUsers")}</button>
        <button className={`tab ${tab === "ingresos" ? "active" : ""}`} onClick={() => setTab("ingresos")}>{t("sa.tabIncome")}</button>
        <button className={`tab ${tab === "auditoria" ? "active" : ""}`} onClick={() => setTab("auditoria")}>{t("sa.tabAudit")}</button>
        <button className={`tab ${tab === "embudo" ? "active" : ""}`} onClick={() => setTab("embudo")}>{t("sa.tabFunnel")}</button>
      </div>
      {tab === "resumen" && <Resumen />}
      {tab === "usuarios" && <Usuarios />}
      {tab === "ingresos" && <Ingresos />}
      {tab === "auditoria" && <Auditoria />}
      {tab === "embudo" && <Embudo />}
    </div>
  );
}

function Resumen() {
  const { t } = useT();
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [negocios, setNegocios] = useState<NegocioAdmin[]>([]);

  function cargar() {
    api.get<Metricas>("/superadmin/metricas").then(setMetricas);
    api.get<{ negocios: NegocioAdmin[] }>("/superadmin/negocios").then((r) => setNegocios(r.negocios));
  }
  useEffect(cargar, []);

  async function cambiarEstado(id: string, estado: "activo" | "vencido" | "prueba") {
    await api.patch(`/superadmin/negocios/${id}/suscripcion`, { estadoSuscripcion: estado });
    cargar();
  }

  return (
    <div>
      {metricas && (
        <div className="grid grid-2" style={{ marginBottom: 16 }}>
          <Stat label={t("sa.businesses")} value={metricas.negocios} icon="🏬" />
          <Stat label={t("sa.active")} value={metricas.negociosActivos} icon="✅" variant="accent" />
          <Stat label={t("sa.paidBookings")} value={metricas.reservasPagadas} icon="📅" />
          <Stat label={t("sa.depositIncome")} value={`$${metricas.ingresoFianzasUsd.toFixed(2)}`} icon="💰" variant="green" />
        </div>
      )}
      <div className="card">
        <h2>{t("sa.businesses")}</h2>
        {negocios.map((n) => (
          <div className="list-item" key={n.id}>
            <div>
              <h3>{n.nombreComercial}</h3>
              <span className="muted small">{n.dueno.nombre} · {n._count.equipo} {t("own.professionals")}</span>
            </div>
            <div className="row">
              <span className={`badge ${n.estadoSuscripcion === "vencido" ? "err" : "ok"}`}>{n.estadoSuscripcion}</span>
              {n.estadoSuscripcion !== "activo" ? (
                <button className="primary" onClick={() => cambiarEstado(n.id, "activo")}>{t("sa.activate")}</button>
              ) : (
                <button className="ghost" onClick={() => cambiarEstado(n.id, "vencido")}>{t("sa.suspend")}</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Usuarios() {
  const { t } = useT();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [q, setQ] = useState("");

  function cargar() {
    api.get<{ usuarios: UsuarioAdmin[] }>(`/superadmin/usuarios${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => setUsuarios(r.usuarios));
  }
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [q]);

  async function toggle(u: UsuarioAdmin) {
    await api.patch(`/superadmin/usuarios/${u.id}/estado`, { bloqueado: !u.bloqueado });
    cargar();
  }

  return (
    <div className="card">
      <h2>{t("sa.tabUsers")}</h2>
      <input placeholder={t("sa.searchUser")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        {usuarios.map((u) => (
          <div className="list-item" key={u.id}>
            <div>
              <h3>{u.nombre} <span className="badge">{u.rol}</span></h3>
              <span className="muted small">{u.email} {u.emailVerificadoEn ? `· ✓ ${t("sa.verified")}` : `· ${t("sa.unverified")}`}</span>
            </div>
            <div className="row">
              {u.bloqueado && <span className="badge err">{t("sa.banned")}</span>}
              {u.rol !== "superadmin" && (
                <button className={u.bloqueado ? "primary" : "ghost"} onClick={() => toggle(u)}>
                  {u.bloqueado ? t("sa.reactivate") : t("sa.ban")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ingresos() {
  const { t } = useT();
  const [serie, setSerie] = useState<SerieIngreso[]>([]);
  useEffect(() => { api.get<{ serie: SerieIngreso[] }>("/superadmin/ingresos?dias=30").then((r) => setSerie(r.serie)); }, []);
  const max = Math.max(1, ...serie.map((s) => s.reservas));
  const totalUsd = serie.reduce((a, s) => a + s.ingresoUsd, 0);

  return (
    <div className="card">
      <h2>{t("sa.incomeTitle")}</h2>
      <p className="small muted">{t("sa.total")}: <strong className="grad-text" style={{ fontSize: 16 }}>${totalUsd.toFixed(2)}</strong></p>
      {serie.length === 0 ? (
        <Empty emoji="📈">{t("sa.noIncome")}</Empty>
      ) : (
        <div className="chart">
          {serie.map((s) => (
            <div key={s.dia} className="bar" title={`${s.dia}: ${s.reservas} reservas ($${s.ingresoUsd})`}
              style={{ height: `${Math.max(4, (s.reservas / max) * 100)}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function Auditoria() {
  const { t } = useT();
  const [logs, setLogs] = useState<LogItem[]>([]);
  useEffect(() => { api.get<{ logs: LogItem[] }>("/superadmin/auditoria").then((r) => setLogs(r.logs)); }, []);
  return (
    <div className="card">
      <h2>{t("sa.auditTitle")}</h2>
      {logs.length === 0 && <Empty emoji="🗂️">{t("sa.noAudit")}</Empty>}
      {logs.map((l) => (
        <div className="list-item" key={l.id}>
          <div><h3>{l.accion}</h3><span className="muted small">{l.detalle}</span></div>
          <span className="muted small">{new Date(l.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embudo de conversión
// ---------------------------------------------------------------------------
// Responde a la única pregunta que las tablas de reservas no pueden responder:
// de los que entran, ¿cuántos llegan a pagar y en qué paso se van?

interface PasoEmbudo {
  paso: string;
  sesiones: number;
  pctDesdeInicio: number;
  pctDesdeAnterior: number;
}

const NOMBRES_PASO: Record<string, string> = {
  landing_vista: "Entran en la web",
  negocio_visto: "Abren un negocio",
  servicio_elegido: "Eligen servicio",
  slot_elegido: "Eligen hora",
  pago_abierto: "Llegan al pago",
  pago_completado: "Pagan",
};

function Embudo() {
  const { t } = useT();
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState<{ embudo: PasoEmbudo[]; otros: { nombre: string; sesiones: number }[] } | null>(null);

  useEffect(() => {
    api
      .get<{ embudo: PasoEmbudo[]; otros: { nombre: string; sesiones: number }[] }>(
        `/eventos/embudo?dias=${dias}`,
      )
      .then(setDatos)
      .catch(() => setDatos(null));
  }, [dias]);

  if (!datos) return <p className="muted">{t("common.loading")}</p>;

  const base = datos.embudo[0]?.sesiones ?? 0;

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("sa.tabFunnel")}</h2>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label={t("sa.funnelDays")}>
          <option value={7}>7 d</option>
          <option value={30}>30 d</option>
          <option value={90}>90 d</option>
        </select>
      </div>
      <p className="small muted">{t("sa.funnelHelp")}</p>

      {base === 0 ? (
        <p className="muted small">{t("sa.funnelEmpty")}</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t("sa.funnelStep")}</th>
              <th style={{ textAlign: "right" }}>{t("sa.funnelSessions")}</th>
              <th style={{ textAlign: "right" }}>%</th>
              <th style={{ textAlign: "right" }}>{t("sa.funnelDropoff")}</th>
            </tr>
          </thead>
          <tbody>
            {datos.embudo.map((p, i) => (
              <tr key={p.paso} style={{ borderTop: "1px solid var(--border)" }}>
                <td>
                  {NOMBRES_PASO[p.paso] ?? p.paso}
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      marginTop: 4,
                      width: `${p.pctDesdeInicio}%`,
                      minWidth: 2,
                      background: "var(--brand-600, #6366f1)",
                    }}
                  />
                </td>
                <td style={{ textAlign: "right" }}>{p.sesiones}</td>
                <td style={{ textAlign: "right" }}>{p.pctDesdeInicio}%</td>
                <td style={{ textAlign: "right", color: i > 0 && p.pctDesdeAnterior < 50 ? "var(--danger, #ef4444)" : undefined }}>
                  {i === 0 ? "—" : `-${(100 - p.pctDesdeAnterior).toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {datos.otros.length > 0 && (
        <p className="small muted" style={{ marginTop: 12 }}>
          {datos.otros.map((o) => `${o.nombre}: ${o.sesiones}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
