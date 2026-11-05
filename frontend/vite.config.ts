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
    // Trozos separados para que el bundle de la app no arrastre todo de golpe.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          stripe: ["@stripe/stripe-js", "@stripe/react-stripe-js"],
          mapa: ["leaflet"],
        },
      },
    },
  },
});
