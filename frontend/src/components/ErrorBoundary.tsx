import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

// Captura errores de render para evitar la "pantalla en blanco" y ofrecer recuperación.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Captura de errores lista para Sentry: si defines VITE_SENTRY_DSN, aquí se enviaría.
    // Ejemplo: if (import.meta.env.VITE_SENTRY_DSN) Sentry.captureException(error);
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="container" style={{ maxWidth: 480, marginTop: 60 }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 44 }}>😵</div>
            <h1>Algo salió mal</h1>
            <p className="muted">Ocurrió un error inesperado. Puedes recargar la página.</p>
            <button className="primary" style={{ marginTop: 12 }} onClick={() => window.location.assign("/")}>
              Recargar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
