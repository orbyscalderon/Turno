import { useEffect, useRef } from "react";

// ID de cliente de Google (build-time). Si está vacío, el botón no se muestra.
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || "";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

// Carga el script de Google Identity Services una sola vez.
function cargarGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existente = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existente) {
      existente.addEventListener("load", () => resolve());
      existente.addEventListener("error", () => reject(new Error("No se pudo cargar Google")));
      return;
    }
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar Google"));
    document.head.appendChild(s);
  });
}

interface Props {
  onCredential: (credential: string) => void;
  texto?: "signin_with" | "signup_with" | "continue_with";
}

/**
 * Botón oficial "Iniciar sesión con Google". Renderiza null si no hay
 * VITE_GOOGLE_CLIENT_ID configurado (así el login normal sigue funcionando).
 */
export function GoogleButton({ onCredential, texto = "continue_with" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !ref.current) return;
    let cancelado = false;

    cargarGsi()
      .then(() => {
        if (cancelado || !ref.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r) => cbRef.current(r.credential),
        });
        ref.current.innerHTML = "";
        window.google.accounts.id.renderButton(ref.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: texto,
          width: 360,
          logo_alignment: "center",
        });
      })
      .catch(() => { /* sin conexión con Google: se ignora, queda el login normal */ });

    return () => { cancelado = true; };
  }, [texto]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 14px" }}>
        <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.14)" }} />
        <span className="small muted">o</span>
        <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.14)" }} />
      </div>
      <div ref={ref} style={{ display: "flex", justifyContent: "center" }} />
    </div>
  );
}
