import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { fechaUTC, fechaISO, sumarDias, ahoraEnZona } from "../src/lib/time.js";
import { avisarListaEspera } from "../src/lib/espera.js";

// Lista de espera y bonos prepagados. Son las dos piezas que convierten un
// hueco perdido y un cliente fiel en dinero, así que se prueban de verdad:
// que el hueco liberado avisa a la cola, y que el bono descuenta sesión y
// salta la fianza.

const app = crearApp();
const sufijo = Date.now();

let duenoId = 0;
let clienteId = 0;
let negocioId = "";
let servicioId = 0;
let tokenDueno = "";
let tokenCliente = "";
let fechaLibre = "";

describe("lista de espera y bonos", () => {
  beforeAll(async () => {
    // Negocio de una persona: el dueño es su propio profesional.
    const dueno = await request(app).post("/api/auth/registro").send({
      nombre: "Dueño Espera",
      telefono: "+34600000050",
      email: `dueno_esp_${sufijo}@turno.test`,
      password: "password123",
      rol: "admin_negocio",
    });
    tokenDueno = dueno.body.token;
    duenoId = dueno.body.usuario.id;
    await prisma.usuario.update({
      where: { id: duenoId },
      data: { emailVerificadoEn: new Date() },
    });

    const negocio = await prisma.negocio.create({
      data: {
        nombreComercial: `Espera ${sufijo}`,
        slug: `espera-${sufijo}`,
        direccion: "Calle Cola 1",
        telefonoContacto: "+34600000051",
        duenoId,
        timezone: "Europe/Madrid",
        estadoSuscripcion: "activo",
        suscripcionHasta: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    negocioId = negocio.id;
    await prisma.peluqueroEquipo.create({
      data: { negocioId, usuarioId: duenoId, estadoAprobacion: "aceptado" },
    });

    const servicio = await prisma.servicio.create({
      data: {
        peluqueroId: duenoId,
        nombreServicio: "Corte bono",
        precio: 20,
        moneda: "EUR",
        duracionMinutos: 30,
      },
    });
    servicioId = servicio.id;

    // Disponibilidad todos los días para no depender del día de la semana.
    const dias = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const;
    await prisma.disponibilidad.createMany({
      data: dias.map((dia) => ({
        peluqueroId: duenoId,
        dia: dia as never,
        horaInicio: "09:00",
        horaFin: "18:00",
      })),
    });

    const cliente = await request(app).post("/api/auth/registro").send({
      nombre: "Cliente Espera",
      telefono: "+34600000052",
      email: `cliente_esp_${sufijo}@turno.test`,
      password: "password123",
      rol: "cliente",
    });
    tokenCliente = cliente.body.token;
    clienteId = cliente.body.usuario.id;
    await prisma.usuario.update({
      where: { id: clienteId },
      data: { emailVerificadoEn: new Date() },
    });

    fechaLibre = sumarDias(ahoraEnZona("Europe/Madrid").fechaISO, 5);
  });

  afterAll(async () => {
    await prisma.reservacion.deleteMany({ where: { peluqueroId: duenoId } });
    await prisma.listaEspera.deleteMany({ where: { peluqueroId: duenoId } });
    await prisma.bonoCliente.deleteMany({ where: { clienteId } });
    await prisma.paquete.deleteMany({ where: { negocioId } });
    await prisma.disponibilidad.deleteMany({ where: { peluqueroId: duenoId } });
    await prisma.servicio.deleteMany({ where: { peluqueroId: duenoId } });
    await prisma.peluqueroEquipo.deleteMany({ where: { negocioId } });
    await prisma.negocio.deleteMany({ where: { id: negocioId } });
    await prisma.refreshToken.deleteMany({ where: { usuarioId: { in: [duenoId, clienteId] } } });
    await prisma.emailVerificationToken.deleteMany({
      where: { usuarioId: { in: [duenoId, clienteId] } },
    });
    await prisma.usuario.deleteMany({ where: { id: { in: [duenoId, clienteId] } } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- espera

  it("un cliente se apunta a la lista de espera de un día", async () => {
    const res = await request(app)
      .post("/api/espera")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: fechaLibre, horaDesde: "10:00", horaHasta: "14:00" });
    expect(res.status).toBe(201);
    expect(res.body.espera.fecha).toBe(fechaLibre);
  });

  it("apuntarse dos veces al mismo día no duplica la fila", async () => {
    await request(app)
      .post("/api/espera")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: fechaLibre });
    const filas = await prisma.listaEspera.count({
      where: { clienteId, peluqueroId: duenoId, fecha: fechaUTC(fechaLibre) },
    });
    expect(filas).toBe(1);
  });

  it("no se puede esperar por un día que ya pasó", async () => {
    const ayer = sumarDias(ahoraEnZona("Europe/Madrid").fechaISO, -1);
    const res = await request(app)
      .post("/api/espera")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: ayer });
    expect(res.status).toBe(400);
  });

  it("exige las dos horas de la franja o ninguna", async () => {
    const res = await request(app)
      .post("/api/espera")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: fechaLibre, horaDesde: "10:00" });
    expect(res.status).toBe(400);
  });

  it("el negocio ve la cola de ese día", async () => {
    const res = await request(app)
      .get(`/api/espera/cola?peluqueroId=${duenoId}&fecha=${fechaLibre}`)
      .set("Authorization", `Bearer ${tokenDueno}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("un hueco liberado avisa a quien espera, y solo una vez", async () => {
    // La franja quedó sin definir al reapuntarse, así que cualquier hora encaja.
    const avisados = await avisarListaEspera({
      peluqueroId: duenoId,
      fecha: fechaUTC(fechaLibre),
      horaInicio: "11:00",
      horaFin: "11:30",
      tz: "Europe/Madrid",
    });
    expect(avisados).toBe(1);

    const fila = await prisma.listaEspera.findFirst({ where: { clienteId, peluqueroId: duenoId } });
    expect(fila?.avisadoEn).toBeTruthy();

    // Segundo hueco del mismo día: ya está avisado, no se le repite el email.
    const otra = await avisarListaEspera({
      peluqueroId: duenoId,
      fecha: fechaUTC(fechaLibre),
      horaInicio: "12:00",
      horaFin: "12:30",
      tz: "Europe/Madrid",
    });
    expect(otra).toBe(0);
  });

  it("no avisa de un hueco que ya pasó", async () => {
    const ayer = sumarDias(ahoraEnZona("Europe/Madrid").fechaISO, -1);
    await prisma.listaEspera.create({
      data: { clienteId, peluqueroId: duenoId, servicioId, fecha: fechaUTC(ayer) },
    });
    const avisados = await avisarListaEspera({
      peluqueroId: duenoId,
      fecha: fechaUTC(ayer),
      horaInicio: "11:00",
      horaFin: "11:30",
      tz: "Europe/Madrid",
    });
    expect(avisados).toBe(0);
  });

  it("solo se sale de la propia lista de espera", async () => {
    const fila = await prisma.listaEspera.findFirst({ where: { clienteId, cancelada: false } });
    const ajeno = await request(app)
      .delete(`/api/espera/${fila!.id}`)
      .set("Authorization", `Bearer ${tokenDueno}`);
    expect(ajeno.status).toBe(403);

    const propio = await request(app)
      .delete(`/api/espera/${fila!.id}`)
      .set("Authorization", `Bearer ${tokenCliente}`);
    expect(propio.status).toBe(200);
  });

  // ---------------------------------------------------------------- bonos

  let paqueteId = 0;

  it("el negocio crea un paquete de sesiones", async () => {
    const res = await request(app)
      .post("/api/bonos/paquetes")
      .set("Authorization", `Bearer ${tokenDueno}`)
      .send({
        negocioId,
        servicioId,
        nombre: "10 cortes",
        sesiones: 10,
        precio: 160,
        moneda: "EUR",
        validezDias: 365,
      });
    expect(res.status).toBe(201);
    paqueteId = res.body.paquete.id;
  });

  it("no se puede crear un paquete con un servicio de otro equipo", async () => {
    const ajeno = await prisma.servicio.findFirst({ where: { peluqueroId: { not: duenoId } } });
    if (!ajeno) return; // sin datos de seed no aplica
    const res = await request(app)
      .post("/api/bonos/paquetes")
      .set("Authorization", `Bearer ${tokenDueno}`)
      .send({ negocioId, servicioId: ajeno.id, nombre: "Ajeno", sesiones: 5, precio: 50 });
    expect(res.status).toBe(400);
  });

  it("emitir un bono a un email sin cuenta falla con un mensaje claro", async () => {
    const res = await request(app)
      .post("/api/bonos/emitir")
      .set("Authorization", `Bearer ${tokenDueno}`)
      .send({ paqueteId, clienteEmail: `nadie_${sufijo}@turno.test` });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CLIENTE_SIN_CUENTA");
  });

  it("emite el bono al cliente con sus sesiones", async () => {
    const res = await request(app)
      .post("/api/bonos/emitir")
      .set("Authorization", `Bearer ${tokenDueno}`)
      .send({ paqueteId, clienteEmail: `cliente_esp_${sufijo}@turno.test` });
    expect(res.status).toBe(201);
    expect(res.body.bono.sesionesTotales).toBe(10);
    expect(res.body.bono.sesionesUsadas).toBe(0);
  });

  it("reservar con bono NO cobra fianza, descuenta sesión y confirma al instante", async () => {
    const res = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: fechaLibre, horaInicio: "10:00" });

    expect(res.status).toBe(201);
    // La diferencia clave: no hay intento de pago que completar.
    expect(res.body.pago).toBeNull();
    expect(res.body.bono.usado).toBe(true);
    expect(res.body.reserva.pagoReservaStatus).toBe("pagado");
    expect(res.body.reserva.expiraPagoEn).toBeNull();

    const bono = await prisma.bonoCliente.findFirst({ where: { clienteId } });
    expect(bono?.sesionesUsadas).toBe(1);
  });

  it("cancelar a tiempo devuelve la sesión del bono", async () => {
    const reserva = await prisma.reservacion.findFirst({
      where: { clienteId, bonoId: { not: null }, estadoCita: "confirmada" },
    });
    expect(reserva).toBeTruthy();

    const res = await request(app)
      .patch(`/api/reservas/${reserva!.id}/cancelar`)
      .set("Authorization", `Bearer ${tokenCliente}`);
    expect(res.status).toBe(200);
    expect(res.body.sesionBonoDevuelta).toBe(true);

    const bono = await prisma.bonoCliente.findFirst({ where: { clienteId } });
    expect(bono?.sesionesUsadas).toBe(0);
  });

  it("un bono agotado deja de aplicarse y la reserva vuelve a pedir fianza", async () => {
    await prisma.bonoCliente.updateMany({ where: { clienteId }, data: { sesionesUsadas: 10 } });
    const res = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: fechaLibre, horaInicio: "15:00" });
    expect(res.status).toBe(201);
    expect(res.body.bono).toBeUndefined();
    expect(res.body.pago).toBeTruthy();
    expect(res.body.reserva.pagoReservaStatus).toBe("pendiente");
  });

  it("un bono caducado tampoco se aplica", async () => {
    await prisma.bonoCliente.updateMany({
      where: { clienteId },
      data: { sesionesUsadas: 0, expiraEn: new Date(Date.now() - 86_400_000) },
    });
    const res = await request(app)
      .post("/api/reservas")
      .set("Authorization", `Bearer ${tokenCliente}`)
      .send({ peluqueroId: duenoId, servicioId, fecha: fechaLibre, horaInicio: "16:00" });
    expect(res.status).toBe(201);
    expect(res.body.pago).toBeTruthy();
  });

  it("el cliente ve sus bonos con las sesiones restantes", async () => {
    const res = await request(app).get("/api/bonos/mios").set("Authorization", `Bearer ${tokenCliente}`);
    expect(res.status).toBe(200);
    expect(res.body.bonos[0].restantes).toBe(10);
    expect(res.body.bonos[0].caducado).toBe(true);
  });

  it("el negocio ve el resumen de bonos vendidos", async () => {
    const res = await request(app)
      .get(`/api/bonos/negocio/${negocioId}`)
      .set("Authorization", `Bearer ${tokenDueno}`);
    expect(res.status).toBe(200);
    expect(res.body.resumen.vendidos).toBe(1);
    expect(res.body.resumen.sesionesVendidas).toBe(10);
    expect(res.body.resumen.ingresos).toBe(160);
  });

  it("otro negocio no puede ver mis bonos", async () => {
    const res = await request(app)
      .get(`/api/bonos/negocio/${negocioId}`)
      .set("Authorization", `Bearer ${tokenCliente}`);
    // El cliente no tiene rol de negocio: 403 por rol.
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------- propina

  it("la propina se registra al cerrar la cita y sale en los ingresos", async () => {
    const reserva = await prisma.reservacion.findFirst({
      where: { clienteId, estadoCita: "confirmada", pagoReservaStatus: "pendiente" },
    });
    expect(reserva).toBeTruthy();
    // Se marca como pagada para poder cerrarla (cerrarCita exige fianza cobrada).
    await prisma.reservacion.update({
      where: { id: reserva!.id },
      data: { pagoReservaStatus: "pagado" },
    });

    const cierre = await request(app)
      .patch(`/api/reservas/${reserva!.id}/completar`)
      .set("Authorization", `Bearer ${tokenDueno}`)
      .send({ propina: 5 });
    expect(cierre.status).toBe(200);

    const guardada = await prisma.reservacion.findUnique({ where: { id: reserva!.id } });
    expect(Number(guardada?.propina)).toBe(5);

    const ingresos = await request(app)
      .get(`/api/reservas/mis-ingresos?desde=${fechaISO(new Date(Date.now() - 86_400_000))}`)
      .set("Authorization", `Bearer ${tokenDueno}`);
    expect(ingresos.status).toBe(200);
    const propinasEur = ingresos.body.propinas.find((p: { moneda: string }) => p.moneda === "EUR");
    expect(propinasEur?.total).toBe(5);
  });
});
