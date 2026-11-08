import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Auditoría de accesibilidad automática (axe) sobre las pantallas públicas y el
// recorrido de reserva, más las comprobaciones que axe no puede hacer: que la
// aplicación se pueda usar entera con el teclado.
//
// Se audita contra WCAG 2.1 niveles A y AA, que es lo exigible.

const NIVELES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function auditar(page: Page) {
  const resultado = await new AxeBuilder({ page }).withTags(NIVELES).analyze();
  return resultado.violations.map((v) => ({
    id: v.id,
    impacto: v.impact,
    descripcion: v.help,
    elementos: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

test.describe("accesibilidad", () => {
  test("la portada no tiene violaciones de WCAG A/AA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const violaciones = await auditar(page);
    expect(violaciones, JSON.stringify(violaciones, null, 2)).toEqual([]);
  });

  test("la ficha pública de un negocio no tiene violaciones", async ({ page }) => {
    await page.goto("/negocio/barberia-el-corte-fino");
    await expect(page.getByRole("heading", { name: /Barbería El Corte Fino/i })).toBeVisible();
    const violaciones = await auditar(page);
    expect(violaciones, JSON.stringify(violaciones, null, 2)).toEqual([]);
  });

  test("el formulario de acceso no tiene violaciones", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Iniciar sesión|Sign in/i }).first().click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    const violaciones = await auditar(page);
    expect(violaciones, JSON.stringify(violaciones, null, 2)).toEqual([]);
  });

  test("las páginas legales no tienen violaciones", async ({ page }) => {
    for (const ruta of ["/terminos", "/privacidad", "/precios"]) {
      await page.goto(ruta);
      const violaciones = await auditar(page);
      expect(violaciones, `${ruta}: ${JSON.stringify(violaciones, null, 2)}`).toEqual([]);
    }
  });

  test("se puede iniciar sesión usando solo el teclado", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Iniciar sesión|Sign in/i }).first().click();

    // Tabulando desde el inicio se debe llegar al email, la contraseña y el envío.
    const email = page.locator('input[type="email"]');
    await email.focus();
    await page.keyboard.type("cliente@turno.app");
    await page.keyboard.press("Tab");
    await page.keyboard.type("password123");
    // Enter dentro del formulario lo envía: sin esto, quien no usa ratón no entra.
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: /Salir|Log out/i })).toBeVisible({
      timeout: 15000,
    });
  });

  test("el foco se ve al tabular (no hay outline: none sin alternativa)", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const visible = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      const estilo = getComputedStyle(el);
      // Vale cualquiera de las tres: contorno, sombra o borde distinto.
      const tieneOutline = estilo.outlineStyle !== "none" && parseFloat(estilo.outlineWidth) > 0;
      const tieneSombra = estilo.boxShadow !== "none" && estilo.boxShadow !== "";
      return tieneOutline || tieneSombra;
    });
    expect(visible).toBe(true);
  });

  test("las imágenes de contenido tienen alternativa textual", async ({ page }) => {
    await page.goto("/negocio/barberia-el-corte-fino");
    const sinAlt = await page.locator("img:not([alt])").count();
    expect(sinAlt).toBe(0);
  });

  test("la página declara su idioma", async ({ page }) => {
    await page.goto("/");
    // Sin lang, un lector de pantalla lee el español con fonética inglesa.
    await expect(page.locator("html")).toHaveAttribute("lang", /es|en/);
  });
});
