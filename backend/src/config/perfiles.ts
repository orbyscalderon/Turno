// Catálogo de rubros (perfiles de negocio) para el onboarding y el motor de nicho.
// Derivado de config/profiles/*.json (fuente de verdad). Self-contained para desplegar con el backend.

export interface Perfil {
  slug: string;
  nombre: string;
  categoria: string;
  emoji: string;
  modoPrimario: string;
  descripcion: string;
  modulos: string[];
}

export const PERFILES: Perfil[] = [
  { slug: "barberia", nombre: "Barbería / Salón", categoria: "servicios", emoji: "💈", modoPrimario: "appointments",
    descripcion: "Agenda por profesional, comisiones por corte y venta cruzada de productos.",
    modulos: ["appointments", "employees", "pos", "inventory", "credit", "customers", "loyalty", "purchasing", "expenses", "cash", "taxes", "storefront"] },
  { slug: "taller", nombre: "Taller / Servicio Técnico", categoria: "servicios", emoji: "🔧", modoPrimario: "appointments",
    descripcion: "Recepción de equipos, diagnóstico, cotización, repuestos y garantía.",
    modulos: ["appointments", "service_orders", "employees", "pos", "inventory", "credit", "customers", "purchasing", "expenses", "cash", "taxes", "storefront"] },
  { slug: "restaurante", nombre: "Restaurante / Bar", categoria: "alimentos", emoji: "🍽️", modoPrimario: "tables",
    descripcion: "Mesas, comandas a cocina, modificadores por plato y descuento de insumos por receta.",
    modulos: ["tables", "pos", "inventory", "credit", "customers", "loyalty", "purchasing", "expenses", "cash", "taxes", "storefront", "employees"] },
  { slug: "supermercado", nombre: "Supermercado / Colmado", categoria: "alimentos", emoji: "🛒", modoPrimario: "quick_pos",
    descripcion: "Alta rotación, venta por peso con balanza, códigos de barra y fiado de barrio.",
    modulos: ["pos", "inventory", "credit", "customers", "loyalty", "purchasing", "expenses", "cash", "taxes", "storefront", "employees"] },
  { slug: "ferreteria", nombre: "Ferretería / Materiales", categoria: "retail", emoji: "🔨", modoPrimario: "variant_inventory",
    descripcion: "Venta fraccionada por metro, rollo o unidad, con crédito a constructores y cotizaciones.",
    modulos: ["pos", "inventory", "credit", "customers", "loyalty", "purchasing", "expenses", "cash", "taxes", "storefront", "employees"] },
  { slug: "vape_shop", nombre: "Tienda de Vapes", categoria: "retail", emoji: "💨", modoPrimario: "variant_inventory",
    descripcion: "Retail con muchos SKU por sabor y nicotina, control de edad y garantía.",
    modulos: ["pos", "inventory", "credit", "customers", "loyalty", "purchasing", "expenses", "cash", "taxes", "storefront", "service_orders", "employees"] },
  { slug: "farmacia", nombre: "Farmacia / Botica", categoria: "salud", emoji: "💊", modoPrimario: "search_first",
    descripcion: "Catálogo grande buscado por nombre o principio activo, con trazabilidad de lote y vencimiento.",
    modulos: ["pos", "inventory", "credit", "customers", "loyalty", "purchasing", "expenses", "cash", "taxes", "storefront", "employees"] },
  { slug: "granja_avicola", nombre: "Granja Avícola", categoria: "agro", emoji: "🥚", modoPrimario: "biological_lots",
    descripcion: "Producción por lote/camada con mortalidad, conversión alimenticia y costeo por kg.",
    modulos: ["agro", "pos", "inventory", "credit", "customers", "purchasing", "expenses", "cash", "taxes", "storefront", "employees"] },
  { slug: "prestamista", nombre: "Prestamista / Financiera", categoria: "financiero", emoji: "💵", modoPrimario: "lending",
    descripcion: "Préstamos con cronograma, interés, mora y cobranza en ruta. El producto es el dinero.",
    modulos: ["lending", "credit", "customers", "pos", "expenses", "cash", "taxes", "employees"] },
];

// Etiquetas legibles de cada módulo.
export const MODULO_LABELS: Record<string, string> = {
  appointments: "Reservas y agenda",
  service_orders: "Órdenes de servicio",
  tables: "Mesas y comandas",
  pos: "Punto de venta",
  inventory: "Inventario",
  credit: "Fiado / crédito",
  lending: "Préstamos",
  customers: "Clientes",
  loyalty: "Fidelización",
  purchasing: "Compras",
  expenses: "Gastos",
  cash: "Caja y arqueo",
  taxes: "Impuestos",
  storefront: "Tienda online",
  employees: "Empleados",
  agro: "Producción agro",
};

// Módulos ya funcionales en la plataforma hoy (el resto llega por roadmap del motor de nicho).
export const MODULOS_DISPONIBLES = ["appointments", "employees", "customers"];

export function getPerfil(slug: string | null | undefined): Perfil | undefined {
  if (!slug) return undefined;
  return PERFILES.find((p) => p.slug === slug);
}

export const SLUGS_PERFIL = PERFILES.map((p) => p.slug);
