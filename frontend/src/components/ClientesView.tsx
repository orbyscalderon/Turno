import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";

// Módulo CLIENTES (CRM básico del negocio).
interface Cliente { id: string; nombre: string; telefono: string | null; email: string | null; direccion: string | null; notas: string | null; puntos: number }

export function ClientesView({ negocio, loyalty = false }: { negocio: Negocio; loyalty?: boolean }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ nombre: "", telefono: "", email: "", direccion: "", notas: "" });
  const [error, setError] = useState("");

  function cargar() {
    api.get<{ clientes: Cliente[] }>(`/clientes?negocioId=${negocio.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) => setClientes(r.clientes)).catch(() => {});
  }
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [negocio.id, q]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/clientes", { ...f, negocioId: negocio.id }); setF({ nombre: "", telefono: "", email: "", direccion: "", notas: "" }); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }
  async function puntos(id: string, delta: number) { await api.post(`/clientes/${id}/puntos`, { delta }); cargar(); }

  return (
    <div className="card">
      <div className="row spread">
        <h2>👥 Clientes</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? "Cerrar" : "+ Cliente"}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <div className="grid grid-2">
            <div><label>Nombre</label><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></div>
            <div><label>Teléfono</label><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
            <div><label>Email</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div><label>Dirección</label><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
          </div>
          <label>Notas</label>
          <input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} />
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>Guardar cliente</button>
        </form>
      )}
      <input placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 10 }} />
      {clientes.map((c) => (
        <div className="list-item" key={c.id}>
          <div><strong>{c.nombre}</strong><br /><span className="muted small">{[c.telefono, c.email, c.direccion].filter(Boolean).join(" · ") || "—"}</span></div>
          {loyalty && (
            <div className="row" style={{ alignItems: "center", gap: 6 }}>
              <span className="badge ok">⭐ {c.puntos}</span>
              <button className="ghost small" onClick={() => puntos(c.id, 1)}>+1</button>
              <button className="ghost small" onClick={() => puntos(c.id, -1)}>−1</button>
            </div>
          )}
        </div>
      ))}
      {clientes.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>Sin clientes.</p>}
    </div>
  );
}
