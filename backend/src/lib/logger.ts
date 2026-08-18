import pino from "pino";
import { env } from "../config/env.js";

// Logger estructurado. En desarrollo usa salida legible; en producción, JSON.
export const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  ...(env.nodeEnv !== "production"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } }
    : {}),
});
