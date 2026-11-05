import { test, expect, type Page } from "@playwright/test";

// Recorridos completos sobre el navegador: ficha pública compartible y el ciclo
// reservar -> pagar -> validar el código en el local -> cita completada.
// Requiere backend (4000) y frontend (5173) arriba con el seed cargado y
// PAYMENT_PROVIDER=mock.

async function entrar(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /Iniciar sesión|Sign in/i }).first().click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill("password123");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/i }).click();
}

test.describe("ficha pública del negocio", () => {
  test("tiene URL propia, carga sin sesión y muestra sus datos", async ({ page }) => {
    // La URL es directa: es lo que el negocio comparte por WhatsApp o indexa Google.
    await page.goto("/negocio/barberia-el-corte-fino");

    await expect(page.getByRole("heading", { name: /Barbería El Corte Fino/i })).toBeVisible();
    await expect(page.getByText(/Calle Mayor 123/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Reservar en este negocio|Book at this/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Reseñas|Reviews)$/ })).toBeVisible();

    // El título de la página se adapta (vista previa al compartir el enlace).
    await expect(page).toHaveTitle(/Barbería El Corte Fino/i);
  });

  test("un negocio inexistente muestra aviso, no una pantalla en blanco", async ({ page }) => {
    await page.goto("/negocio/no-existe-este-negocio");
    await expect(page.getByText(/no está disponible|not available/i)).toBeVisible();
  });

  test("desde el buscador público se llega a la ficha sin recargar", async ({ page }) => {
    await page.goto("/");
    await page.getByText(/Barbería El Corte Fino/i).first().click();
    await expect(page).toHaveURL(/\/negocio\/barberia-el-corte-fino/);
    await expect(page.getByRole("button", { name: /Reservar en este negocio|Book at this/i })).toBeVisible();
  });
});

test.describe("ciclo completo de la cita", () => {
  test("reservar, pagar la fianza y validar el código en el local", async ({ page }) => {
    // ---------- 1. El cliente reserva y paga ----------
    await entrar(page, "cliente@turno.app");
    await page.getByRole("button", { name: /Reservar cita|Book appointment/i }).click();

    // Negocio -> profesional -> servicio (tarjetas .biz-card en cada paso).
    await page.locator(".biz-card").filter({ hasText: /Barbería El Corte Fino/i }).first().click();
    await expect(page.getByRole("heading", { name: /Barbería El Corte Fino —/i })).toBeVisible();
    await page.locator(".biz-card").first().click();
    await expect(page.getByRole("heading", { name: /—/ })).toBeVisible();
    await page.locator(".biz-card").first().click();

    // Fecha: pasado mañana (día laborable dentro de la disponibilidad del seed).
    const d = new Date();
    d.setDate(d.getDate() + 2);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const fecha = d.toISOString().slice(0, 10);
    await page.locator('input[type="date"]').fill(fecha);

    // Primer hueco libre
    const hueco = page.locator("button.slot").first();
    await expect(hueco).toBeVisible({ timeout: 10000 });
    await hueco.click();

    // Resumen -> pagar. En modo mock el cobro se confirma solo.
    // El código se toma de la respuesta de la API: leerlo del historial cogería el
    // de otra cita (el cliente del seed acumula reservas de ejecuciones previas).
    const respuesta = page.waitForResponse(
      (r) => r.url().endsWith("/api/reservas") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Pagar y reservar|Pay and book/i }).click();
    const cuerpo = await (await respuesta).json();
    const codigo: string = cuerpo.reserva.codigoValidacion;
    expect(codigo).toMatch(/^[A-Z0-9]{8}$/);

    // Al confirmarse, la vista salta al historial con el código de validación.
    await expect(page.getByText(/Código de validación|Validation code/i).first()).toBeVisible({
      timeout: 15000,
    });

    // ---------- 2. El profesional valida el código ----------
    await page.getByRole("button", { name: /Salir|Log out/i }).click();
    await entrar(page, "peluquero1@turno.app");

    await page.getByRole("button", { name: /^(Agenda|Schedule)$/ }).click();
    await page.getByPlaceholder(/Código|Code/i).fill(codigo);
    await page.getByRole("button", { name: /^(Validar|Validate)$/ }).click();

    // La cita queda completada: es lo que habilita la reseña del cliente.
    await expect(page.getByText(/validada y completada|validated and completed/i)).toBeVisible({
      timeout: 15000,
    });

    // ---------- 3. El cliente ya puede reseñar ----------
    await page.getByRole("button", { name: /Salir|Log out/i }).click();
    await entrar(page, "cliente@turno.app");
    await page.getByRole("button", { name: /Mis reservas|My bookings/i }).click();
    await expect(page.getByText(/completada/i).first()).toBeVisible({ timeout: 15000 });
  });
});
