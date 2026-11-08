import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Booleanos de entorno: "true"/"1" activan; cualquier otra cosa desactiva.
const booleano = (pordefecto: "true" | "false") =>
  z
    .string()
    .default(pordefecto)
    .transform((v) => v === "true" || v === "1");

// Validación estricta de la configuración al arrancar: si falta algo crítico, falla rápido.
const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  // Conexión directa (sin pooler) que Prisma usa para las migraciones.
  DIRECT_URL: z.string().default(""),
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
  FEE_STRIPE_REPARTO: z
    .enum(["negocio", "plataforma", "compartido", "cliente"])
    .default("compartido"),
  // Minutos que se mantiene bloqueado el slot esperando el pago antes de liberarlo.
  RESERVA_HOLD_MINUTOS: z.coerce.number().default(15),
  PAYMENT_PROVIDER: z.enum(["mock", "stripe", "paypal"]).default("mock"),
  STRIPE_SECRET_KEY: z.string().default(""),
  // Stripe emite un secreto DISTINTO por endpoint de webhook. Si solo se define
  // STRIPE_WEBHOOK_SECRET, se usa para los dos (compatibilidad), pero lo correcto
  // en producción es rellenar los dos específicos.
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_WEBHOOK_SECRET_PAGOS: z.string().default(""),
  STRIPE_WEBHOOK_SECRET_SUSCRIPCION: z.string().default(""),
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
  S3_ENDPOINT: z.string().default(""), // p. ej. https://s3.us-west-004.backblazeb2.com
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_PUBLIC_URL: z.string().default(""), // base pública/CDN, p. ej. https://cdn.tudominio.com
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
  // Proveedor de pago alternativo: PayPal (Orders v2).
  PAYPAL_CLIENT_ID: z.string().default(""),
  PAYPAL_SECRET: z.string().default(""),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  // Id del webhook creado en el panel de PayPal (necesario para validar la firma).
  PAYPAL_WEBHOOK_ID: z.string().default(""),
  // WhatsApp: deeplink (wa.me, gratis) | cloud (WhatsApp Cloud API oficial de Meta)
  WHATSAPP_PROVIDER: z.enum(["deeplink", "cloud"]).default("deeplink"),
  WHATSAPP_TOKEN: z.string().default(""),
  WHATSAPP_PHONE_ID: z.string().default(""),
  WHATSAPP_TEMPLATE: z.string().default(""), // nombre de la plantilla aprobada en Meta
  WHATSAPP_LANG: z.string().default("es"),
  // Empresa operadora (para pies de email). CAMBIAR por los datos reales.
  COMPANY_NAME: z.string().default("OC HOLDING GROUP LLC"),
  COMPANY_SUPPORT_EMAIL: z.string().default("soporte@turno.app"),
  // Login con Google (Google Identity Services). Vacío = botón de Google desactivado.
  GOOGLE_CLIENT_ID: z.string().default(""),
  // Modo "rubro fijo": si se define (ej. "supermercado"), este despliegue es un producto
  // de un solo rubro — /perfiles solo devuelve ese, y los negocios se fuerzan a él.
  // Vacío = plataforma multi-rubro completa.
  RUBRO_FIJO: z.string().default(""),

  // ---------- Operativa de citas ----------
  // Zona horaria por defecto de un negocio nuevo (IANA). Cada negocio puede cambiarla.
  TIMEZONE_DEFECTO: z.string().default("Europe/Madrid"),
  // Exigir email verificado para reservar y para crear negocio. En producción: true.
  EXIGIR_EMAIL_VERIFICADO: booleano("false"),
  // Tope de reservas sin pagar simultáneas por cliente (anti-bloqueo de agenda).
  MAX_RESERVAS_PENDIENTES_POR_CLIENTE: z.coerce.number().int().min(1).default(3),
  // Antelación mínima (horas) con la que se puede reservar una cita.
  ANTELACION_MINIMA_HORAS: z.coerce.number().min(0).default(0),
  // Horizonte máximo (días) hacia el futuro para reservar.
  HORIZONTE_RESERVA_DIAS: z.coerce.number().int().min(1).default(90),
  // Segundo recordatorio, pocas horas antes de la cita (0 = desactivado).
  RECORDATORIO_CORTO_HORAS: z.coerce.number().int().min(0).default(3),

  // ---------- Segundo factor (2FA) ----------
  // Clave para cifrar los secretos TOTP en reposo. Vacía = se deriva de JWT_SECRET.
  // Rotarla deja los segundos factores ilegibles: se entra con los códigos de recuperación.
  TOTP_CLAVE: z.string().default(""),
  // Exigir 2FA a los superadmin. El panel de superadmin ve todos los negocios,
  // todos los usuarios y todos los ingresos: con esto en false, una sola
  // contraseña es lo único que lo protege.
  EXIGIR_2FA_SUPERADMIN: booleano("false"),

  // ---------- Impuestos de la suscripción ----------
  // Delega el cálculo del IVA/impuestos de la suscripción en Stripe Tax.
  // Hay que activarlo también en el panel de Stripe (Settings -> Tax).
  STRIPE_TAX_ACTIVO: booleano("false"),

  // ---------- Lista de espera ----------
  // Cuántos clientes de la cola se avisan por cada hueco que se libera. Avisar a
  // uno solo deja el hueco muerto si no contesta; avisar a todos es spam.
  ESPERA_AVISOS_POR_HUECO: z.coerce.number().int().min(1).default(3),

  // ---------- Analítica de producto ----------
  // Eventos propios del embudo. Se guardan en la base de datos del proyecto:
  // no se envía nada a terceros, así que no hace falta consentimiento extra.
  ANALITICA_ACTIVA: booleano("true"),
  EVENTOS_RETENCION_DIAS: z.coerce.number().int().min(1).default(90),

  // ---------- Límites de peticiones ----------
  // Por IP. Subirlo mucho abre la puerta al abuso; bajarlo deja sin servicio a
  // quien comparte salida a internet con más gente.
  RATE_LIMIT_MAX: z.coerce.number().int().min(60).default(1000),
  RATE_LIMIT_VENTANA_MIN: z.coerce.number().int().min(1).default(15),
  // Login/registro/reset: estricto, es la defensa contra la fuerza bruta.
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(5).default(30),

  // ---------- Observabilidad ----------
  // Vacío = Sentry desactivado (los errores solo van al log estructurado).
  SENTRY_DSN: z.string().default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // Escotilla para STAGING: permite arrancar en NODE_ENV=production con pagos
  // simulados y emails a consola. NUNCA activar en el entorno real de clientes.
  PERMITIR_MODO_DEMO: booleano("false"),
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

