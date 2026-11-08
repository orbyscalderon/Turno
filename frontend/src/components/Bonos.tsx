import { useEffect, useState } from "react";
import { api, ApiError, formatPrecio, type Servicio } from "../api";
import { useT } from "../i18n";

// Bonos de sesiones. El dinero del paquete se cobra EN EL LOCAL: aquí solo se
// lleva la cuenta de las sesiones, así la plataforma no retiene dinero de
// clientes por servicios que presta un tercero.

interface BonoMio {
  id: number;
  nombre: string;
  negocio: { nombreComercial: string; slug: string };
  servicio: { id: number; nombreServicio: string };
  sesionesTotales: number;
  sesionesUsadas: number;
  restantes: number;
  expiraEn: string | null;
  caducado: boolean;
  agotado: boolean;
}

interface Paquete {
  id: number;
  nombre: string;
  sesiones: number;
  precio: string | number;
  moneda: string;
  validezDias: number | null;
  activo: boolean;
  servicio?: { id: number; nombreServicio: string };
}

/** Bonos del cliente, con las sesiones que le quedan. */
export function MisBonos() {
  const { t } = useT();
  const [bonos, setBonos] = useState<BonoMio[] | null>(null);

  useEffect(() => {
    api
      .get<{ bonos: BonoMio[] }>("/bonos/mios")
      .then((r) => setBonos(r.bonos))
      .catch(() => setBonos([]));
  }, []);

  if (!bonos) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t("bono.mine")}</h3>
      {bonos.length === 0 ? (
        <p className="muted small">{t("bono.empty")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {bonos.map((b) => {
            const inutil = b.caducado || b.agotado;
            return (
              <li
                key={b.id}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(255,255,255,.08)",
                  opacity: inutil ? 0.55 : 1,
                }}
              >
                <b>{b.nombre}</b> <span className="muted small">· {b.negocio.nombreComercial}</span>
                <div className="small">
                  {t("bono.remaining", { n: b.restantes, total: b.sesionesTotales })}
                  {b.expiraEn && (
                    <>
                      {" · "}
                      {b.caducado ? (
                        <span className="error">{t("bono.expired")}</span>
                      ) : (
                        t("bono.expires", { fecha: b.expiraEn.slice(0, 10) })
                      )}
                    </>
                  )}
                  {b.agotado && <> · {t("bono.exhausted")}</>}
                </div>
                {/* Barra de consumo: se ve de un vistazo cuánto queda. */}
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "rgba(255,255,255,.12)",
                    marginTop: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(b.sesionesUsadas / b.sesionesTotales) * 100}%`,
                      height: "100%",
                      background: "var(--acc, #8b5cf6)",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Panel del negocio: crear paquetes y registrar bonos a clientes. */
export function PaquetesNegocio({ negocioId }: { negocioId: string }) {
  const { t } = useT();
  // Los servicios que se pueden empaquetar son los del equipo aceptado. Se
  // cargan aquí para que el panel del dueño no tenga que pasárselos.
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  const [resumen, setResumen] = useState<{
    vendidos: number;
    sesionesVendidas: number;
    sesionesUsadas: number;
    ingresos: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [nuevo, setNuevo] = useState({
    nombre: "",
    servicioId: 0,
    sesiones: 10,
    precio: 0,
    validezDias: "" as string,
  });
  const [emision, setEmision] = useState({ paqueteId: 0, email: "" });

  async function cargar() {
    try {
      const [p, n] = await Promise.all([
        api.get<{ paquetes: Paquete[] }>(`/bonos/paquetes?negocioId=${negocioId}`),
        api.get<{ resumen: typeof resumen }>(`/bonos/negocio/${negocioId}`),
      ]);
      setPaquetes(p.paquetes);
      setResumen(n.resumen);
    } catch {
      /* el negocio puede no tener nada todavía */
    }

    // Servicios del equipo: un paquete solo puede ser de un servicio propio.
    try {
      const eq = await api.get<{
        miembros: { estadoAprobacion: string; usuario: { id: number } }[];
      }>(`/negocios/${negocioId}/equipo`);
      const activos = eq.miembros.filter((m) => m.estadoAprobacion === "aceptado");
      const listas = await Promise.all(
        activos.map((m) =>
          api
            .get<{ servicios: Servicio[] }>(`/servicios/peluquero/${m.usuario.id}`)
            .then((r) => r.servicios)
            .catch(() => []),
        ),
      );
      setServicios(listas.flat());
    } catch {
      setServicios([]);
    }
  }
  useEffect(() => {
    void cargar();
  }, [negocioId]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAviso("");
    try {
      await api.post("/bonos/paquetes", {
        negocioId,
        servicioId: Number(nuevo.servicioId),
        nombre: nuevo.nombre,
        sesiones: Number(nuevo.sesiones),
        precio: Number(nuevo.precio),
        moneda: servicios.find((s) => s.id === Number(nuevo.servicioId))?.moneda ?? "EUR",
        // Vacío significa "no caduca", no cero.
        validezDias: nuevo.validezDias ? Number(nuevo.validezDias) : null,
      });
      setNuevo({ nombre: "", servicioId: 0, sesiones: 10, precio: 0, validezDias: "" });
      void cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAviso("");
    try {
      await api.post("/bonos/emitir", {
        paqueteId: Number(emision.paqueteId),
        clienteEmail: emision.email,
      });
      setAviso(t("bono.issued"));
      setEmision({ paqueteId: 0, email: "" });
      void cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  async function desactivar(id: number) {
    await api.patch(`/bonos/paquetes/${id}`, { activo: false }).catch(() => {});
    void cargar();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>{t("bono.packages")}</h3>
      <p className="small muted">{t("bono.packagesHelp")}</p>

      {resumen && resumen.vendidos > 0 && (
        <p className="small">
          {t("bono.sold", {
            vendidos: resumen.vendidos,
            usadas: resumen.sesionesUsadas,
            sesiones: resumen.sesionesVendidas,
            ingresos: formatPrecio(resumen.ingresos, paquetes[0]?.moneda ?? "EUR"),
          })}
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {aviso && (
        <p className="success" role="status">
          {aviso}
        </p>
      )}

      {paquetes.length === 0 ? (
        <p className="muted small">{t("bono.noPackages")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0" }}>
          {paquetes.map((p) => (
            <li
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                flexWrap: "wrap",
              }}
            >
              <span>
                <b>{p.nombre}</b> · {p.sesiones} {t("bono.sessions").toLowerCase()} ·{" "}
                {formatPrecio(p.precio, p.moneda)}
                {p.servicio && <span className="muted small"> · {p.servicio.nombreServicio}</span>}
              </span>
              <button className="ghost small" onClick={() => desactivar(p.id)}>
                {t("bono.deactivate")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Registrar un bono: solo tiene sentido si ya hay paquetes. */}
      {paquetes.length > 0 && (
        <form onSubmit={emitir} style={{ marginTop: 10 }}>
          <h4>{t("bono.issue")}</h4>
          <label htmlFor="bono-paq">{t("bono.packages")}</label>
          <select
            id="bono-paq"
            value={emision.paqueteId}
            onChange={(e) => setEmision({ ...emision, paqueteId: Number(e.target.value) })}
            required
          >
            <option value={0} disabled>
              {t("common.choose")}
            </option>
            {paquetes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} ({p.sesiones})
              </option>
            ))}
          </select>
          <label htmlFor="bono-email">{t("bono.issueEmail")}</label>
          <input
            id="bono-email"
            type="email"
            value={emision.email}
            onChange={(e) => setEmision({ ...emision, email: e.target.value })}
            required
          />
          <button className="primary" type="submit" style={{ marginTop: 10 }}>
            {t("bono.issueDo")}
          </button>
        </form>
      )}

      <details style={{ marginTop: 16 }}>
        <summary>{t("bono.newPackage")}</summary>
        <form onSubmit={crear} style={{ marginTop: 10 }}>
          <label htmlFor="paq-nombre">{t("bono.name")}</label>
          <input
            id="paq-nombre"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            required
          />
          <label htmlFor="paq-serv">{t("bono.service")}</label>
          <select
            id="paq-serv"
            value={nuevo.servicioId}
            onChange={(e) => setNuevo({ ...nuevo, servicioId: Number(e.target.value) })}
            required
          >
            <option value={0} disabled>
              {t("common.choose")}
            </option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombreServicio}
              </option>
            ))}
          </select>
          <label htmlFor="paq-ses">{t("bono.sessions")}</label>
          <input
            id="paq-ses"
            type="number"
            min={2}
            max={100}
            value={nuevo.sesiones}
            onChange={(e) => setNuevo({ ...nuevo, sesiones: Number(e.target.value) })}
            required
          />
          <label htmlFor="paq-precio">{t("bono.price")}</label>
          <input
            id="paq-precio"
            type="number"
            min={0}
            step="0.01"
            value={nuevo.precio}
            onChange={(e) => setNuevo({ ...nuevo, precio: Number(e.target.value) })}
            required
          />
          <label htmlFor="paq-val">{t("bono.validity")}</label>
          <input
            id="paq-val"
            type="number"
            min={1}
            value={nuevo.validezDias}
            onChange={(e) => setNuevo({ ...nuevo, validezDias: e.target.value })}
          />
          <button className="primary" type="submit" style={{ marginTop: 10 }}>
            {t("bono.create")}
          </button>
        </form>
      </details>
    </div>
  );
}
