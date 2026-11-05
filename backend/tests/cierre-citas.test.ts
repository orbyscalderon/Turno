import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Ciclo completo que ANTES era imposible: reservar -> pagar -> validar el código
// en el local -> cita completada -> reseña -> rating del negocio actualizado.
// Nada marcaba una cita como "completada", así que las reseñas y la analítica de
// ingresos del negocio nunca se activaban.
const app = crearApp();
const emailCliente = `cierre_${Date.now()}@turno.test`;

let tokenCliente = "";
let tokenPro = "";
let clienteId = 0;
let peluqueroId = 0;
let servicioId = 0;
let reservaId = 0;
let codigo = "";

/** Próximo día laborable (L-V) dentro de la disponibilidad del seed. */
function futureWeekday(offset = 4): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("cierre de citas: validar código, completar y reseñar", () => {
  beforeAll(async () => {
    const reg = await request(app).post("/api/auth/registro").send({
      nombre: "Cierre Cliente",
      telefono: "+34600000011",
      email: emailCliente,
      password: "password123",
      rol: "cliente",
    });
    tokenCliente = reg.body.token;
    clienteId = reg.body.usuario.id;

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "peluquero1@turno.app", password: "password123" });
    tokenPro = login.body.token;
    peluqueroId = login.body.usuario.id;

    const svc = await request(app).get(`/api/servicios/peluquero/${peluqueroId}`);
    servicioId = svc.body.servicios[0].id;
  });

  afterAll(async () => {
    await prisma.resena.deleteMany({ where: { clienteId } });
    await prisma.reservacion.deleteMany({ where: { clienteId } });
    await prisma.usuario.deleteMany({ where: { email: emailCliente } });
    await prisma.$disconnect();
  });

  it("crea y paga la reserva", async () => {
    const slots = await request(app)
      .get("/api/reservas/slots")
      .query({ peluqueroId, servicioId, fecha: futureWeekday() });
    expect(slots.body.slots.length).toBeGreaterThan(0);
    // La respuesta ahora informa de la zona horaria del negocio.
    expect(slots.body.timezone).toBeTruthy();

    const crear = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({
        peluqueroId,
        servicioId,
        fecha: futureWeekday(),
        horaInicio: slots.body.slots[0].inicio,
      });
    expect(crear.status).toBe(201);
    // La fecha que devuelve es la elegida, sin desplazamiento de zona.
    expect(crear.body.reserva.fecha).toBe(futureWeekday());
    reservaId = crear.body.reserva.id;
    codigo = crear.body.reserva.codigoValidacion;

    const pagar = await request(app)
      .post(`/api/reservas/${reservaId}/pagar`)
      .set("Authorization", `Bearer ${tokenCliente}`);
    expect(pagar.status).toBe(200);
  });

  it("no se puede reseñar una cita que aún no se ha completado", async () => {
    const res = await request(app)
      .post("/api/resenas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ reservacionId: reservaId, puntuacion: 5 });
    expect(res.status).toBe(400);
  });

  it("un código inexistente no valida nada", async () => {
    const res = await request(app)
      .post("/api/reservas/validar")
      .set("Authorization", `Bearer ${tokenPro}`)
      .send({ codigo: "ZZZZZZZZ" });
    expect(res.status).toBe(404);
  });

  it("el cliente no puede validar códigos (es cosa del negocio)", async () => {
    const res = await request(app)
      .post("/api/reservas/validar")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ codigo: codigo });
    expect(res.status).toBe(403);
  });

  it("el profesional valida el código y la cita queda completada", async () => {
    const res = await request(app)
      .post("/api/reservas/validar")
      .set("Authorization", `Bearer ${tokenPro}`)
      .send({ codigo: codigo.toLowerCase() }); // insensible a mayúsculas
    expect(res.status).toBe(200);
    expect(res.body.reserva.estadoCita).toBe("completada");

    const enBd = await prisma.reservacion.findUnique({ where: { id: reservaId } });
    expect(enBd?.estadoCita).toBe("completada");
    expect(enBd?.completadaEn).toBeTruthy();
  });

  it("validar dos veces es idempotente", async () => {
    const res = await request(app)
      .post("/api/reservas/validar")
      .set("Authorization", `Bearer ${tokenPro}`)
      .send({ codigo });
    expect(res.status).toBe(200);
    expect(res.body.yaCompletada).toBe(true);
  });

  it("ahora sí se puede reseñar, y el rating del negocio se recalcula", async () => {
    const res = await request(app)
      .post("/api/resenas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ reservacionId: reservaId, puntuacion: 5, comentario: "Impecable" });
    expect(res.status).toBe(201);

    const negocio = await prisma.negocio.findUnique({
      where: { slug: "barberia-el-corte-fino" },
      select: { ratingConteo: true, ratingPromedio: true },
    });
    expect(negocio!.ratingConteo).toBeGreaterThan(0);
    expect(negocio!.ratingPromedio).toBeGreaterThan(0);
  });

  it("no se puede reseñar dos veces la misma cita", async () => {
    const res = await request(app)
      .post("/api/resenas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ reservacionId: reservaId, puntuacion: 1 });
    expect(res.status).toBe(409);
  });

  it("la analítica del profesional cuenta la cita completada", async () => {
    const res = await request(app)
      .get("/api/reservas/mis-ingresos")
      .set("Authorization", `Bearer ${tokenPro}`);
    expect(res.status).toBe(200);
    expect(res.body.citasCompletadas).toBeGreaterThan(0);
  });
});

