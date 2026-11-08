import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// La única tarea que queda en manos del dueño del proyecto es rellenar los
// .env. Si una variable nueva no aparece en las plantillas, nadie sabrá que
// existe hasta que algo no funcione en producción. Este test lo impide.

const raiz = resolve(process.cwd());
const leer = (p: string) => readFileSync(resolve(raiz, p), "utf8");

/** Nombres de variable que declara el esquema de Zod en config/env.ts. */
function variablesDelEsquema(): string[] {
  const fuente = leer("src/config/env.ts");
  const inicio = fuente.indexOf("const schema = z.object({");
  const fin = fuente.indexOf("const parsed = schema.safeParse");
  const bloque = fuente.slice(inicio, fin);
  return [...bloque.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/** Nombres de variable presentes en un fichero .env (comentados o no). */
function variablesDePlantilla(ruta: string): Set<string> {
  const fuente = leer(ruta);
  return new Set([...fuente.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

// Variables que a propósito NO van en las plantillas.
const EXCLUIDAS = new Set([
  // La define el proveedor (Render, Railway...) al crear la base de datos.
  "DIRECT_URL",
  // Escotilla solo para staging: documentarla invita a usarla en producción.
  "PERMITIR_MODO_DEMO",
]);

describe("plantillas .env", () => {
  const esquema = variablesDelEsquema();

  it("el esquema de configuración se ha podido leer", () => {
    expect(esquema.length).toBeGreaterThan(40);
    expect(esquema).toContain("DATABASE_URL");
    expect(esquema).toContain("JWT_SECRET");
  });

  it(".env.example documenta todas las variables", () => {
    const plantilla = variablesDePlantilla(".env.example");
    const faltan = esquema.filter((v) => !plantilla.has(v) && !EXCLUIDAS.has(v));
    expect(faltan, `Sin documentar en .env.example: ${faltan.join(", ")}`).toEqual([]);
  });

  it(".env.production.example documenta todas las variables", () => {
    const plantilla = variablesDePlantilla(".env.production.example");
    const faltan = esquema.filter((v) => !plantilla.has(v) && !EXCLUIDAS.has(v));
    expect(faltan, `Sin documentar en .env.production.example: ${faltan.join(", ")}`).toEqual([]);
  });

  it("las plantillas no traen secretos reales por accidente", () => {
    for (const ruta of [".env.example", ".env.production.example"]) {
      const fuente = leer(ruta);
      // Claves de verdad de Stripe/PayPal/AWS: nunca deben acabar en el repo.
      expect(fuente, ruta).not.toMatch(/sk_live_[A-Za-z0-9]/);
      expect(fuente, ruta).not.toMatch(/sk_test_[A-Za-z0-9]{10}/);
      expect(fuente, ruta).not.toMatch(/whsec_[A-Za-z0-9]{10}/);
      expect(fuente, ruta).not.toMatch(/AKIA[A-Z0-9]{10}/);
    }
  });

  it("la plantilla del frontend documenta sus VITE_*", () => {
    // El frontend solo puede leer variables con prefijo VITE_, y sin la clave
    // pública de Stripe el cliente no ve el formulario de tarjeta.
    const fuente = leer("../frontend/.env.production.example");
    expect(fuente).toMatch(/VITE_API_URL=/);
    expect(fuente).toMatch(/VITE_STRIPE_PUBLISHABLE_KEY=/);
  });
});
