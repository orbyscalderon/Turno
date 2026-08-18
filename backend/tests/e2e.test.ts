import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// E2E del journey del cliente contra la BD real (usa el negocio del seed).
// Crea un cliente desechable y limpia sus datos al final.
const app = crearApp();
const email = `e2e_${Date.now()}@turno.test`;
let token = "";
let clienteId = 0;
let reservaId = 0;

// Próximo día laborable (L-V) en el futuro, dentro de la disponibilidad del seed.
function futureWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("E2E: reservar → pagar → historial → cancelar", () => {
  beforeAll(async () => {
    const reg = await request(app).post("/api/auth/registro").send({
      nombre: "E2E Cliente", telefono: "+34600000009", email, password: "password123", rol: "cliente",
    });
    token = reg.body.token;
    clienteId = reg.body.usuario.id;
  });

  afterAll(async () => {
    await prisma.reservacion.deleteMany({ where: { clienteId } });
    await prisma.usuario.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("1) explora el negocio público y sus profesionales", async () => {
    const res = await request(app).get("/api/negocios/barberia-el-corte-fino");
    expect(res.status).toBe(200);
    expect(res.body.profesionales.length).toBeGreaterThan(0);
  });

  it("2) journey completo de reserva", async () => {
    // Profesional y servicio
    const det = await request(app).get("/api/negocios/barberia-el-corte-fino");
    const peluqueroId = det.body.profesionales[0].id;
    const svc = await request(app).get(`/api/servicios/peluquero/${peluqueroId}`);
    const servicioId = svc.body.servicios[0].id;

    // Slots libres
    const fecha = futureWeekday();
    const slots = await request(app).get(`/api/reservas/slots?peluqueroId=${peluqueroId}&servicioId=${servicioId}&fecha=${fecha}`);
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBeGreaterThan(0);
    const horaInicio = slots.body.slots[0].inicio;

    // Crear reserva
    const crear = await request(app).post("/api/reservas").set("Authorization", `Bearer ${token}`)
      .send({ peluqueroId, servicioId, fecha, horaInicio });
    expect(crear.status).toBe(201);
    reservaId = crear.body.reserva.id;
    expect(crear.body.reserva.pagoReservaStatus).toBe("pendiente");

    // Pagar (endpoint autenticado, modo mock)
    const pago = await request(app).post(`/api/reservas/${reservaId}/pagar`).set("Authorization", `Bearer ${token}`);
    expect(pago.status).toBe(200);
    expect(pago.body.estado).toBe("confirmada");
    expect(pago.body.whatsappUrl).toContain("wa.me");

    // El slot ya no está libre (anti-colisión)
    const slots2 = await request(app).get(`/api/reservas/slots?peluqueroId=${peluqueroId}&servicioId=${servicioId}&fecha=${fecha}`);
    expect(slots2.body.slots.some((s: any) => s.inicio === horaInicio)).toBe(false);

    // Aparece en el historial como pagada + confirmada
    const mias = await request(app).get("/api/reservas/mias").set("Authorization", `Bearer ${token}`);
    const r = mias.body.reservas.find((x: any) => x.id === reservaId);
    expect(r).toBeTruthy();
    expect(r.pagoReservaStatus).toBe("pagado");
    expect(r.whatsappUrl).toContain("wa.me");
  });

  it("3) no se puede reseñar una cita no completada", async () => {
    const res = await request(app).post("/api/resenas").set("Authorization", `Bearer ${token}`)
      .send({ reservacionId: reservaId, puntuacion: 5 });
    expect(res.status).toBe(400);
  });

  it("4) el cliente cancela su reserva", async () => {
    const res = await request(app).patch(`/api/reservas/${reservaId}/cancelar`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reserva.estadoCita).toBe("cancelada");
  });

  it("5) el webhook público está cerrado en modo mock", async () => {
    const res = await request(app).post("/api/reservas/webhook/pago").send({ transaccionId: "x", pagado: true });
    expect(res.status).toBe(403);
  });
});
