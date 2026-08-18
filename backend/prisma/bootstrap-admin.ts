import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Crea el PRIMER superadmin en producción SIN datos demo.
// Uso: SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... npm run bootstrap:admin
const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;
  const nombre = process.env.SUPERADMIN_NOMBRE ?? "Super Admin";

  if (!email || !password) {
    console.error("❌ Define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD.");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("❌ La contraseña del superadmin debe tener al menos 10 caracteres.");
    process.exit(1);
  }

  const existe = await prisma.usuario.findUnique({ where: { email } });
  if (existe) {
    console.log(`ℹ️  Ya existe un usuario con ${email} (rol: ${existe.rol}). No se hace nada.`);
    return;
  }

  const usuario = await prisma.usuario.create({
    data: {
      nombre,
      telefono: process.env.SUPERADMIN_TELEFONO ?? "+00000000000",
      email,
      passwordHash: await bcrypt.hash(password, 10),
      rol: "superadmin",
      emailVerificadoEn: new Date(),
    },
  });
  console.log(`✅ Superadmin creado: ${usuario.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
