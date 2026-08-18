import { test, expect } from "@playwright/test";

// Smoke test del recorrido público + login del cliente.
// Ejecuta con: npx playwright test  (necesita 5173 y 4000 arriba)

test("la landing pública carga y muestra el buscador", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Buscar|Search/i })).toBeVisible();
  await expect(page.getByText(/Barbería El Corte Fino/i)).toBeVisible();
});

test("la página de precios muestra los planes", async ({ page }) => {
  await page.goto("/precios");
  await expect(page.getByRole("heading", { name: /Básico/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pro/i })).toBeVisible();
  // Por defecto muestra el precio anual (2 meses gratis).
  await expect(page.getByText(/\$250/)).toBeVisible();
  await expect(page.getByText(/\$500/)).toBeVisible();
});

test("el cliente puede iniciar sesión y ver sus reservas", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Iniciar sesión|Sign in/i }).first().click();
  await page.locator('input[type="email"]').fill("cliente@turno.app");
  await page.locator('input[type="password"]').fill("password123");
  await page.getByRole("button", { name: /^(Entrar|Sign in)$/i }).click();
  await expect(page.getByRole("button", { name: /Reservar cita|Book appointment/i })).toBeVisible();
});
