// Fondo animado tipo iOS: manchas de color azul/rojo que se desplazan en bucle.
// Fijo detrás de todo el contenido. Respeta prefers-reduced-motion (CSS).
export function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora-blob b1" />
      <span className="aurora-blob b2" />
      <span className="aurora-blob b3" />
      <span className="aurora-blob b4" />
    </div>
  );
}