describe("cancelación desde el negocio", () => {
  const emailOtro = `cancelneg_${Date.now()}@turno.test`;
  let token = "";
  let otroClienteId = 0;
  let idReserva = 0;

  beforeAll(async () => {
    const reg = await request(app).post("/api/auth/registro").send({
      nombre: "Cancel Cliente",
      telefono: "+34600000012",
      email: emailOtro,
      password: "password123",
      rol: "cliente",
    });
    token = reg.body.token;
    otroClienteId = reg.body.usuario.id;
  });

  afterAll(async () => {
    await prisma.reservacion.deleteMany({ where: { clienteId: otroClienteId } });
    await prisma.usuario.deleteMany({ where: { email: emailOtro } });
  });

  it("el negocio cancela una cita confirmada y se reembolsa la fianza", async () => {
    const fecha = futureWeekday(8);
    const slots = await request(app)
      .get("/api/reservas/slots")
      .query({ peluqueroId, servicioId, fecha });
    const crear = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${token}`)
      .send({ peluqueroId, servicioId, fecha, horaInicio: slots.body.slots[0].inicio });
    idReserva = crear.body.reserva.id;
    await request(app)
      .post(`/api/reservas/${idReserva}/pagar`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .patch(`/api/reservas/${idReserva}/cancelar-negocio`)
      .set("Authorization", `Bearer ${tokenPro}`)
      .send({ motivo: "Baja del profesional" });

    expect(res.status).toBe(200);
    expect(res.body.reembolsado).toBe(true);
    expect(res.body.reserva.estadoCita).toBe("cancelada");
    expect(res.body.reserva.canceladaPor).toBe("negocio");
    expect(res.body.reserva.motivoCancelacion).toBe("Baja del profesional");
  });

  it("el slot vuelve a estar libre tras la cancelación", async () => {
    const reserva = await prisma.reservacion.findUnique({ where: { id: idReserva } });
    const fecha = reserva!.fecha.toISOString().slice(0, 10);
    const slots = await request(app)
      .get("/api/reservas/slots")
      .query({ peluqueroId, servicioId, fecha });
    const horas = slots.body.slots.map((s: { inicio: string }) => s.inicio);
    expect(horas).toContain(reserva!.horaInicio);
  });
});
