// Genera un proyecto INDEPENDIENTE para un solo rubro a partir de este código.
// Uso:  node tools/crear-proyecto-rubro.mjs <rubro>
// Ej.:  node tools/crear-proyecto-rubro.mjs supermercado
//
// Crea ../turno-<rubro>/ con una copia del código (sin node_modules, .git, _legacy ni secretos),
// bloqueada a ese rubro (RUBRO_FIJO / VITE_RUBRO_FIJO). Luego tú inicias su git y lo despliegas.

import { cp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const RUBROS = ["barberia", "taller", "restaurante", "supermercado", "ferreteria", "vape_shop", "farmacia", "granja_avicola", "prestamista"];

const rubro = process.argv[2];
if (!rubro || !RUBROS.includes(rubro)) {
  console.error("Uso: node tools/crear-proyecto-rubro.mjs <rubro>");
  console.error("Rubros válidos:", RUBROS.join(", "));
  process.exit(1);
}

const raiz = process.cwd();
const destino = path.resolve(raiz, "..", `turno-${rubro}`);
if (existsSync(destino)) {
  console.error(`❌ Ya existe: ${destino}  (bórralo o usa otro nombre)`);
  process.exit(1);
}

const DIRS_EXCLUIDOS = new Set(["node_modules", "dist", ".git", "_legacy", "test-results", "playwright-report", ".turbo", ".expo"]);
const ARCHIVOS_EXCLUIDOS = [/^\.env$/, /^\.env\.(?!.*example)/, /\.tsbuildinfo$/];

console.log(`📦 Copiando código a ${destino} …`);
await cp(raiz, destino, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    if (DIRS_EXCLUIDOS.has(base)) return false;
    if (ARCHIVOS_EXCLUIDOS.some((re) => re.test(base))) return false;
    return true;
  },
});

// Config de rubro fijo para desarrollo local (los secretos reales van en el deploy).
await writeFile(path.join(destino, "backend", ".env"), `# Proyecto de un solo rubro: ${rubro}\nRUBRO_FIJO=${rubro}\n# Copia el resto de variables desde backend/.env.example (DATABASE_URL, JWT_SECRET, etc.)\n`);
await writeFile(path.join(destino, "frontend", ".env"), `# Proyecto de un solo rubro: ${rubro}\nVITE_RUBRO_FIJO=${rubro}\nVITE_API_URL=http://localhost:4000\n`);

await writeFile(path.join(destino, "RUBRO.md"), `# Proyecto: ${rubro}

Este proyecto es una copia independiente de la plataforma, **bloqueada al rubro \`${rubro}\`**.
La home es la landing de ${rubro}; el registro entra directo a ese rubro; solo se muestran sus módulos.

## Poner en marcha
1. \`cd backend && npm install && npx prisma migrate deploy && npm run dev\`
2. \`cd frontend && npm install && npm run dev\`

## Variables clave (en el deploy)
- Backend (Railway): \`RUBRO_FIJO=${rubro}\` + DATABASE_URL, JWT_SECRET, etc.
- Frontend (Cloudflare): \`VITE_RUBRO_FIJO=${rubro}\` + \`VITE_API_URL=<url del backend>\`

## Subir a su propio repo
\`\`\`
cd ${path.basename(destino)}
git init && git add -A && git commit -m "init proyecto ${rubro}"
# crea el repo en GitHub y:
git remote add origin <URL_DE_TU_REPO>
git push -u origin main
\`\`\`
`);

console.log(`✅ Listo: ${destino}`);
console.log(`   Rubro fijo: ${rubro}  ·  lee ${path.join(destino, "RUBRO.md")} para los siguientes pasos.`);
