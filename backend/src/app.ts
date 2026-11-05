import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { existsSync } from "node:fs";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./modules/auth.routes.js";
import { negociosRouter } from "./modules/negocios.routes.js";
import { serviciosRouter } from "./modules/servicios.routes.js";
import { disponibilidadRouter } from "./modules/disponibilidad.routes.js";
import { reservasRouter } from "./modules/reservas.routes.js";
import { superadminRouter } from "./modules/superadmin.routes.js";
import { suscripcionRouter } from "./modules/suscripcion.routes.js";
import { connectRouter } from "./modules/connect.routes.js";
import { uploadsRouter } from "./modules/uploads.routes.js";
import { resenasRouter } from "./modules/resenas.routes.js";
import { statsRouter } from "./modules/stats.routes.js";
import { sitemapRouter } from "./modules/sitemap.routes.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import pinoHttp from "pino-http";

// Rutas que reciben webhooks de la pasarela: quedan fuera del rate limit general
// porque Stripe puede entregar ráfagas de eventos y un 429 provoca reintentos
// infinitos (y pagos sin confirmar).
const RUTAS_WEBHOOK = ["/api/reservas/webhook/pago", "/api/suscripcion/webhook"];

export function crearApp() {
  const app = express();

  // Tras un reverse proxy (nginx/Render/Railway): confía en 1 salto para obtener
  // la IP real del cliente (rate-limit) y detectar HTTPS. Solo en producción.
  if (env.nodeEnv === "production") app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // Logging estructurado de peticiones.
  app.use(pinoHttp({ logger, autoLogging: env.nodeEnv !== "test" }));

  // Cabeceras de seguridad. crossOriginResourcePolicy relajado para servir imágenes al frontend.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.frontendOrigin, credentials: true }));

  // Rate limiting general de la API.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => RUTAS_WEBHOOK.includes(req.originalUrl.split("?")[0]),
  });
  // Límite más estricto para auth (anti fuerza bruta).
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
  // Subidas de imágenes: son caras (3 MB cada una) y no hay motivo para ráfagas.
  const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40 });

  // Captura el cuerpo crudo para verificar la firma del webhook de pagos (Stripe).
  // Límite de 1 MB para evitar payloads abusivos (las imágenes van por multipart, no JSON).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        // `verify` recibe el IncomingMessage crudo, antes de que Express lo enriquezca.
        (req as unknown as express.Request).rawBody = buf.toString("utf8");
      },
    }),
  );

  // Servir imágenes subidas (nombres con UUID: se pueden cachear para siempre).
  app.use(
    "/uploads",
    express.static(path.resolve(env.uploadDir), {
      maxAge: "365d",
      immutable: true,
      index: false,
      dotfiles: "ignore",
    }),
  );

  // Sonda de vida: no toca la base de datos (la usa el orquestador para reinicios).
  app.get("/api/health/live", (_req, res) => res.json({ ok: true, service: "turno-api" }));

  // Sonda de salud real: comprueba que la base de datos responde. Antes devolvía
  // 200 incluso con Postgres caído, así que el healthcheck no detectaba nada.
  app.get("/api/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, service: "turno-api", db: "ok" });
    } catch (e) {
      logger.error({ err: e }, "healthcheck: base de datos no disponible");
      res.status(503).json({ ok: false, service: "turno-api", db: "error" });
    }
  });

  // Documentación OpenAPI (contrato de la API para la app móvil y terceros).
  const especificacion = path.resolve("openapi.yaml");
  if (existsSync(especificacion)) {
    app.get("/api/openapi.yaml", (_req, res) => res.sendFile(especificacion));
    app.get("/api/docs", (_req, res) => {
      res.type("html").send(
        `<!doctype html><html><head><meta charset="utf-8"/><title>API de Turno</title>
         <meta name="viewport" content="width=device-width,initial-scale=1"/>
         <style>body{margin:0}</style></head>
         <body><redoc spec-url="/api/openapi.yaml"></redoc>
         <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.3/bundles/redoc.standalone.js"></script>
         </body></html>`,
      );
    });
  }

  // Sitemap antes del rate limit: lo piden los rastreadores, no los usuarios.
  app.use("/api", sitemapRouter);

  app.use("/api", apiLimiter);
  app.use("/api/auth", authLimiter, authRouter);
  app.use("/api/negocios", negociosRouter);
  app.use("/api/servicios", serviciosRouter);
  app.use("/api/disponibilidad", disponibilidadRouter);
  app.use("/api/reservas", reservasRouter);
  app.use("/api/resenas", resenasRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/suscripcion", suscripcionRouter);
  app.use("/api/connect", connectRouter);
  app.use("/api/uploads", uploadLimiter, uploadsRouter);
  app.use("/api/superadmin", superadminRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

  app.use(errorHandler);
  return app;
}
