import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Dos clientes pidiendo EXACTAMENTE el mismo hueco a la vez.
// Antes esto producía una doble reserva: el `SELECT ... FOR UPDATE` no bloqueaba
// nada cuando el profesional no tenía todavía ninguna cita ese día, así que las
// dos peticiones superaban la comprobación de colisión. Ahora hay lock de
// asesoramiento + índice único en la base de datos.
const app = crearApp();
const emailA = `colA_${Date.now()}@turno.test`;
const emailB = `colB_${Date.now()}@turno.test`;

let tokenA = "";
let tokenB = "";
let idA = 0;
let idB = 0;
let peluqueroId = 0;
let servicioId = 0;

function futureWeekday(offset = 12): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("anti doble reserva", () => {
  beforeAll(async () => {
    const [a, b] = await Promise.all([
      request(app).post("/api/auth/registro").send({
        nombre: "Cliente A",
        telefono: "+34600000021",
        email: emailA,
        password: "password123",
        rol: "cliente",
      }),
      request(app).post("/api/auth/registro").send({
        nombre: "Cliente B",
        telefono: "+34600000022",
        email: emailB,
        password: "password123",
        rol: "cliente",
      }),
    ]);
    tokenA = a.body.token;
    tokenB = b.body.token;
    idA = a.body.usuario.id;
    idB = b.body.usuario.id;

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "peluquero2@turno.app", password: "password123" });
    peluqueroId = login.body.usuario.id;
    const svc = await request(app).get(`/api/servicios/peluquero/${peluqueroId}`);
    servicioId = svc.body.servicios[0].id;
  });

  afterAll(async () => {
    await prisma.reservacion.deleteMany({ where: { clienteId: { in: [idA, idB] } } });
    await prisma.usuario.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await prisma.$disconnect();
  });

  it("dos peticiones simultáneas al mismo slot: solo una se queda con la cita", async () => {
    const fecha = futureWeekday();
    const slots = await request(app)
      .get("/api/reservas/slots")
      .query({ peluqueroId, servicioId, fecha });
    expect(slots.body.slots.length).toBeGreaterThan(0);
    const horaInicio = slots.body.slots[0].inicio;
    const cuerpo = { peluqueroId, servicioId, fecha, horaInicio };

    const [r1, r2] = await Promise.all([
      request(app).post("/api/reservas").set("Authorization", `Bearer ${tokenA}`).send(cuerpo),
      request(app).post("/api/reservas").set("Authorization", `Bearer ${tokenB}`).send(cuerpo),
    ]);

    const estados = [r1.status, r2.status].sort();
    expect(estados).toEqual([201, 409]);

    const fallida = r1.status === 409 ? r1 : r2;
    expect(fallida.body.code).toBe("SLOT_OCUPADO");

    // Y en la base de datos solo hay UNA cita confirmada en ese hueco.
    const confirmadas = await prisma.reservacion.count({
      where: {
        peluqueroId,
        fecha: new Date(`${fecha}T00:00:00.000Z`),
        horaInicio,
        estadoCita: "confirmada",
      },
    });
    expect(confirmadas).toBe(1);
  });

  it("el slot ya no se ofrece después de reservarlo", async () => {
    const fecha = futureWeekday();
    const tomada = await prisma.reservacion.findFirst({
      where: { peluqueroId, fecha: new Date(`${fecha}T00:00:00.000Z`), estadoCita: "confirmada" },
    });
    const slots = await request(app)
      .get("/api/reservas/slots")
      .query({ peluqueroId, servicioId, fecha });
    const horas = slots.body.slots.map((s: { inicio: string }) => s.inicio);
    expect(horas).not.toContain(tomada!.horaInicio);
  });

  it("no se puede reservar en el pasado", async () => {
    const res = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ peluqueroId, servicioId, fecha: "2020-01-06", horaInicio: "10:00" });
    expect(res.status).toBe(400);
  });

  it("no se puede reservar más allá del horizonte permitido", async () => {
    const lejos = new Date();
    lejos.setUTCFullYear(lejos.getUTCFullYear() + 3);
    const res = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        peluqueroId,
        servicioId,
        fecha: lejos.toISOString().slice(0, 10),
        horaInicio: "10:00",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FUERA_DE_HORIZONTE");
  });

  it("limita las reservas pendientes de pago por cliente", async () => {
    // El cliente B aún no tiene ninguna pendiente (su intento colisionó o no).
    await prisma.reservacion.deleteMany({ where: { clienteId: idB } });
    const fecha = futureWeekday(13);
    const slots = await request(app)
      .get("/api/reservas/slots")
      .query({ peluqueroId, servicioId, fecha });
    const disponibles = slots.body.slots.slice(0, 5);
    expect(disponibles.length).toBeGreaterThanOrEqual(4);

    const resultados: number[] = [];
    for (const s of disponibles) {
      const r = await request(app)
        .post("/api/reservas")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ peluqueroId, servicioId, fecha, horaInicio: s.inicio });
      resultados.push(r.status);
      if (r.status === 409 && r.body.code === "DEMASIADAS_PENDIENTES") break;
    }
    // Con el tope por defecto (3) la cuarta debe ser rechazada.
    expect(resultados).toContain(409);
  });
});
