import { useEffect, useState } from "react";

// Enrutado mínimo basado en el History API.
//
// Antes se leía `window.location.pathname` una sola vez y cualquier navegación
// era un <a href> que RECARGABA toda la aplicación (perdiendo estado y volviendo
// a descargar el bundle). Con esto las rutas son compartibles (SEO, enlaces de
// WhatsApp) y la navegación no recarga nada.

/** Navega sin recargar la página. */
export function navegar(ruta: string, reemplazar = false) {
  if (reemplazar) window.history.replaceState({}, "", ruta);
  else window.history.pushState({}, "", ruta);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

/** Ruta actual (pathname + query), reactiva a atrás/adelante del navegador. */
export function useRuta(): { path: string; query: URLSearchParams } {
  const leer = () => ({
    path: window.location.pathname,
    query: new URLSearchParams(window.location.search),
  });
  const [ruta, setRuta] = useState(leer);

  useEffect(() => {
    const alCambiar = () => setRuta(leer());
    window.addEventListener("popstate", alCambiar);
    return () => window.removeEventListener("popstate", alCambiar);
  }, []);

  return ruta;
}

/**
 * Enlace interno: navega sin recargar pero sigue siendo un <a href> real, que es
 * lo que necesitan los buscadores, el "abrir en pestaña nueva" y el botón atrás.
 */
export function Link({
  href,
  children,
  className,
  style,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      className={className}
      style={style}
      onClick={(e) => {
        // Respeta ctrl/cmd+clic y clic con el botón central.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navegar(href);
      }}
    >
      {children}
    </a>
  );
}
