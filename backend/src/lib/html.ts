// Escapado de HTML. Obligatorio para cualquier dato que venga del usuario y se
// interpole en el HTML de un email (nombres, servicios, comentarios, motivos...).
// Sin esto, un nombre como `<a href="http://phishing">` acabaría renderizado en la
// bandeja de entrada del destinatario con el formato del remitente legítimo.
const MAPA: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(valor: unknown): string {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => MAPA[c]);
}
