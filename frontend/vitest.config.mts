import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Configuración aparte de vite.config.ts: los tests no necesitan el proxy ni el
// troceado del bundle, y así el build de producción no arrastra nada de test.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // e2e/ es de Playwright: si Vitest lo cogiera, intentaría ejecutarlo aquí.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
