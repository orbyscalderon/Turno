import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El mismo proxy en `server` (npm run dev) y en `preview` (build servido en
// local y en el job de E2E del CI): sin él, el build previsualizado llamaría a
// /api contra el propio puerto 5173 y todo fallaría con 404.
const proxy = {
  "/api": "http://localhost:4000",
  "/uploads": "http://localhost:4000",
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 5173, proxy },
  build: {
    rollupOptions: {
      output: {
        // Trozos separados para que el bundle de la app no arrastre todo de golpe.
        // Vite 8 empaqueta con Rolldown, que sustituye el `manualChunks` de Rollup
        // por `codeSplitting.groups` (se agrupa por ruta del módulo, no por nombre
        // de paquete, así que las dependencias internas caen en el trozo correcto).
        codeSplitting: {
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "stripe", test: /[\\/]node_modules[\\/]@stripe[\\/]/ },
            { name: "mapa", test: /[\\/]node_modules[\\/]leaflet[\\/]/ },
          ],
        },
      },
    },
  },
});
