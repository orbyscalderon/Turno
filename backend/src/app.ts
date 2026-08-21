import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
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
import { perfilesRouter } from "./modules/perfiles.routes.js";
import { logger } from "./lib/logger.js";
import pinoHttp from "pino-http";

export function crearApp() {
  const app = express();

  // Tras un reverse proxy (nginx/Render/Railway): confía en 1 salto para obtener
  // la IP real del cliente (rate-limit) y detectar HTTPS. Solo en producción.
  if (env.nodeEnv === "production") app.set("trust proxy", 1);

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
  });
  // Límite más estricto para auth (anti fuerza bruta).
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

  // Captura el cuerpo crudo para verificar la firma del webhook de pagos (Stripe).
  // Límite de 1 MB para evitar payloads abusivos (las imágenes van por multipart, no JSON).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString("utf8");
      },
    }),
  );

  // Servir imágenes subidas.
  app.use("/uploads", express.static(path.resolve(env.uploadDir)));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "turno-api" }));

  app.use("/api", apiLimiter);
  app.use("/api/auth", authLimiter, authRouter);
  app.use("/api/negocios", negociosRouter);
  app.use("/api/servicios", serviciosRouter);
  app.use("/api/disponibilidad", disponibilidadRouter);
  app.use("/api/reservas", reservasRouter);
  app.use("/api/resenas", resenasRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/perfiles", perfilesRouter);
  app.use("/api/suscripcion", suscripcionRouter);
  app.use("/api/connect", connectRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/superadmin", superadminRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

  app.use(errorHandler);
  return app;
}
