import { PrismaClient } from "@prisma/client";

// Instancia única del cliente Prisma reutilizada en toda la app.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
