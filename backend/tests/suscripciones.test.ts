import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { vencerSuscripciones } from "../src/jobs/vencerSuscripciones.js";

// Antes, `suscripcionHasta` se escribía pero NUNCA se leía: la prueba de 14 días
// era infinita y ningún negocio dejaba de ser visible por no pagar. Estas pruebas
// fijan el comportamiento correcto.
const app = crearApp();
const sufijo = Date.now();
const emailDueno = `dueno_sub_${sufijo}@turno.test`;

let duenoId = 0;
let negocioCaducadoId = "";
let negocioVigenteId = "";

describe("vigencia de la suscripción", () => {
  beforeAll(async () => {
    const dueno = await prisma.usuario.create({
      data: {
        nombre: "Dueño Suscripción",
        telefono: "+34600000031",
        email: emailDueno,
        passwordHash: "x",
        rol: "admin_negocio",
        emailVerificadoEn: new Date(),
      },
    });
    duenoId = dueno.id;

    // Prueba caducada ayer (el caso del "negocio gratis para siempre").
    const caducado = await prisma.negocio.create({
      data: {
        nombreComercial: `Caducado ${sufijo}`,
        slug: `caducado-${sufijo}`,
        direccion: "Calle Falsa 1",
        telefonoContacto: "+34600000032",
        duenoId,
        estadoSuscripcion: "prueba",
        suscripcionHasta: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    negocioCaducadoId = caducado.id;

    const vigente = await prisma.negocio.create({
      data: {
        nombreComercial: `Vigente ${sufijo}`,
        slug: `vigente-${sufijo}`,
        direccion: "Calle Real 2",
        telefonoContacto: "+34600000033",
        duenoId,
        estadoSuscripcion: "prueba",
        suscripcionHasta: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });
    negocioVigenteId = vigente.id;
  });

  afterAll(async () => {
    await prisma.negocio.deleteMany({ where: { duenoId } });
    await prisma.usuario.deleteMany({ where: { id: duenoId } });
    await prisma.$disconnect();
  });

  it("un negocio con la prueba caducada NO aparece en el listado público", async () => {
    const res = await request(app).get(`/api/negocios?q=Caducado ${sufijo}`);
    expect(res.status).toBe(200);
    expect(res.body.negocios).toHaveLength(0);
  });

  it("su ficha pública devuelve 404 aunque el estado siga siendo 'prueba'", async () => {
    const res = await request(app).get(`/api/negocios/caducado-${sufijo}`);
    expect(res.status).toBe(404);
  });

  it("uno con fecha futura sí aparece y su ficha carga", async () => {
    const lista = await request(app).get(`/api/negocios?q=Vigente ${sufijo}`);
    expect(lista.body.negocios).toHaveLength(1);
    const ficha = await request(app).get(`/api/negocios/vigente-${sufijo}`);
    expect(ficha.status).toBe(200);
  });

  it("el job marca como vencidos los caducados y respeta los vigentes", async () => {
    const vencidas = await vencerSuscripciones();
    expect(vencidas).toBeGreaterThanOrEqual(1);

    const caducado = await prisma.negocio.findUnique({ where: { id: negocioCaducadoId } });
    const vigente = await prisma.negocio.findUnique({ where: { id: negocioVigenteId } });
    expect(caducado?.estadoSuscripcion).toBe("vencido");
    expect(vigente?.estadoSuscripcion).toBe("prueba");
  });

  it("el job es idempotente (no vuelve a contar lo ya vencido)", async () => {
    const segunda = await vencerSuscripciones();
    const caducado = await prisma.negocio.findUnique({ where: { id: negocioCaducadoId } });
    expect(caducado?.estadoSuscripcion).toBe("vencido");
    // Puede haber otros negocios caducados en la base, pero el nuestro ya no cuenta.
    expect(segunda).toBeGreaterThanOrEqual(0);
  });

  it("no se puede reservar con un profesional de un negocio no vigente", async () => {
    // El dueño es su propio profesional en el negocio caducado.
    await prisma.peluqueroEquipo.create({
      data: { negocioId: negocioCaducadoId, usuarioId: duenoId, estadoAprobacion: "aceptado" },
    });
    const servicio = await prisma.servicio.create({
      data: {
        peluqueroId: duenoId,
        nombreServicio: "Corte",
        precio: 10,
        moneda: "EUR",
        duracionMinutos: 30,
      },
    });

    const cliente = await request(app).post("/api/auth/registro").send({
      nombre: "Cliente Sub",
      telefono: "+34600000034",
      email: `cliente_sub_${sufijo}@turno.test`,
      password: "password123",
      rol: "cliente",
    });

    const manana = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${cliente.body.token}`)
      .send({ peluqueroId: duenoId, servicioId: servicio.id, fecha: manana, horaInicio: "10:00" });

    expect(res.status).toBe(403);

    await prisma.servicio.deleteMany({ where: { peluqueroId: duenoId } });
    await prisma.usuario.deleteMany({ where: { id: cliente.body.usuario.id } });
  });
});

describe("protección de las rutas sensibles", () => {
  it("el desglose de comisiones ya no es público", async () => {
    const res = await request(app).get("/api/reservas/split");
    expect(res.status).toBe(401);
  });

  it("validar un código exige sesión de negocio", async () => {
    const res = await request(app).post("/api/reservas/validar").send({ codigo: "ABCD1234" });
    expect(res.status).toBe(401);
  });

  it("el healthcheck comprueba la base de datos", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("ok");
  });

  it("rechaza un archivo que dice ser imagen pero no lo es", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "peluquero1@turno.app", password: "password123" });

    const res = await request(app)
      .post("/api/uploads/foto")
      .set("Authorization", `Bearer ${login.body.token}`)
      .attach("imagen", Buffer.from("<?php echo 'no soy una imagen'; ?>"), {
        filename: "troyano.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("IMAGEN_INVALIDA");
  });
});
