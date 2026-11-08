import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useT } from "../i18n";
import { evento } from "../analitica";

// Lista de espera. Antes, un día completo era un cliente perdido: se iba y no
// volvía. Ahora deja su interés y el sistema le avisa si alguien cancela.

interface EsperaMia {
  id: number;
  fecha: string;
  horaDesde: string | null;
  horaHasta: string | null;
  avisadoEn: string | null;
  servicio: { nombreServicio: string };
  peluquero: { id: number; nombre: string };
}

/** Botón para apuntarse, pensado para mostrarse cuando no quedan huecos. */
export function ApuntarseEspera({
  peluqueroId,
  servicioId,
  fecha,
}: {
  peluqueroId: number;
  servicioId: number;
  fecha: string;
}) {
  const { t } = useT();
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [estado, setEstado] = useState<"inicial" | "enviando" | "hecho">("inicial");
  const [error, setError] = useState("");

  // Cambiar de día deja el aviso anterior sin sentido: se reinicia.
  useEffect(() => {
    setEstado("inicial");
    setError("");
  }, [fecha, peluqueroId, servicioId]);

  async function apuntarse() {
    setError("");
    setEstado("enviando");
    try {
      await api.post("/espera", {
        peluqueroId,
        servicioId,
        fecha,
        // La franja solo se manda completa: la API exige las dos horas o ninguna.
        ...(desde && hasta ? { horaDesde: desde, horaHasta: hasta } : {}),
      });
      evento("espera_apuntada", { fecha });
      setEstado("hecho");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
      setEstado("inicial");
    }
  }

  if (estado === "hecho") {
    return (
      <p className="success" role="status">
        {t("wait.joined")}
      </p>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <b>{t("wait.title")}</b>
      <p className="small muted">{t("wait.noSlots")}</p>

      {abierto && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label htmlFor="esp-desde">{t("wait.from")}</label>
            <input
              id="esp-desde"
              type="time"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="esp-hasta">{t("wait.to")}</label>
            <input
              id="esp-hasta"
              type="time"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <span className="small muted">{t("wait.anyTime")}</span>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="primary" onClick={apuntarse} disabled={estado === "enviando"}>
          {estado === "enviando" ? t("wait.joining") : t("wait.join")}
        </button>
        {!abierto && (
          <button className="ghost small" onClick={() => setAbierto(true)}>
            {t("wait.window")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Listas de espera activas del cliente, con opción de salir. */
export function MisEsperas() {
  const { t } = useT();
  const [esperas, setEsperas] = useState<EsperaMia[] | null>(null);

  async function cargar() {
    try {
      const r = await api.get<{ esperas: EsperaMia[] }>("/espera/mias");
      setEsperas(r.esperas);
    } catch {
      setEsperas([]);
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  async function salir(id: number) {
    await api.del(`/espera/${id}`).catch(() => {});
    void cargar();
  }

  if (!esperas) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t("wait.mine")}</h3>
      {esperas.length === 0 ? (
        <p className="muted small">{t("wait.empty")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {esperas.map((e) => (
            <li
              key={e.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,.08)",
                flexWrap: "wrap",
              }}
            >
              <span>
                <b>{e.fecha}</b> · {e.servicio.nombreServicio} · {e.peluquero.nombre}
                {e.horaDesde && e.horaHasta && (
                  <span className="muted small">
                    {" "}
                    ({e.horaDesde}–{e.horaHasta})
                  </span>
                )}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={e.avisadoEn ? "success small" : "muted small"}>
                  {e.avisadoEn ? t("wait.notified") : t("wait.waiting")}
                </span>
                <button className="ghost small" onClick={() => salir(e.id)}>
                  {t("wait.leave")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Cola de un día concreto, para el negocio: demanda real sin hueco. */
export function ColaEspera({ peluqueroId, fecha }: { peluqueroId: number; fecha: string }) {
  const { t } = useT();
  const [cola, setCola] = useState<
    {
      id: number;
      cliente: { nombre: string; telefono: string };
      servicio: { nombreServicio: string };
    }[]
  >([]);

  useEffect(() => {
    if (!fecha) return;
    api
      .get<{ cola: typeof cola }>(`/espera/cola?peluqueroId=${peluqueroId}&fecha=${fecha}`)
      .then((r) => setCola(r.cola))
      .catch(() => setCola([]));
  }, [peluqueroId, fecha]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4>
        {t("wait.queue")} · {fecha}
      </h4>
      <p className="small muted">{t("wait.queueHelp")}</p>
      {cola.length === 0 ? (
        <p className="muted small">{t("wait.queueEmpty")}</p>
      ) : (
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {cola.map((c) => (
            <li key={c.id} style={{ padding: "4px 0" }}>
              {c.cliente.nombre} · {c.servicio.nombreServicio}{" "}
              <a href={`tel:${c.cliente.telefono}`} className="small">
                {c.cliente.telefono}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
