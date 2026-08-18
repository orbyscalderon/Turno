import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Tests de integración contra la BD real. Crean un usuario desechable y lo eliminan al final.
const app = crearApp();
const email = `test_${Date.now()}@turno.test`;
let token = "";
let refreshToken = "";

describe("auth flow (integración)", () => {
  afterAll(async () => {
    await prisma.usuario.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("registra un usuario y devuelve tokens", async () => {
    const res = await request(app).post("/api/auth/registro").send({
      nombre: "Test User",
      telefono: "+34600000000",
      email,
      password: "password123",
      rol: "cliente",
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    token = res.body.token;
    refreshToken = res.body.refreshToken;
  });

  it("devuelve el perfil con el token de acceso", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.usuario.email).toBe(email);
  });

  it("rechaza sin token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("renueva el token con el refresh token (rotación)", async () => {
    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(refreshToken); // rotado
  });

  it("lista negocios públicos con metadata de paginación", async () => {
    const res = await request(app).get("/api/negocios");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.negocios)).toBe(true);
    expect(res.body.meta).toHaveProperty("total");
  });

  it("borra la cuenta (GDPR) y luego el login falla", async () => {
    const del = await request(app).delete("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    const login = await request(app).post("/api/auth/login").send({ email, password: "password123" });
    expect(login.status).toBe(401);
  });
});

describe("negocios (integración)", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("filtra por categoría", async () => {
    const res = await request(app).get("/api/negocios?categoria=estetica");
    expect(res.status).toBe(200);
    for (const n of res.body.negocios) expect(n.categoria).toBe("estetica");
  });

  it("ordena por cercanía cuando se pasan lat/lng", async () => {
    const res = await request(app).get("/api/negocios?lat=39.47&lng=-0.376");
    expect(res.status).toBe(200);
    // El primero debería tener distancia definida (si hay negocios con coords).
    if (res.body.negocios.length > 0 && res.body.negocios[0].distanciaKm != null) {
      const d = res.body.negocios.map((n: any) => n.distanciaKm ?? Infinity);
      const ordenado = [...d].sort((a, b) => a - b);
      expect(d).toEqual(ordenado);
    }
  });
});
