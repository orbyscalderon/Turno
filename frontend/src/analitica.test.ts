import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { evento } from "./analitica";
import { setToken } from "./api";

// Lo que importa de la analítica: que agrupe en lotes (no una petición por clic),
// que no reviente nunca y que no bloquee la interfaz.

describe("analitica", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    beacon = vi.fn().mockReturnValue(true);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  });

  afterEach(() => {
    // La cola vive en el módulo: se vacía ANTES de volver a los relojes reales
    // para que un test no arrastre eventos al siguiente.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("no envía nada de inmediato: agrupa en un lote", () => {
    evento("landing_vista");
    expect(beacon).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envía el lote pasado el tiempo de espera", () => {
    evento("landing_vista");
    evento("negocio_visto", { slug: "x" });
    vi.advanceTimersByTime(2000);

    expect(beacon).toHaveBeenCalledOnce();
    // Dos eventos, UNA petición: es el punto del lote.
    const [, blob] = beacon.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
  });

  it("con sesión usa fetch con el token, para atribuir el evento", async () => {
    setToken("mi-token");
    evento("pago_completado");
    vi.advanceTimersByTime(2000);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer mi-token");
    // keepalive: el evento sobrevive a que la pestaña se cierre justo después.
    expect(init.keepalive).toBe(true);
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.eventos[0].nombre).toBe("pago_completado");
    expect(cuerpo.eventos[0].sesion).toHaveLength(32);
    setToken(null);
  });

  it("al llegar al máximo del lote envía sin esperar", () => {
    for (let i = 0; i < 20; i++) evento("landing_vista");
    // Sin avanzar el reloj: 20 eventos ya son un lote completo.
    expect(beacon).toHaveBeenCalledOnce();
  });

  it("si falla el envío no propaga el error", () => {
    beacon.mockImplementation(() => {
      throw new Error("bloqueado por el navegador");
    });
    evento("landing_vista");
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });

  it("sin sessionStorage sigue funcionando", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("bloqueado");
      },
      configurable: true,
    });
    expect(() => evento("landing_vista")).not.toThrow();
    if (original) Object.defineProperty(window, "sessionStorage", original);
  });
});
