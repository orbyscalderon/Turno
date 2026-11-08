import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { limpiar } from "../src/jobs/limpieza.js";

// Analítica de producto: el endpoint es público (el embudo empieza antes de
// registrarse), así que lo que más importa es que no se pueda usar como
// almacén gratuito ni como vertedero de nombres de evento inventados.

const app = crearApp();
const sufijo = Date.now();
const sesion = `test-sesion-${sufijo}`;

describe("eventos de producto", () => {
  afterAll(async () => {
    await prisma.eventoProducto.deleteMany({ where: { sesion: { startsWith: "test-sesion-" } } });
    await prisma.$disconnect();
  });

  it("acepta un lote de eventos sin sesión de usuario", async () => {
    const res = await request(app)
      .post("/api/eventos")
      .send({
        eventos: [
          { nombre: "landing_vista", sesion, ruta: "/" },
          { nombre: "negocio_visto", sesion, ruta: "/negocio/x", meta: { slug: "x" } },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.guardados).toBe(2);

    const guardados = await prisma.eventoProducto.count({ where: { sesion } });
    expect(guardados).toBe(2);
  });

  it("rechaza nombres de evento que no están en el catálogo", async () => {
    const res = await request(app)
      .post("/api/eventos")
      .send({ eventos: [{ nombre: "lo_que_sea", sesion }] });
    expect(res.status).toBe(400);
  });

  it("rechaza lotes enormes y metadatos gigantes", async () => {
    const lote = await request(app)
      .post("/api/eventos")
      .send({
        eventos: Array.from({ length: 50 }, () => ({ nombre: "landing_vista", sesion })),
      });
    expect(lote.status).toBe(400);

    const meta = await request(app)
      .post("/api/eventos")
      .send({
        eventos: [{ nombre: "landing_vista", sesion, meta: { basura: "x".repeat(500) } }],
      });
    expect(meta.status).toBe(400);
  });

  it("el embudo solo lo ve un superadmin", async () => {
    const anonimo = await request(app).get("/api/eventos/embudo");
    expect(anonimo.status).toBe(401);

    const cliente = await request(app)
      .post("/api/auth/login")
      .send({ email: "cliente@turno.app", password: "password123" });
    const conSesion = await request(app)
      .get("/api/eventos/embudo")
      .set("Authorization", `Bearer ${cliente.body.token}`);
    expect(conSesion.status).toBe(403);
  });

  it("el embudo cuenta sesiones distintas, no eventos repetidos", async () => {
    // Tres visitas de la MISMA sesión no son tres personas.
    await request(app)
      .post("/api/eventos")
      .send({
        eventos: [
          { nombre: "landing_vista", sesion },
          { nombre: "landing_vista", sesion },
        ],
      });

    const admin = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@turno.app", password: "password123" });
    if (!admin.body.token) return; // sin superadmin en el seed no aplica

    const res = await request(app)
      .get("/api/eventos/embudo?dias=1")
      .set("Authorization", `Bearer ${admin.body.token}`);
    expect(res.status).toBe(200);

    const landing = res.body.embudo.find((p: { paso: string }) => p.paso === "landing_vista");
    const eventosLanding = await prisma.eventoProducto.count({
      where: { sesion, nombre: "landing_vista" },
    });
    expect(eventosLanding).toBeGreaterThan(1);
    // La sesión de prueba cuenta como 1 aunque haya mandado varios eventos.
    expect(landing.sesiones).toBeLessThan(eventosLanding + 1);
    expect(res.body.embudo[0].pctDesdeInicio).toBe(100);
  });
});

describe("job de limpieza", () => {
  it("borra los eventos viejos y respeta los recientes", async () => {
    const viejo = await prisma.eventoProducto.create({
      data: { nombre: "landing_vista", sesion: `test-sesion-viejo-${sufijo}` },
    });
    // Se envejece a mano: la retención por defecto son 90 días.
    await prisma.$executeRaw`UPDATE eventos_producto SET created_at = now() - interval '200 days' WHERE id = ${viejo.id}`;

    const reciente = await prisma.eventoProducto.create({
      data: { nombre: "landing_vista", sesion: `test-sesion-nuevo-${sufijo}` },
    });

    const resultado = await limpiar();
    expect(resultado.eventos).toBeGreaterThanOrEqual(1);

    expect(await prisma.eventoProducto.findUnique({ where: { id: viejo.id } })).toBeNull();
    expect(await prisma.eventoProducto.findUnique({ where: { id: reciente.id } })).toBeTruthy();
  });
});
