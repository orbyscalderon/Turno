import { describe, it, expect } from "vitest";
import { generarLinkWhatsApp } from "../src/lib/whatsapp.js";
import { generarCodigoValidacion } from "../src/lib/codes.js";

describe("deep link de WhatsApp", () => {
  const datos = {
    telefonoDestino: "+34 600 111 222",
    nombreProfesional: "Ana Barber",
    nombreServicio: "Corte + Barba",
    fecha: "2026-07-20",
    hora: "10:30",
    codigoValidacion: "ABCD2345",
  };

  it("apunta a wa.me con el teléfono solo en dígitos", () => {
    const url = generarLinkWhatsApp(datos);
    expect(url.startsWith("https://wa.me/34600111222?text=")).toBe(true);
  });

  it("incluye la plantilla obligatoria con todos los datos", () => {
    const url = generarLinkWhatsApp(datos);
    const mensaje = decodeURIComponent(url.split("text=")[1]);
    expect(mensaje).toContain("Confirmé mi reserva en Turno");
    expect(mensaje).toContain("Profesional: Ana Barber");
    expect(mensaje).toContain("Servicio: Corte + Barba");
    expect(mensaje).toContain("Fecha: 20/07/2026"); // formato DD/MM/AAAA
    expect(mensaje).toContain("Hora: 10:30");
    expect(mensaje).toContain("Código de Validación: ABCD2345");
    expect(mensaje).toContain("Ya realicé el pago de la fianza");
  });
});

describe("código de validación", () => {
  it("tiene la longitud pedida y usa alfabeto sin ambigüedades", () => {
    const c = generarCodigoValidacion(8);
    expect(c).toHaveLength(8);
    expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });
  it("genera valores distintos (no colisiona trivialmente)", () => {
    const set = new Set(Array.from({ length: 500 }, () => generarCodigoValidacion(8)));
    expect(set.size).toBeGreaterThan(495); // altísima probabilidad de unicidad
  });
});
