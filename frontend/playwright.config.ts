import { defineConfig, devices } from "@playwright/test";

// E2E de navegador. Requiere el frontend (5173) y backend (4000) corriendo,
// y los binarios de navegador instalados una vez: npx playwright install chromium
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  // En serie: los recorridos comparten los datos del seed (misma agenda del
  // profesional), así que en paralelo se pisarían entre ellos.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
