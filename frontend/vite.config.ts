import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Redirige las llamadas /api y las imágenes /uploads al backend en desarrollo.
      "/api": "http://localhost:4000",
      "/uploads": "http://localhost:4000",
    },
  },
});
