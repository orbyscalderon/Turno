import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { crearApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  generarSecreto,
  codigoTotp,
  verificarTotp,
  base32Codificar,
  base32Decodificar,
  cifrarSecreto,
  descifrarSecreto,
  hashCodigoRecuperacion,
} from "../src/lib/totp.js";

const app = crearApp();
const sufijo = Date.now();
const email = `dosfactores_${sufijo}@turno.test`;
const password = "password123";

let token = "";
let usuarioId = 0;
let secreto = "";

describe("TOTP: el algoritmo", () => {
  // Vectores de la RFC 6238 (secreto ASCII "12345678901234567890", SHA-1).
  // Si estos fallan, ninguna app de autenticación aceptaría nuestros códigos.
  const secretoRfc = base32Codificar(Buffer.from("12345678901234567890"));

  it("reproduce los vectores de prueba de la RFC 6238", () => {
    expect(codigoTotp(secretoRfc, 59 * 1000)).toBe("287082");
    expect(codigoTotp(secretoRfc, 1111111109 * 1000)).toBe("081804");
    expect(codigoTotp(secretoRfc, 1111111111 * 1000)).toBe("050471");
    expect(codigoTotp(secretoRfc, 1234567890 * 1000)).toBe("005924");
    // Este pasa de los 32 bits del contador: con un writeUInt32BE daría otro valor.
    expect(codigoTotp(secretoRfc, 2000000000 * 1000)).toBe("279037");
  });

  it("base32 va y vuelve sin perder bytes", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decodificar(base32Codificar(buf)).equals(buf)).toBe(true);
  });

  it("acepta el código del paso anterior y del siguiente (desfase de reloj)", () => {
    const s = generarSecreto();
    const ahora = Date.now();
    expect(verificarTotp(s, codigoTotp(s, ahora - 30_000), ahora)).toBe(true);
    expect(verificarTotp(s, codigoTotp(s, ahora + 30_000), ahora)).toBe(true);
    // Dos pasos ya no: la ventana es de ±1.
    expect(verificarTotp(s, codigoTotp(s, ahora + 90_000), ahora)).toBe(false);
  });

  it("rechaza basura sin lanzar", () => {
    const s = generarSecreto();
    expect(verificarTotp(s, "")).toBe(false);
    expect(verificarTotp(s, "abcdef")).toBe(false);
    expect(verificarTotp(s, "12345")).toBe(false);
    expect(verificarTotp(s, "1234567")).toBe(false);
  });

  it("el secreto se guarda cifrado y no en claro", () => {
    const s = generarSecreto();
    const blob = cifrarSecreto(s);
    expect(blob).not.toContain(s);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(descifrarSecreto(blob)).toBe(s);
    // Un blob manipulado no descifra (AES-GCM detecta la alteración).
    expect(descifrarSecreto(blob.slice(0, -4) + "AAAA")).toBeNull();
    expect(descifrarSecreto("cualquier-cosa")).toBeNull();
  });

  it("el hash del código de recuperación ignora guiones y mayúsculas", () => {
    expect(hashCodigoRecuperacion("abcd-efgh")).toBe(hashCodigoRecuperacion("ABCDEFGH"));
  });
});

