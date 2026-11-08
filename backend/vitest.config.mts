import { defineConfig } from "vitest/config";

// Extensión .mts a propósito: con .ts el cargador nativo de Vite lo trata como
// CommonJS y avisa de que el import/export dejará de funcionar.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Los tests tocan la misma base de datos: en paralelo se pisan entre sí.
    fileParallelism: false,
  },
});
