import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Validación estricta de la configuración al arrancar: si falta algo crítico, falla rápido.
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET debe tener al menos 16 caracteres"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  MAX_PELUQUEROS_POR_NEGOCIO: z.coerce.number().default(5),
  FIANZA_RESERVA_USD: z.coerce.number().default(2),
  // Comisión de la plataforma sobre la fianza (el resto va al negocio vía Stripe Connect).
  FIANZA_COMISION_USD: z.coerce.number().default(0.5),
  // Calendario de depósitos (payouts) de las cuentas conectadas de los negocios.
  STRIPE_PAYOUT_INTERVAL: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
  STRIPE_PAYOUT_ANCHOR: z.coerce.number().int().min(1).max(31).default(1), // día del mes (monthly)
  // Comisión que cobra Stripe por transacción (para calcular el reparto real).
  STRIPE_FEE_PCT: z.coerce.number().default(2.9),
  STRIPE_FEE_FIJO: z.coerce.number().default(0.3),
  // Quién asume la comisión de Stripe: negocio | plataforma | compartido (50/50) | cliente (encima de la fianza).
  FEE_STRIPE_REPARTO: z.enum(["negocio", "plataforma", "compartido", "cliente"]).default("compartido"),
  // Minutos que se mantiene bloqueado el slot esperando el pago antes de liberarlo.
  RESERVA_HOLD_MINUTOS: z.coerce.number().default(15),
  PAYMENT_PROVIDER: z.enum(["mock", "stripe", "paypal"]).default("mock"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  // Precios recurrentes en Stripe por plan e intervalo (price_...).
  STRIPE_PRICE_BASICO_MENSUAL: z.string().default(""),
  STRIPE_PRICE_BASICO_ANUAL: z.string().default(""),
  STRIPE_PRICE_PRO_MENSUAL: z.string().default(""),
  STRIPE_PRICE_PRO_ANUAL: z.string().default(""),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  APP_URL: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("uploads"),
  // Almacenamiento de imágenes: local (disco) | s3 (Backblaze B2 / Cloudflare R2, compatible S3)
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().default(""),      // p. ej. https://s3.us-west-004.backblazeb2.com
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_PUBLIC_URL: z.string().default(""),    // base pública/CDN, p. ej. https://cdn.tudominio.com
  // Email: dev (loguea en consola) | smtp (envía de verdad con SMTP_*)
  EMAIL_TRANSPORT: z.enum(["dev", "smtp"]).default("dev"),
  EMAIL_FROM: z.string().default("Turno <no-reply@turno.app>"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  // Horas mínimas antes de la cita para tener derecho a reembolso al cancelar.
  CANCELACION_HORAS_REEMBOLSO: z.coerce.number().default(24),
  // Segundo secreto para firmar refresh tokens (distinto del JWT de acceso).
  REFRESH_TOKEN_DIAS: z.coerce.number().default(30),
  // Proveedor de pago extra disponible: paypal (stub).
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_SECRET: z.string().default(""),
  // WhatsApp: deeplink (wa.me, gratis) | cloud (WhatsApp Cloud API oficial de Meta)
  WHATSAPP_PROVIDER: z.enum(["deeplink", "cloud"]).default("deeplink"),
  WHATSAPP_TOKEN: z.string().default(""),
  WHATSAPP_PHONE_ID: z.string().default(""),
  WHATSAPP_TEMPLATE: z.string().default(""),   // nombre de la plantilla aprobada en Meta
  WHATSAPP_LANG: z.string().default("es"),
  // Empresa operadora (para pies de email). CAMBIAR por los datos reales.
  COMPANY_NAME: z.string().default("OC HOLDING GROUP LLC"),
  COMPANY_SUPPORT_EMAIL: z.string().default("soporte@turno.app"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Configuración inválida:");
  for (const issue of parsed.error.issues) {
    console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const e = parsed.data;

// Guardarraíles de PRODUCCIÓN: fallar rápido ante configuración insegura.
if (e.NODE_ENV === "production") {
  const errores: string[] = [];
  if (e.JWT_SECRET.includes("dev-secret") || e.JWT_SECRET.length < 32) {
    errores.push("JWT_SECRET debe ser un secreto fuerte y único (>=32 chars, no el de desarrollo)");
  }
  if (e.PAYMENT_PROVIDER === "stripe" && (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET)) {
    errores.push("Con Stripe se requieren STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET");
  }
  if (e.EMAIL_TRANSPORT === "smtp" && !e.SMTP_HOST) {
    errores.push("EMAIL_TRANSPORT=smtp requiere SMTP_HOST");
  }
  if (e.FRONTEND_ORIGIN.includes("localhost")) {
    errores.push("FRONTEND_ORIGIN apunta a localhost en producción");
  }
  if (errores.length) {
    console.error("❌ Configuración de producción insegura:");
    for (const m of errores) console.error(`   - ${m}`);
    process.exit(1);
  }
}

// Aviso de seguridad si se usa Stripe sin claves (en dev).
if (e.PAYMENT_PROVIDER === "stripe" && !e.STRIPE_SECRET_KEY) {
  console.warn("⚠️  PAYMENT_PROVIDER=stripe pero STRIPE_SECRET_KEY está vacío");
}

export const env = {
  port: e.PORT,
  nodeEnv: e.NODE_ENV,
  databaseUrl: e.DATABASE_URL,
  jwtSecret: e.JWT_SECRET,
  jwtExpiresIn: e.JWT_EXPIRES_IN,
  maxPeluqueros: e.MAX_PELUQUEROS_POR_NEGOCIO,
  fianzaUsd: e.FIANZA_RESERVA_USD,
  fianzaComisionUsd: e.FIANZA_COMISION_USD,
  payoutInterval: e.STRIPE_PAYOUT_INTERVAL,
  payoutAnchor: e.STRIPE_PAYOUT_ANCHOR,
  stripeFeePct: e.STRIPE_FEE_PCT,
  stripeFeeFijo: e.STRIPE_FEE_FIJO,
  feeStripeReparto: e.FEE_STRIPE_REPARTO,
  reservaHoldMinutos: e.RESERVA_HOLD_MINUTOS,
  paymentProvider: e.PAYMENT_PROVIDER,
  stripeSecretKey: e.STRIPE_SECRET_KEY,
  stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
  stripePrices: {
    basico: { mensual: e.STRIPE_PRICE_BASICO_MENSUAL, anual: e.STRIPE_PRICE_BASICO_ANUAL },
    pro: { mensual: e.STRIPE_PRICE_PRO_MENSUAL, anual: e.STRIPE_PRICE_PRO_ANUAL },
  },
  frontendOrigin: e.FRONTEND_ORIGIN,
  appUrl: e.APP_URL,
  uploadDir: e.UPLOAD_DIR,
  storageProvider: e.STORAGE_PROVIDER,
  s3Endpoint: e.S3_ENDPOINT,
  s3Region: e.S3_REGION,
  s3Bucket: e.S3_BUCKET,
  s3AccessKeyId: e.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: e.S3_SECRET_ACCESS_KEY,
  s3PublicUrl: e.S3_PUBLIC_URL,
  emailTransport: e.EMAIL_TRANSPORT,
  emailFrom: e.EMAIL_FROM,
  smtpHost: e.SMTP_HOST,
  smtpPort: e.SMTP_PORT,
  smtpUser: e.SMTP_USER,
  smtpPass: e.SMTP_PASS,
  cancelacionHorasReembolso: e.CANCELACION_HORAS_REEMBOLSO,
  refreshTokenDias: e.REFRESH_TOKEN_DIAS,
  paypalClientId: e.PAYPAL_CLIENT_ID,
  paypalSecret: e.PAYPAL_SECRET,
  whatsappProvider: e.WHATSAPP_PROVIDER,
  whatsappToken: e.WHATSAPP_TOKEN,
  whatsappPhoneId: e.WHATSAPP_PHONE_ID,
  whatsappTemplate: e.WHATSAPP_TEMPLATE,
  whatsappLang: e.WHATSAPP_LANG,
  companyName: e.COMPANY_NAME,
  companySupportEmail: e.COMPANY_SUPPORT_EMAIL,
} as const;
