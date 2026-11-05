/// <reference types="vite/client" />

interface ImportMetaEnv {
  // URL base del backend en producción (p. ej. https://turno-api.up.railway.app).
  // Vacío en desarrollo: se usan rutas relativas con el proxy de Vite.
  readonly VITE_API_URL?: string;
  // Clave PÚBLICA de Stripe (pk_live_... / pk_test_...). Necesaria para cobrar la
  // fianza con tarjeta. Si está vacía, el paso de pago avisa de que falta.
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
