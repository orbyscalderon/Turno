import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  api,
  ApiError,
  assetUrl,
  apiUrl,
  formatPrecio,
  getToken,
  setToken,
  setSession,
  getRefreshToken,
  motivoCancelacionTexto,
  zonaDelNavegador,
  TIMEZONES,
  categoriaLabel,
  categoriaEmoji,
} from "./api";

// El cliente HTTP es el punto por el que pasa TODO lo que hace la aplicación:
// la renovación del token, el formato de errores y las URLs de imágenes. Un
// fallo aquí no se nota en un sitio, se nota en todos.

function respuesta(status: number, cuerpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (cuerpo === undefined ? "" : JSON.stringify(cuerpo)),
    // El refresco usa .json() y el resto .text(): hacen falta los dos.
    json: async () => cuerpo,
  } as Response;
}

describe("sesión en localStorage", () => {
  it("guarda, lee y borra el token", () => {
    expect(getToken()).toBeNull();
    setToken("abc");
    expect(getToken()).toBe("abc");
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it("setSession deja el refresh intacto si no se pasa", () => {
    setSession("t1", "r1");
    expect(getRefreshToken()).toBe("r1");
    setSession("t2");
    expect(getToken()).toBe("t2");
    // Importante: si lo borrara, la sesión moriría en el primer 401.
    expect(getRefreshToken()).toBe("r1");
  });

  it("setSession con null cierra la sesión entera", () => {
    setSession("t", "r");
    setSession(null, null);
    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

describe("peticiones", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("manda el token cuando hay sesión y no cuando no la hay", async () => {
    fetchMock.mockResolvedValue(respuesta(200, { ok: true }));

    await api.get("/stats");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    setToken("mi-token");
    await api.get("/stats");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer mi-token");
  });

  it("serializa el cuerpo en JSON", async () => {
    fetchMock.mockResolvedValue(respuesta(200, {}));
    await api.post("/reservas", { peluqueroId: 7 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ peluqueroId: 7 });
  });

  it("convierte el error de la API en ApiError con código", async () => {
    fetchMock.mockResolvedValue(respuesta(409, { error: "Ese horario ya está cogido", code: "SLOT_OCUPADO" }));

    await expect(api.post("/reservas", {})).rejects.toMatchObject({
      status: 409,
      message: "Ese horario ya está cogido",
      code: "SLOT_OCUPADO",
    });
    await expect(api.post("/reservas", {})).rejects.toBeInstanceOf(ApiError);
  });

  it("una respuesta vacía no rompe el parseo", async () => {
    fetchMock.mockResolvedValue(respuesta(204, undefined));
    await expect(api.del("/espera/1")).resolves.toBeNull();
  });

  it("ante un 401 renueva el token y reintenta la petición una vez", async () => {
    setSession("viejo", "refresh-1");
    fetchMock
      .mockResolvedValueOnce(respuesta(401, { error: "Token inválido o expirado" }))
      .mockResolvedValueOnce(respuesta(200, { token: "nuevo", refreshToken: "refresh-2" }))
      .mockResolvedValueOnce(respuesta(200, { reservas: [] }));

    const datos = await api.get<{ reservas: unknown[] }>("/reservas/mias");
    expect(datos.reservas).toEqual([]);
    expect(getToken()).toBe("nuevo");
    expect(getRefreshToken()).toBe("refresh-2");

    // El reintento lleva ya el token nuevo.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer nuevo");
  });

  it("si el refresh falla, el 401 se propaga y no reintenta en bucle", async () => {
    setSession("viejo", "refresh-roto");
    fetchMock
      .mockResolvedValueOnce(respuesta(401, { error: "expirado" }))
      .mockResolvedValueOnce(respuesta(401, { error: "refresh inválido" }));

    await expect(api.get("/reservas/mias")).rejects.toMatchObject({ status: 401 });
    // Una petición original + un intento de refresh. Nada más.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sin refresh token no intenta renovar", async () => {
    setToken("solo-acceso");
    fetchMock.mockResolvedValueOnce(respuesta(401, { error: "expirado" }));
    await expect(api.get("/reservas/mias")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("varias peticiones que fallan a la vez comparten una sola renovación", async () => {
    setSession("viejo", "refresh-1");
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return respuesta(200, { token: "nuevo", refreshToken: "refresh-2" });
      }
      // El primer intento de cada petición falla; el reintento (con token nuevo) va bien.
      const auth = "nuevo";
      return getToken() === auth ? respuesta(200, { ok: true }) : respuesta(401, { error: "exp" });
    });

    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    const refrescos = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    // Tres renovaciones simultáneas invalidarían el token entre sí (hay rotación).
    expect(refrescos).toHaveLength(1);
  });
});

describe("utilidades", () => {
  it("assetUrl respeta las URLs absolutas y completa las relativas", () => {
    expect(assetUrl("https://cdn.x.com/a.png")).toBe("https://cdn.x.com/a.png");
    expect(assetUrl("/uploads/a.png")).toBe("/uploads/a.png"); // sin VITE_API_URL en test
    expect(assetUrl(null)).toBeUndefined();
    expect(assetUrl("")).toBeUndefined();
  });

  it("apiUrl construye rutas de la API", () => {
    expect(apiUrl("/api/sitemap.xml")).toBe("/api/sitemap.xml");
  });

  it("formatPrecio usa la moneda y aguanta una moneda inválida", () => {
    expect(formatPrecio(12.5, "EUR")).toMatch(/12[.,]50/);
    // Una moneda inexistente haría estallar Intl: debe degradar, no romper.
    expect(formatPrecio(10, "XXXX")).toBe("XXXX 10.00");
    expect(formatPrecio("7.5")).toMatch(/7[.,]50/);
  });

  it("motivoCancelacionTexto solo habla si hay motivo", () => {
    expect(motivoCancelacionTexto({ canceladaPor: null, motivoCancelacion: null })).toBeNull();
    expect(
      motivoCancelacionTexto({ canceladaPor: "negocio", motivoCancelacion: "Baja médica" }),
    ).toBe("Baja médica");
    expect(motivoCancelacionTexto({ canceladaPor: "negocio", motivoCancelacion: null })).toBeNull();
  });

  it("zonaDelNavegador devuelve siempre una zona usable", () => {
    const z = zonaDelNavegador();
    expect(typeof z).toBe("string");
    expect(z.length).toBeGreaterThan(2);
    // Y no reventaría aunque Intl fallara.
    expect(() => new Intl.DateTimeFormat("es", { timeZone: z })).not.toThrow();
  });

  it("todas las zonas de la lista son zonas IANA válidas", () => {
    // Una zona mal escrita aquí haría que el negocio calculara mal sus huecos.
    for (const tz of TIMEZONES) {
      expect(() => new Intl.DateTimeFormat("es", { timeZone: tz })).not.toThrow();
    }
  });

  it("las categorías tienen etiqueta y emoji, incluso desconocidas", () => {
    expect(categoriaLabel("barberia")).toBeTruthy();
    expect(categoriaLabel("no-existe")).toBeTruthy();
    expect(categoriaEmoji(undefined)).toBeTruthy();
  });
});