describe("TOTP: el flujo completo de la cuenta", () => {
  beforeAll(async () => {
    const registro = await request(app).post("/api/auth/registro").send({
      nombre: "Dos Factores",
      telefono: "+34600000040",
      email,
      password,
      rol: "cliente",
    });
    token = registro.body.token;
    usuarioId = registro.body.usuario.id;
  });

  afterAll(async () => {
    await prisma.codigoRecuperacion.deleteMany({ where: { usuarioId } });
    await prisma.refreshToken.deleteMany({ where: { usuarioId } });
    await prisma.emailVerificationToken.deleteMany({ where: { usuarioId } });
    await prisma.usuario.deleteMany({ where: { id: usuarioId } });
    await prisma.$disconnect();
  });

  it("empieza desactivado", async () => {
    const res = await request(app)
      .get("/api/auth/2fa/estado")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(false);
  });

  it("iniciar devuelve secreto, URI otpauth y QR", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/iniciar")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.secreto).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.uri).toContain("otpauth://totp/");
    expect(res.body.uri).toContain(encodeURIComponent(email));
    expect(res.body.qr.startsWith("data:image/png;base64,")).toBe(true);
    secreto = res.body.secreto;
  });

  it("no se activa con un código incorrecto", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/activar")
      .set("Authorization", `Bearer ${token}`)
      .send({ codigo: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("2FA_CODIGO_INVALIDO");
  });

  it("todavía se puede entrar solo con contraseña (no está activo)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.requiere2fa).toBeUndefined();
  });

  it("se activa con un código real y entrega 10 códigos de recuperación", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/activar")
      .set("Authorization", `Bearer ${token}`)
      .send({ codigo: codigoTotp(secreto) });
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(true);
    expect(res.body.codigosRecuperacion).toHaveLength(10);
    // Se guardan hasheados: la tabla no debe contener el código legible.
    const guardados = await prisma.codigoRecuperacion.findMany({ where: { usuarioId } });
    expect(guardados).toHaveLength(10);
    expect(guardados.map((g) => g.hash)).not.toContain(res.body.codigosRecuperacion[0]);
  });

  it("ahora la contraseña sola NO abre sesión: pide el segundo factor", async () => {
    const res = await request(app).post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.requiere2fa).toBe(true);
    expect(res.body.desafio).toBeTruthy();
    // Lo importante: no se filtra ninguna sesión en este paso.
    expect(res.body.token).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("el desafío con un código incorrecto no da sesión", async () => {
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const res = await request(app)
      .post("/api/auth/2fa/verificar")
      .send({ desafio: login.body.desafio, codigo: "000000" });
    expect(res.status).toBe(401);
  });

  it("el desafío con el código correcto sí da sesión", async () => {
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const res = await request(app)
      .post("/api/auth/2fa/verificar")
      .send({ desafio: login.body.desafio, codigo: codigoTotp(secreto) });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.via).toBe("totp");
    expect(res.body.usuario.dosFactoresActivo).toBe(true);
  });

  it("un token de acceso normal NO vale como desafío", async () => {
    // Si el desafío no comprobara su propósito, el primer factor bastaría.
    const res = await request(app)
      .post("/api/auth/2fa/verificar")
      .send({ desafio: token, codigo: codigoTotp(secreto) });
    expect(res.status).toBe(401);
  });

  it("un código de recuperación entra una vez y solo una", async () => {
    const activacion = await prisma.codigoRecuperacion.findFirst({
      where: { usuarioId, usadoEn: null },
    });
    expect(activacion).toBeTruthy();

    // Se regeneran para conocer uno en claro.
    const regen = await request(app)
      .post("/api/auth/2fa/recuperacion/regenerar")
      .set("Authorization", `Bearer ${token}`)
      .send({ codigo: codigoTotp(secreto) });
    expect(regen.status).toBe(200);
    const codigoRec: string = regen.body.codigosRecuperacion[0];

    const login = await request(app).post("/api/auth/login").send({ email, password });
    const primera = await request(app)
      .post("/api/auth/2fa/verificar")
      .send({ desafio: login.body.desafio, codigo: codigoRec });
    expect(primera.status).toBe(200);
    expect(primera.body.via).toBe("recuperacion");

    const login2 = await request(app).post("/api/auth/login").send({ email, password });
    const segunda = await request(app)
      .post("/api/auth/2fa/verificar")
      .send({ desafio: login2.body.desafio, codigo: codigoRec });
    expect(segunda.status).toBe(401);
  });

  it("no se puede desactivar sin la contraseña correcta", async () => {
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const sesion = await request(app)
      .post("/api/auth/2fa/verificar")
      .send({ desafio: login.body.desafio, codigo: codigoTotp(secreto) });

    const malo = await request(app)
      .post("/api/auth/2fa/desactivar")
      .set("Authorization", `Bearer ${sesion.body.token}`)
      .send({ password: "no-es-mi-password" });
    expect(malo.status).toBe(401);

    const bueno = await request(app)
      .post("/api/auth/2fa/desactivar")
      .set("Authorization", `Bearer ${sesion.body.token}`)
      .send({ password });
    expect(bueno.status).toBe(200);
    expect(bueno.body.activo).toBe(false);

    // Y al quedar desactivado, la contraseña vuelve a bastar.
    const final = await request(app).post("/api/auth/login").send({ email, password });
    expect(final.body.token).toBeTruthy();
    const codigos = await prisma.codigoRecuperacion.count({ where: { usuarioId } });
    expect(codigos).toBe(0);
  });
});
