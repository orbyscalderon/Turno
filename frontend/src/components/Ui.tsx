import type { ReactNode } from "react";

// Tarjeta de métrica con acento de color y opcional icono.
export function Stat({ label, value, icon, variant }: { label: string; value: ReactNode; icon?: string; variant?: "accent" | "green" }) {
  return (
    <div className={`stat ${variant ?? ""}`}>
      {icon && <span className="stat-icon">{icon}</span>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// Estado vacío amistoso con emoji flotante.
export function Empty({ emoji = "✨", children }: { emoji?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-emoji float-emoji">{emoji}</span>
      <div>{children}</div>
    </div>
  );
}

// Skeletons con shimmer para estados de carga (sin layout shift).
export function SkeletonCards({ n = 3 }: { n?: number }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div className="skeleton skel-card" key={i} />
      ))}
    </div>
  );
}

export function SkeletonLines({ n = 3 }: { n?: number }) {
  return (
    <div className="card">
      {Array.from({ length: n }).map((_, i) => (
        <div className={`skeleton skel-line ${i === n - 1 ? "short" : ""}`} key={i} />
      ))}
    </div>
  );
}
