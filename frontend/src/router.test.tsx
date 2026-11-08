import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { navegar, useRuta, Link } from "./router";

// El enrutado es propio (History API). Lo que hay que garantizar es que una
// navegación NO recarga la página: antes cada enlace recargaba el bundle entero
// y se perdía el estado, y eso no se nota en desarrollo con caché caliente.

function Sonda() {
  const { path, query } = useRuta();
  return (
    <div>
      <span data-testid="path">{path}</span>
      <span data-testid="q">{query.get("resena") ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useRuta", () => {
  it("lee la ruta y la query actuales", () => {
    window.history.replaceState({}, "", "/negocio/mi-barberia?resena=7");
    render(<Sonda />);
    expect(screen.getByTestId("path").textContent).toBe("/negocio/mi-barberia");
    expect(screen.getByTestId("q").textContent).toBe("7");
  });

  it("reacciona a navegar()", () => {
    render(<Sonda />);
    expect(screen.getByTestId("path").textContent).toBe("/");
    act(() => navegar("/precios"));
    expect(screen.getByTestId("path").textContent).toBe("/precios");
  });

  it("reacciona al popstate (atrás/adelante del navegador)", () => {
    render(<Sonda />);
    act(() => navegar("/terminos"));
    expect(screen.getByTestId("path").textContent).toBe("/terminos");

    // El atrás del navegador cambia la URL y emite popstate; en jsdom history.back()
    // no es síncrono, así que se reproduce el efecto que el hook debe escuchar.
    act(() => {
      window.history.replaceState({}, "", "/precios");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByTestId("path").textContent).toBe("/precios");
  });

  it("navegar con reemplazar no añade una entrada al historial", () => {
    const antes = window.history.length;
    act(() => navegar("/a", true));
    expect(window.history.length).toBe(antes);
    act(() => navegar("/b"));
    expect(window.history.length).toBeGreaterThan(antes);
  });
});

describe("Link", () => {
  it("es un <a href> real (buscadores, abrir en pestaña nueva)", () => {
    render(<Link href="/precios">Precios</Link>);
    const a = screen.getByRole("link", { name: "Precios" });
    expect(a).toHaveAttribute("href", "/precios");
  });

  it("un clic normal navega sin recargar", () => {
    render(
      <>
        <Link href="/precios">Precios</Link>
        <Sonda />
      </>,
    );
    act(() => screen.getByRole("link", { name: "Precios" }).click());
    expect(screen.getByTestId("path").textContent).toBe("/precios");
  });

  it("ctrl+clic NO lo intercepta (abrir en pestaña nueva debe funcionar)", () => {
    render(
      <>
        <Link href="/precios">Precios</Link>
        <Sonda />
      </>,
    );
    const a = screen.getByRole("link", { name: "Precios" });
    const evento = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    act(() => void a.dispatchEvent(evento));
    // No se navega en esta pestaña: lo hace el navegador abriendo otra.
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(evento.defaultPrevented).toBe(false);
  });

  it("ejecuta el onClick propio además de navegar", () => {
    const alPulsar = vi.fn();
    render(
      <Link href="/x" onClick={alPulsar}>
        X
      </Link>,
    );
    act(() => screen.getByRole("link", { name: "X" }).click());
    expect(alPulsar).toHaveBeenCalledOnce();
  });
});
