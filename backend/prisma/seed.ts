import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function hash(p: string) {
  return bcrypt.hash(p, 10);
}

async function main() {
  console.log("🌱 Sembrando datos de prueba...");

  // Limpieza (orden por dependencias).
  await prisma.reservacion.deleteMany();
  await prisma.disponibilidad.deleteMany();
  await prisma.servicio.deleteMany();
  await prisma.peluqueroEquipo.deleteMany();
  await prisma.negocio.deleteMany();
  await prisma.usuario.deleteMany();

  const passwordHash = await hash("password123");

  // Super Admin de plataforma.
  await prisma.usuario.create({
    data: {
      nombre: "Super Admin",
      telefono: "+10000000000",
      email: "super@turno.app",
      passwordHash,
      rol: "superadmin",
    },
  });

  // Dueño del negocio.
  const dueno = await prisma.usuario.create({
    data: {
      nombre: "Carlos Dueño",
      telefono: "+34600111222",
      email: "dueno@turno.app",
      passwordHash,
      rol: "admin_negocio",
    },
  });

  const negocio = await prisma.negocio.create({
    data: {
      nombreComercial: "Barbería El Corte Fino",
      categoria: "barberia",
      slug: "barberia-el-corte-fino",
      direccion: "Calle Mayor 123, Madrid",
      telefonoContacto: "+34600111222",
      lat: 40.4168,
      lng: -3.7038,
      estadoSuscripcion: "activo",
      suscripcionHasta: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      duenoId: dueno.id,
    },
  });

  // Segundo negocio de otro rubro para mostrar que la plataforma es multi-rubro.
  const duenaEstetica = await prisma.usuario.create({
    data: {
      nombre: "Marta Dueña",
      telefono: "+34600777888",
      email: "estetica@turno.app",
      passwordHash,
      rol: "admin_negocio",
    },
  });
  const centroEstetica = await prisma.negocio.create({
    data: {
      nombreComercial: "Estética Bella Piel",
      categoria: "estetica",
      slug: "estetica-bella-piel",
      direccion: "Av. de la Luz 45, Valencia",
      telefonoContacto: "+34600777888",
      lat: 39.4699,
      lng: -0.3763,
      estadoSuscripcion: "activo",
      suscripcionHasta: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      duenoId: duenaEstetica.id,
    },
  });
  const especialista = await prisma.usuario.create({
    data: {
      nombre: "Lucía Estilista",
      telefono: "+34600999000",
      email: "especialista@turno.app",
      passwordHash,
      rol: "peluquero", // rol interno genérico "profesional del servicio"
    },
  });
  await prisma.peluqueroEquipo.create({
    data: { negocioId: centroEstetica.id, usuarioId: especialista.id, estadoAprobacion: "aceptado" },
  });
  await prisma.servicio.createMany({
    data: [
      { peluqueroId: especialista.id, nombreServicio: "Limpieza facial", precio: 40.0, duracionMinutos: 60 },
      { peluqueroId: especialista.id, nombreServicio: "Manicura", precio: 20.0, duracionMinutos: 45 },
      { peluqueroId: especialista.id, nombreServicio: "Depilación cejas", precio: 12.0, duracionMinutos: 20 },
    ],
  });
  for (const dia of ["lunes", "martes", "miercoles", "jueves", "viernes"] as const) {
    await prisma.disponibilidad.create({
      data: { peluqueroId: especialista.id, dia, horaInicio: "10:00", horaFin: "19:00" },
    });
  }

  // 5 peluqueros (el máximo permitido).
  const nombresPeluqueros = ["Ana", "Bruno", "Carla", "Diego", "Elena"];
  const peluqueros = [];
  for (let i = 0; i < nombresPeluqueros.length; i++) {
    const p = await prisma.usuario.create({
      data: {
        nombre: `${nombresPeluqueros[i]} Barber`,
        telefono: `+3460022200${i}`,
        email: `peluquero${i + 1}@turno.app`,
        passwordHash,
        rol: "peluquero",
      },
    });
    peluqueros.push(p);

    await prisma.peluqueroEquipo.create({
      data: { negocioId: negocio.id, usuarioId: p.id, estadoAprobacion: "aceptado" },
    });

    // Servicios de cada peluquero.
    await prisma.servicio.createMany({
      data: [
        { peluqueroId: p.id, nombreServicio: "Corte de cabello", precio: 15.0, duracionMinutos: 30 },
        { peluqueroId: p.id, nombreServicio: "Corte + Barba", precio: 22.0, duracionMinutos: 45 },
        { peluqueroId: p.id, nombreServicio: "Tinte", precio: 35.0, duracionMinutos: 60 },
      ],
    });

    // Disponibilidad lunes a viernes 09:00-14:00 y 16:00-20:00.
    const dias = ["lunes", "martes", "miercoles", "jueves", "viernes"] as const;
    for (const dia of dias) {
      await prisma.disponibilidad.createMany({
        data: [
          { peluqueroId: p.id, dia, horaInicio: "09:00", horaFin: "14:00" },
          { peluqueroId: p.id, dia, horaInicio: "16:00", horaFin: "20:00" },
        ],
      });
    }
    // Sábado media jornada.
    await prisma.disponibilidad.create({
      data: { peluqueroId: p.id, dia: "sabado", horaInicio: "10:00", horaFin: "14:00" },
    });
  }

  // Un peluquero pendiente de aprobación (para probar el flujo del límite).
  const pendiente = await prisma.usuario.create({
    data: {
      nombre: "Fabio Aspirante",
      telefono: "+34600333444",
      email: "peluquero6@turno.app",
      passwordHash,
      rol: "peluquero",
    },
  });
  await prisma.peluqueroEquipo.create({
    data: { negocioId: negocio.id, usuarioId: pendiente.id, estadoAprobacion: "pendiente" },
  });

  // Clientes.
  const cliente = await prisma.usuario.create({
    data: {
      nombre: "Cliente Uno",
      telefono: "+34600555666",
      email: "cliente@turno.app",
      passwordHash,
      rol: "cliente",
      emailVerificadoEn: new Date(), // ya verificado para no ver el aviso
    },
  });

  // Una cita COMPLETADA en el pasado para poder probar el flujo de reseñas.
  const servicioAna = await prisma.servicio.findFirst({ where: { peluqueroId: peluqueros[0].id } });
  if (servicioAna) {
    await prisma.reservacion.create({
      data: {
        clienteId: cliente.id,
        peluqueroId: peluqueros[0].id,
        servicioId: servicioAna.id,
        fecha: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        horaInicio: "10:00",
        horaFin: "10:30",
        estadoCita: "completada",
        pagoReservaStatus: "pagado",
        codigoValidacion: "SEEDDEMO",
      },
    });
  }

  console.log("✅ Seed completado.");
  console.log("\nCuentas (password para todas: password123):");
  console.log("  superadmin     -> super@turno.app");
  console.log("  admin_negocio  -> dueno@turno.app");
  console.log("  peluquero      -> peluquero1@turno.app ... peluquero5@turno.app (aceptados)");
  console.log("  peluquero      -> peluquero6@turno.app (pendiente)");
  console.log("  cliente        -> cliente@turno.app");
  console.log(`\nNegocio de prueba: ${negocio.nombreComercial} (slug: ${negocio.slug})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
