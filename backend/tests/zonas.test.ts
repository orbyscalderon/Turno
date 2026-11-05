import { describe, it, expect } from "vitest";
import {
  fechaUTC,
  fechaISO,
  sumarDias,
  instanteEnZona,
  ahoraEnZona,
  zonaSegura,
  horasHasta,
  diaSemanaDeFecha,
} from "../src/lib/time.js";
import { estaVigente, diasRestantes } from "../src/lib/suscripcion.js";

describe("fechas de calendario (@db.Date)", () => {
  it("fechaUTC siempre cae a medianoche UTC (no desplaza el día)", () => {
    const d = fechaUTC("2026-01-05");
    expect(d.toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  it("es reversible con fechaISO en cualquier zona del servidor", () => {
    for (const f of ["2026-01-01", "2026-06-15", "2026-12-31", "2027-02-28"]) {
      expect(fechaISO(fechaUTC(f))).toBe(f);
    }
  });

  it("no pierde el día con horario de verano europeo", () => {
    // 29/03/2026 es el cambio a horario de verano en Europa.
    expect(fechaISO(fechaUTC("2026-03-29"))).toBe("2026-03-29");
  });

  it("suma días cruzando fin de mes y de año", () => {
    expect(sumarDias("2026-01-31", 1)).toBe("2026-02-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("el día de la semana no depende de la zona del proceso", () => {
    expect(diaSemanaDeFecha("2026-11-09")).toBe("lunes");
    expect(diaSemanaDeFecha("2026-11-08")).toBe("domingo");
  });
});

describe("horas de pared por zona horaria", () => {
  it("convierte una hora local a instante UTC (invierno en Madrid: +1)", () => {
    const i = instanteEnZona("2026-01-15", "10:00", "Europe/Madrid");
    expect(i.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("aplica el horario de verano (Madrid: +2)", () => {
    const i = instanteEnZona("2026-07-15", "10:00", "Europe/Madrid");
    expect(i.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });

  it("funciona con zonas al oeste de UTC", () => {
    const i = instanteEnZona("2026-07-15", "10:00", "America/Bogota"); // -5 todo el año
    expect(i.toISOString()).toBe("2026-07-15T15:00:00.000Z");
  });

  it("la misma hora de pared en dos zonas son instantes distintos", () => {
    const madrid = instanteEnZona("2026-07-15", "10:00", "Europe/Madrid");
    const bogota = instanteEnZona("2026-07-15", "10:00", "America/Bogota");
    expect(bogota.getTime() - madrid.getTime()).toBe(7 * 3600 * 1000);
  });

  it("una zona inválida cae a UTC en lugar de reventar", () => {
    expect(zonaSegura("Marte/Olympus")).toBe("UTC");
    expect(zonaSegura(null)).toBe("UTC");
    expect(zonaSegura("Europe/Madrid")).toBe("Europe/Madrid");
  });

  it("ahoraEnZona devuelve fecha y minutos coherentes", () => {
    const { fechaISO: f, minutos } = ahoraEnZona("Europe/Madrid");
    expect(f).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(minutos).toBeGreaterThanOrEqual(0);
    expect(minutos).toBeLessThan(1440);
  });

  it("horasHasta es negativo para el pasado y positivo para el futuro", () => {
    expect(horasHasta("2020-01-01", "10:00", "Europe/Madrid")).toBeLessThan(0);
    expect(horasHasta("2099-01-01", "10:00", "Europe/Madrid")).toBeGreaterThan(0);
  });
});

describe("vigencia de la suscripción", () => {
  const enDias = (d: number) => new Date(Date.now() + d * 86_400_000);

  it("una prueba con fecha futura es vigente", () => {
    expect(estaVigente({ estadoSuscripcion: "prueba", suscripcionHasta: enDias(5) })).toBe(true);
  });

  it("una prueba CADUCADA no es vigente (el bug de la prueba infinita)", () => {
    expect(estaVigente({ estadoSuscripcion: "prueba", suscripcionHasta: enDias(-1) })).toBe(false);
  });

  it("un plan activo caducado no es vigente", () => {
    expect(estaVigente({ estadoSuscripcion: "activo", suscripcionHasta: enDias(-30) })).toBe(false);
  });

  it("vencido nunca es vigente, aunque la fecha sea futura", () => {
    expect(estaVigente({ estadoSuscripcion: "vencido", suscripcionHasta: enDias(10) })).toBe(false);
  });

  it("activo sin fecha se considera vigente (lo gestiona Stripe)", () => {
    expect(estaVigente({ estadoSuscripcion: "activo", suscripcionHasta: null })).toBe(true);
    expect(estaVigente({ estadoSuscripcion: "prueba", suscripcionHasta: null })).toBe(false);
  });

  it("calcula los días restantes", () => {
    expect(diasRestantes(enDias(3))).toBe(3);
    expect(diasRestantes(null)).toBeNull();
    expect(diasRestantes(enDias(-2))).toBeLessThan(0);
  });
});
