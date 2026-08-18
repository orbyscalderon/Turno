import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";

/**
 * Crea el PRIMER superadmin al arrancar el contenedor, SI se definieron las
 * variables SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD.
 *
 * Es idempotente y NO fatal: si faltan variables, el admin ya existe, o hay
 * cualquier error, simplemente registra un aviso y deja que el servidor arranque.
 * Pensado para llamarse desde el arranque (dist/bootstrap-admin.js) antes de server.js.
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL?.trim();
  const password = process.env.SUPERADMIN_PASSWORD;
  const nombre = process.env.SUPERADMIN_NOMBRE?.trim() || "Super Admin";

  if (!email || !password) {
    logger.info("bootstrap-admin: sin SUPERADMIN_EMAIL/PASSWORD, se omite.");
    return;
  }
  if (password.length < 10) {
    logger.warn("bootstrap-admin: SUPERADMIN_PASSWORD debe tener al menos 10 caracteres; se omite.");
    return;
  }

  const existe = await prisma.usuario.findUnique({ where: { email } });
  if (existe) {
    logger.info(`bootstrap-admin: ya existe ${email} (rol: ${existe.rol}), no se hace nada.`);
    return;
  }

  await prisma.usuario.create({
    data: {
      nombre,
      telefono: process.env.SUPERADMIN_TELEFONO?.trim() || "+00000000000",
      email,
      passwordHash: await bcrypt.hash(password, 10),
      rol: "superadmin",
      emailVerificadoEn: new Date(),
    },
  });
  logger.info(`bootstrap-admin: superadmin creado (${email}).`);
}

// Permite ejecutarlo como script suelto: node dist/bootstrap-admin.js
// (o localmente: tsx src/bootstrap-admin.ts). Nunca aborta el arranque.
const esEjecutadoDirecto = process.argv[1]?.endsWith("bootstrap-admin.js") || process.argv[1]?.endsWith("bootstrap-admin.ts");
if (esEjecutadoDirecto) {
  bootstrapAdmin()
    .catch((err) => {
      logger.error({ err }, "bootstrap-admin: error creando el superadmin (no fatal).");
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
