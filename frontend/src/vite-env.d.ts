/// <reference types="vite/client" />

interface ImportMetaEnv {
  // URL base del backend en producción (p. ej. https://turno-api.up.railway.app).
  // Vacío en desarrollo: se usan rutas relativas con el proxy de Vite.
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