// Secretos de webhook por endpoint, con reserva al secreto único (compatibilidad).
const webhookPagos = e.STRIPE_WEBHOOK_SECRET_PAGOS || e.STRIPE_WEBHOOK_SECRET;
const webhookSuscripcion = e.STRIPE_WEBHOOK_SECRET_SUSCRIPCION || e.STRIPE_WEBHOOK_SECRET;

// La zona por defecto tiene que existir o todos los cálculos de agenda caerían a UTC.
try {
  new Intl.DateTimeFormat("en-US", { timeZone: e.TIMEZONE_DEFECTO });
} catch {
  console.error(`❌ TIMEZONE_DEFECTO no es una zona IANA válida: ${e.TIMEZONE_DEFECTO}`);
  process.exit(1);
}

// Guardarraíles de PRODUCCIÓN: fallar rápido ante configuración insegura.
if (e.NODE_ENV === "production") {
  const errores: string[] = [];
  const avisos: string[] = [];

  if (e.JWT_SECRET.includes("dev-secret") || e.JWT_SECRET.length < 32) {
    errores.push("JWT_SECRET debe ser un secreto fuerte y único (>=32 chars, no el de desarrollo)");
  }
  if (e.PAYMENT_PROVIDER === "stripe" && (!e.STRIPE_SECRET_KEY || !webhookPagos)) {
    errores.push("Con Stripe se requieren STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET(_PAGOS)");
  }
  if (e.PAYMENT_PROVIDER === "stripe" && !webhookSuscripcion) {
    errores.push("Falta STRIPE_WEBHOOK_SECRET_SUSCRIPCION (o STRIPE_WEBHOOK_SECRET)");
  }
  if (e.EMAIL_TRANSPORT === "smtp" && !e.SMTP_HOST) {
    errores.push("EMAIL_TRANSPORT=smtp requiere SMTP_HOST");
  }
  // Cobrar de verdad y enviar emails de verdad: sin esto el SaaS es gratis y mudo.
  if (!e.PERMITIR_MODO_DEMO) {
    if (e.PAYMENT_PROVIDER !== "stripe") {
      errores.push(
        `PAYMENT_PROVIDER=${e.PAYMENT_PROVIDER} en producción: las fianzas y suscripciones no se cobrarían. ` +
          "Usa stripe (o PERMITIR_MODO_DEMO=true si esto es un staging).",
      );
    }
    if (e.EMAIL_TRANSPORT !== "smtp") {
      errores.push(
        "EMAIL_TRANSPORT=dev en producción: no se enviaría ningún email (verificación, confirmación, recordatorio). " +
          "Usa smtp (o PERMITIR_MODO_DEMO=true si esto es un staging).",
      );
    }
  }
  // URLs completas: Render/Railway exponen el host SIN esquema y eso rompe CORS
  // y deja los enlaces de los emails inservibles.
  for (const [clave, valor] of [
    ["FRONTEND_ORIGIN", e.FRONTEND_ORIGIN],
    ["APP_URL", e.APP_URL],
  ] as const) {
    if (!/^https?:\/\//.test(valor)) {
      errores.push(`${clave} debe incluir el esquema (https://...). Valor actual: "${valor}"`);
    }
    if (valor.includes("localhost")) errores.push(`${clave} apunta a localhost en producción`);
    if (valor.startsWith("http://")) avisos.push(`${clave} usa http:// (sin TLS) en producción`);
  }
  if (!e.EXIGIR_EMAIL_VERIFICADO) {
    avisos.push("EXIGIR_EMAIL_VERIFICADO=false: se puede reservar sin confirmar el email");
  }
  if (!e.SENTRY_DSN) avisos.push("SENTRY_DSN vacío: los errores 500 solo quedarán en el log");
  if (!e.EXIGIR_2FA_SUPERADMIN) {
    avisos.push(
      "EXIGIR_2FA_SUPERADMIN=false: el panel de superadmin solo está protegido por contraseña",
    );
  }
  if (e.PAYMENT_PROVIDER === "stripe" && !e.STRIPE_TAX_ACTIVO) {
    avisos.push(
      "STRIPE_TAX_ACTIVO=false: la suscripción se cobra sin impuestos. Comprueba si te obliga tu jurisdicción",
    );
  }

  for (const m of avisos) console.warn(`⚠️  ${m}`);
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
  stripeWebhookSecretPagos: webhookPagos,
  stripeWebhookSecretSuscripcion: webhookSuscripcion,
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
  paypalMode: e.PAYPAL_MODE,
  paypalWebhookId: e.PAYPAL_WEBHOOK_ID,
  whatsappProvider: e.WHATSAPP_PROVIDER,
  whatsappToken: e.WHATSAPP_TOKEN,
  whatsappPhoneId: e.WHATSAPP_PHONE_ID,
  whatsappTemplate: e.WHATSAPP_TEMPLATE,
  whatsappLang: e.WHATSAPP_LANG,
  companyName: e.COMPANY_NAME,
  companySupportEmail: e.COMPANY_SUPPORT_EMAIL,
  googleClientId: e.GOOGLE_CLIENT_ID,
  rubroFijo: e.RUBRO_FIJO,
  timezoneDefecto: e.TIMEZONE_DEFECTO,
  exigirEmailVerificado: e.EXIGIR_EMAIL_VERIFICADO,
  maxReservasPendientes: e.MAX_RESERVAS_PENDIENTES_POR_CLIENTE,
  antelacionMinimaHoras: e.ANTELACION_MINIMA_HORAS,
  horizonteReservaDias: e.HORIZONTE_RESERVA_DIAS,
  recordatorioCortoHoras: e.RECORDATORIO_CORTO_HORAS,
  rateLimitMax: e.RATE_LIMIT_MAX,
  rateLimitVentanaMin: e.RATE_LIMIT_VENTANA_MIN,
  rateLimitAuthMax: e.RATE_LIMIT_AUTH_MAX,
  totpClave: e.TOTP_CLAVE,
  exigir2faSuperadmin: e.EXIGIR_2FA_SUPERADMIN,
  stripeTaxActivo: e.STRIPE_TAX_ACTIVO,
  esperaAvisosPorHueco: e.ESPERA_AVISOS_POR_HUECO,
  analiticaActiva: e.ANALITICA_ACTIVA,
  eventosRetencionDias: e.EVENTOS_RETENCION_DIAS,
  sentryDsn: e.SENTRY_DSN,
  sentryTracesSampleRate: e.SENTRY_TRACES_SAMPLE_RATE,
  permitirModoDemo: e.PERMITIR_MODO_DEMO,
} as const;
