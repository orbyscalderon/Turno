#!/usr/bin/env node
/**
 * Prueba de carga de los endpoints que de verdad se usan.
 *
 *   node scripts/carga.mjs                      # contra localhost:4000
 *   API=https://tu-api node scripts/carga.mjs
 *   CONCURRENCIA=100 DURACION=20 node scripts/carga.mjs
 *
 * Sin dependencias: usa el fetch de Node. No pretende sustituir a k6; sirve
 * para responder a lo que no sabíamos: cuántas peticiones por segundo aguanta
 * la búsqueda pública y cuánto tarda el cálculo de huecos, que es la consulta
 * más caras del producto.
 *
 * Mide p50/p95/p99 porque la media esconde justo lo que molesta al usuario.
 *
 * OJO con el limitador: la API limita por IP (RATE_LIMIT_MAX, 1000/15 min por
 * defecto), así que una prueba larga empieza a recibir 429 y ya no mide la
 * capacidad del servidor sino el límite. Para medir capacidad de verdad, arranca
 * la API con el límite alto:
 *
 *   RATE_LIMIT_MAX=1000000 npm run dev      (en backend/)
 *
 * Si ves un montón de 429, es eso: no es un fallo del servidor.
 */

const API = (process.env.API ?? "http://localhost:4000").replace(/\/$/, "");
const CONCURRENCIA = Number(process.env.CONCURRENCIA ?? 25);
const DURACION = Number(process.env.DURACION ?? 10); // segundos por escenario

const ESCENARIOS = [
  { nombre: "health", ruta: "/api/health" },
  { nombre: "listado de negocios", ruta: "/api/negocios?limit=20" },
  { nombre: "búsqueda por texto", ruta: "/api/negocios?q=barberia" },
  { nombre: "búsqueda por cercanía", ruta: "/api/negocios?lat=40.4168&lng=-3.7038&radioKm=10" },
  { nombre: "ficha pública", ruta: "/api/negocios/barberia-el-corte-fino" },
  { nombre: "sitemap", ruta: "/api/sitemap.xml" },
];

function percentil(ordenados, p) {
  if (!ordenados.length) return 0;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[i];
}

async function escenario({ nombre, ruta }) {
  const url = `${API}${ruta}`;
  const latencias = [];
  let ok = 0;
  let errores = 0;
  const codigos = new Map();

  const fin = Date.now() + DURACION * 1000;

  // Cada "trabajador" mantiene una petición en vuelo hasta que se agota el
  // tiempo: así la concurrencia es real y constante, no un pico inicial.
  async function trabajador() {
    while (Date.now() < fin) {
      const t0 = performance.now();
      try {
        const res = await fetch(url);
        await res.arrayBuffer(); // leer el cuerpo cuenta: si no, no es realista
        latencias.push(performance.now() - t0);
        codigos.set(res.status, (codigos.get(res.status) ?? 0) + 1);
        if (res.ok) ok++;
        else errores++;
      } catch {
        errores++;
        latencias.push(performance.now() - t0);
      }
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));
  const segundos = (Date.now() - t0) / 1000;

  latencias.sort((a, b) => a - b);
  const total = ok + errores;
  return {
    nombre,
    total,
    rps: total / segundos,
    errores,
    pctError: total ? (errores / total) * 100 : 0,
    p50: percentil(latencias, 50),
    p95: percentil(latencias, 95),
    p99: percentil(latencias, 99),
    max: latencias.at(-1) ?? 0,
    codigos: [...codigos.entries()].map(([c, n]) => `${c}:${n}`).join(" "),
  };
}

const n = (x) => x.toFixed(x < 10 ? 1 : 0);

console.log(`Carga contra ${API}`);
console.log(`Concurrencia ${CONCURRENCIA} · ${DURACION}s por escenario\n`);

// Calentamiento: la primera petición paga la conexión y el plan de la consulta.
await fetch(`${API}/api/health`).catch(() => {});

const filas = [];
for (const e of ESCENARIOS) {
  process.stdout.write(`· ${e.nombre} ... `);
  const r = await escenario(e);
  filas.push(r);
  console.log(`${n(r.rps)} req/s · p95 ${n(r.p95)} ms`);
}

console.log("\n" + "escenario".padEnd(24) + "req/s".padStart(8) + "p50".padStart(8) + "p95".padStart(8) + "p99".padStart(8) + "err%".padStart(8));
console.log("-".repeat(64));
for (const r of filas) {
  console.log(
    r.nombre.padEnd(24) +
      n(r.rps).padStart(8) +
      n(r.p50).padStart(8) +
      n(r.p95).padStart(8) +
      n(r.p99).padStart(8) +
      r.pctError.toFixed(1).padStart(8),
  );
}

const limitados = filas.filter((r) => r.codigos.includes("429"));
if (limitados.length) {
  console.log("\n⚠️  Hay respuestas 429: el limitador por IP está cortando la prueba.");
  console.log("   Relanza la API con RATE_LIMIT_MAX muy alto para medir capacidad real.");
}

// Los 429 no cuentan como fallo del servidor: son el limitador funcionando.
const conErrores = filas.filter((r) => r.pctError > 1 && !r.codigos.includes("429"));
const lentos = filas.filter((r) => r.p95 > 1000);

console.log("");
if (conErrores.length) {
  console.log("❌ Escenarios con más del 1% de errores:");
  for (const r of conErrores) console.log(`   ${r.nombre}: ${r.pctError.toFixed(1)}% (${r.codigos})`);
}
if (lentos.length) {
  console.log("⚠️  Escenarios con p95 por encima de 1 s:");
  for (const r of lentos) console.log(`   ${r.nombre}: ${n(r.p95)} ms`);
}
if (!conErrores.length && !lentos.length) {
  console.log("✅ Sin errores y p95 por debajo de 1 s en todos los escenarios.");
}

// Código de salida distinto de 0 si hay errores: así sirve en un pipeline.
process.exit(conErrores.length ? 1 : 0);
