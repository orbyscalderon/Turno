import { describe, it, expect } from "vitest";
import { calcularAmortizacion } from "../src/lib/amortizacion.js";

describe("Amortización (sistema francés)", () => {
  it("con interés 0 reparte el capital linealmente", () => {
    const c = calcularAmortizacion({ capital: 1200, tasaInteresMensual: 0, plazoCuotas: 12, frecuencia: "mensual", fechaInicio: new Date("2026-01-01") });
    expect(c).toHaveLength(12);
    expect(c[0].monto).toBe(100);
    expect(Math.round(c.reduce((s, x) => s + x.capital, 0))).toBe(1200);
  });

  it("con interés genera cuota fija y liquida exactamente el capital", () => {
    const c = calcularAmortizacion({ capital: 1000, tasaInteresMensual: 5, plazoCuotas: 6, frecuencia: "mensual", fechaInicio: new Date("2026-01-01") });
    expect(c).toHaveLength(6);
    expect(Math.abs(c[0].monto - c[1].monto)).toBeLessThan(0.02); // cuotas casi iguales
    expect(Math.round(c.reduce((s, x) => s + x.capital, 0))).toBe(1000); // capital total = principal
    expect(c.reduce((s, x) => s + x.interes, 0)).toBeGreaterThan(0); // hay interés
  });

  it("respeta la frecuencia en las fechas de vencimiento", () => {
    const c = calcularAmortizacion({ capital: 100, tasaInteresMensual: 0, plazoCuotas: 2, frecuencia: "semanal", fechaInicio: new Date("2026-01-01") });
    const dias = (c[0].fechaVencimiento.getTime() - new Date("2026-01-01").getTime()) / 86_400_000;
    expect(dias).toBe(7);
  });
});
