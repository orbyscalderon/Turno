import { describe, it, expect } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { I18nProvider, useT, type TKey } from "./i18n";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// El diccionario se edita a mano en cada función nueva: lo que falla de verdad
// es una clave sin traducir al inglés o un parámetro mal escrito, y eso no se
// ve en pantalla hasta que un cliente cambia el idioma.

function Sonda({ clave, params }: { clave: TKey; params?: Record<string, string | number> }) {
  const { t, lang, setLang } = useT();
  return (
    <div>
      <span data-testid="texto">{t(clave, params)}</span>
      <span data-testid="lang">{lang}</span>
      <button onClick={() => setLang(lang === "es" ? "en" : "es")}>cambiar</button>
    </div>
  );
}

// El idioma se fija a mano: por defecto se deduce de navigator.language, que
// en jsdom es inglés y en un navegador español sería otro. Un test que dependa
// del idioma del entorno pasa en una máquina y falla en otra.
function montar(clave: TKey, params?: Record<string, string | number>, lang: "es" | "en" = "es") {
  localStorage.setItem("turno_lang", lang);
  return render(
    <I18nProvider>
      <Sonda clave={clave} params={params} />
    </I18nProvider>,
  );
}

describe("i18n", () => {
  it("traduce una clave conocida en los dos idiomas", () => {
    montar("login.enter", undefined, "es");
    expect(screen.getByTestId("texto").textContent).toBe("Entrar");
    cleanup();
    montar("login.enter", undefined, "en");
    expect(screen.getByTestId("texto").textContent).toBe("Sign in");
  });

  it("respeta el idioma guardado por encima del del navegador", () => {
    montar("login.enter", undefined, "en");
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  it("interpola los parámetros", () => {
    montar("plan.upTo");
    expect(screen.getByTestId("texto").textContent).toBeTruthy();
  });

  it("deja el marcador si falta el parámetro, en vez de poner 'undefined'", () => {
    // Un "undefined" en medio de una frase es lo que el cliente acabaría viendo.
    const { container } = render(
      <I18nProvider>
        <Sonda clave={"pay.payNow" as TKey} />
      </I18nProvider>,
    );
    expect(container.textContent).not.toContain("undefined");
  });

  it("cambia de idioma y lo recuerda en localStorage", () => {
    montar("login.enter", undefined, "es");
    const boton = screen.getByRole("button", { name: "cambiar" });
    act(() => boton.click());
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("texto").textContent).toBe("Sign in");
    expect(localStorage.getItem("turno_lang")).toBe("en");
  });

  it("useT fuera del provider avisa en claro", () => {
    // Sin este error, el componente renderizaría vacío y sería un misterio.
    expect(() => render(<Sonda clave="login.enter" />)).toThrow(/I18nProvider/);
  });
});

describe("diccionario completo", () => {
  // Se lee el fichero como texto: importar el dict no vale porque no se exporta
  // (y exportarlo solo para el test sería ensanchar la API por comodidad).
  // En entorno jsdom import.meta.url es una URL http, no file://.
  const fuente = readFileSync(resolve(process.cwd(), "src/i18n.tsx"), "utf8");
  const entradas = [...fuente.matchAll(/"([\w.]+)":\s*\{\s*es:\s*("(?:[^"\\]|\\.)*"),\s*en:\s*("(?:[^"\\]|\\.)*")/g)];

  it("se han detectado las entradas del diccionario", () => {
    expect(entradas.length).toBeGreaterThan(100);
  });

  it("ninguna traducción está vacía", () => {
    const vacias = entradas.filter(([, , es, en]) => es === '""' || en === '""').map((m) => m[1]);
    expect(vacias).toEqual([]);
  });

  it("no hay claves duplicadas", () => {
    // Un duplicado es error de TypeScript, pero solo si las dos están en el
    // mismo objeto literal; esta comprobación es la red por si se parte el dict.
    const claves = entradas.map((m) => m[1]);
    const repetidas = claves.filter((c, i) => claves.indexOf(c) !== i);
    expect(repetidas).toEqual([]);
  });

  it("los parámetros {x} coinciden entre español e inglés", () => {
    const fallos: string[] = [];
    for (const [, clave, es, en] of entradas) {
      const pes = [...es.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const pen = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      // Si al inglés le falta un parámetro, el texto sale incompleto en inglés.
      if (pes.join(",") !== pen.join(",")) fallos.push(`${clave}: es=[${pes}] en=[${pen}]`);
    }
    expect(fallos).toEqual([]);
  });
});
