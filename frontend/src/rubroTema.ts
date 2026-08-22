// Identidad visual por rubro (gradiente + color de acento) para las landings.
export interface RubroTema { grad: string; accent: string }

const TEMAS: Record<string, RubroTema> = {
  barberia:       { grad: "linear-gradient(135deg,#2f7bff,#e11d2b)", accent: "#2f7bff" },
  taller:         { grad: "linear-gradient(135deg,#3b82f6,#0f172a)", accent: "#3b82f6" },
  restaurante:    { grad: "linear-gradient(135deg,#f97316,#b91c1c)", accent: "#f97316" },
  supermercado:   { grad: "linear-gradient(135deg,#16a34a,#064e3b)", accent: "#16a34a" },
  ferreteria:     { grad: "linear-gradient(135deg,#f59e0b,#7c2d12)", accent: "#f59e0b" },
  vape_shop:      { grad: "linear-gradient(135deg,#a855f7,#4c1d95)", accent: "#a855f7" },
  farmacia:       { grad: "linear-gradient(135deg,#06b6d4,#0e7490)", accent: "#06b6d4" },
  granja_avicola: { grad: "linear-gradient(135deg,#84cc16,#3f6212)", accent: "#84cc16" },
  prestamista:    { grad: "linear-gradient(135deg,#d4af37,#5b3a10)", accent: "#d4af37" },
};

export function rubroTema(slug: string): RubroTema {
  return TEMAS[slug] ?? { grad: "linear-gradient(135deg,#2f7bff,#12131a)", accent: "#2f7bff" };
}
