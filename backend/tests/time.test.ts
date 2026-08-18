import { describe, it, expect } from "vitest";
import { toMinutes, toHHMM, seSolapan, diaSemanaDeFecha } from "../src/lib/time.js";

describe("conversión de horas", () => {
  it("convierte HH:MM a minutos", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("23:59")).toBe(1439);
  });
  it("convierte minutos a HH:MM con padding", () => {
    expect(toHHMM(0)).toBe("00:00");
    expect(toHHMM(570)).toBe("09:30");
    expect(toHHMM(645)).toBe("10:45");
  });
  it("es reversible", () => {
    for (const t of ["07:15", "12:00", "18:45"]) expect(toHHMM(toMinutes(t))).toBe(t);
  });
});

describe("colisión de intervalos (semiabiertos)", () => {
  it("intervalos adyacentes NO se solapan", () => {
    expect(seSolapan(600, 630, 630, 660)).toBe(false); // 10:00-10:30 y 10:30-11:00
  });
  it("intervalos que se cruzan SÍ se solapan", () => {
    expect(seSolapan(600, 630, 615, 645)).toBe(true);
  });
  it("un intervalo contenido en otro SÍ se solapa", () => {
    expect(seSolapan(600, 660, 615, 630)).toBe(true);
    expect(seSolapan(615, 630, 600, 660)).toBe(true);
  });
  it("intervalos separados NO se solapan", () => {
    expect(seSolapan(540, 600, 600, 660)).toBe(false);
    expect(seSolapan(540, 570, 600, 660)).toBe(false);
  });
  it("es simétrica", () => {
    expect(seSolapan(600, 630, 615, 645)).toBe(seSolapan(615, 645, 600, 630));
  });
});

describe("día de la semana", () => {
  it("mapea fechas ISO a día en español", () => {
    expect(diaSemanaDeFecha("2026-07-19")).toBe("domingo");
    expect(diaSemanaDeFecha("2026-07-20")).toBe("lunes");
    expect(diaSemanaDeFecha("2026-07-25")).toBe("sabado");
  });
});

// Reimplementa el bucle de generación de slots del motor para probar la lógica de forma aislada.
function generarSlots(
  rango: { inicio: string; fin: string },
  duracion: number,
  ocupadas: { inicio: string; fin: string }[],
  granularidad = 15,
): string[] {
  const rI = toMinutes(rango.inicio), rF = toMinutes(rango.fin);
  const bloqueos = ocupadas.map((o) => ({ inicio: toMinutes(o.inicio), fin: toMinutes(o.fin) }));
  const out: string[] = [];
  for (let i = rI; i + duracion <= rF; i += granularidad) {
    if (!bloqueos.some((b) => seSolapan(i, i + duracion, b.inicio, b.fin))) out.push(toHHMM(i));
  }
  return out;
}

describe("generación de slots", () => {
  it("respeta el fin del rango según la duración", () => {
    const slots = generarSlots({ inicio: "09:00", fin: "10:00" }, 30, []);
    expect(slots).toEqual(["09:00", "09:15", "09:30"]); // 09:30+30=10:00 cabe; 09:45 no
  });
  it("excluye slots que solapan una cita existente", () => {
    const slots = generarSlots({ inicio: "09:00", fin: "12:00" }, 30, [{ inicio: "10:00", fin: "10:30" }]);
    expect(slots).toContain("09:30");
    expect(slots).not.toContain("09:45"); // 10:15 solaparía
    expect(slots).not.toContain("10:00");
    expect(slots).not.toContain("10:15");
    expect(slots).toContain("10:30"); // justo tras la cita
  });
  it("sin disponibilidad no hay slots", () => {
    expect(generarSlots({ inicio: "09:00", fin: "09:20" }, 30, [])).toEqual([]);
  });
});
