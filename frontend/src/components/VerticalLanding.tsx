import { useEffect, useState } from "react";
import { api, type Perfil } from "../api";

// Landing de marketing por rubro (B2B). Ruta: /para/:slug
// El copy vive aquí; los módulos salen del catálogo del motor de nicho.
const COPY: Record<string, { titulo: string; sub: string }> = {
  barberia: { titulo: "Agenda llena, negocio ordenado", sub: "Reservas online 24/7, comisiones por profesional y venta de productos — todo en un solo lugar." },
  taller: { titulo: "Órdenes de servicio bajo control", sub: "Recibe equipos, diagnostica, cotiza, repara y entrega con trazabilidad total." },
  restaurante: { titulo: "Comandas y mesas sin enredos", sub: "Toma pedidos por mesa, cobra al instante y descuenta insumos por receta." },
  supermercado: { titulo: "El punto de venta para tu colmado", sub: "Cobra rápido con lector de barras, controla inventario y fía a tu barrio." },
  ferreteria: { titulo: "Vende por metro, rollo o unidad", sub: "Inventario fraccionado, crédito a maestros constructores y cotizaciones en segundos." },
  vape_shop: { titulo: "El POS para tu vape shop", sub: "Miles de SKU por sabor y nicotina, inventario y ventas sin fricción, control de edad." },
  farmacia: { titulo: "Tu botica, ordenada", sub: "Busca por nombre o principio activo y controla lotes y vencimientos." },
  granja_avicola: { titulo: "Controla tu granja por lote", sub: "Mortalidad, consumo de alimento y conversión (FCR) al día, con costeo real por kg." },
  prestamista: { titulo: "Gestiona tus préstamos sin cuadernos", sub: "Cronograma automático, cobros, mora y estado de cada deudor al instante." },
};

export function VerticalLanding({ slug, onRegistrar }: { slug: string; onRegistrar: (perfil: string) => void }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [disponibles, setDisponibles] = useState<string[]>([]);

  useEffect(() => {
    api.get<{ perfiles: Perfil[]; moduloLabels: Record<string, string>; modulosDisponibles: string[] }>("/perfiles")
      .then((r) => { setPerfil(r.perfiles.find((p) => p.slug === slug) ?? null); setLabels(r.moduloLabels); setDisponibles(r.modulosDisponibles); })
      .catch(() => {});
  }, [slug]);

  if (!perfil) return <div className="container"><p className="muted">Cargando…</p></div>;
  const copy = COPY[slug] ?? { titulo: perfil.nombre, sub: perfil.descripcion };

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <div className="mkt-hero">
        <div style={{ fontSize: 56, lineHeight: 1 }}>{perfil.emoji}</div>
        <h1 style={{ marginTop: 12 }}>{copy.titulo}</h1>
        <p className="sub">{copy.sub}</p>
        <div style={{ marginTop: 18 }}>
          <button className="primary" style={{ fontSize: 16, padding: "12px 28px" }} onClick={() => onRegistrar(slug)}>Empezar gratis</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>14 días de prueba · sin tarjeta</p>
      </div>

      <div className="card" style={{ marginTop: 8 }}>
        <h2 style={{ marginTop: 0 }}>Todo lo que incluye para {perfil.nombre}</h2>
        <div className="value-grid">
          {perfil.modulos.map((m) => (
            <div className="value-card" key={m}>
              <span className="v-emoji">{disponibles.includes(m) ? "✅" : "🔜"}</span>
              <h3 style={{ fontSize: 15 }}>{labels[m] ?? m}</h3>
              <p className="muted small">{disponibles.includes(m) ? "Disponible" : "Próximamente"}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <h2>¿Listo para digitalizar tu {perfil.nombre.toLowerCase()}?</h2>
        <button className="primary" style={{ marginTop: 10 }} onClick={() => onRegistrar(slug)}>Crear mi cuenta</button>
        <p className="muted small" style={{ marginTop: 10 }}>
          ¿Otro tipo de negocio? <a href="/soluciones">Ver todas las soluciones</a>
        </p>
      </div>
    </div>
  );
}
