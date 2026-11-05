import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { filtroNegocioVigente } from "../lib/suscripcion.js";

// Sitemap dinámico: una entrada por negocio con suscripción vigente.
// Es la pieza que convierte las fichas /negocio/:slug en tráfico orgánico; un
// sitemap estático no puede listar negocios que se dan de alta cada día.
export const sitemapRouter = Router();

const escapar = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let cache: { xml: string; expira: number } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1 hora

sitemapRouter.get(
  "/sitemap.xml",
  asyncHandler(async (_req, res) => {
    res.type("application/xml");
    if (cache && cache.expira > Date.now()) return res.send(cache.xml);

    const base = env.appUrl.replace(/\/$/, "");
    const negocios = await prisma.negocio.findMany({
      where: filtroNegocioVigente(),
      select: { slug: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const estaticas = [
      { loc: `${base}/`, prio: "1.0", freq: "daily" },
      { loc: `${base}/precios`, prio: "0.8", freq: "monthly" },
      { loc: `${base}/terminos`, prio: "0.3", freq: "yearly" },
      { loc: `${base}/privacidad`, prio: "0.3", freq: "yearly" },
    ];

    const urls = [
      ...estaticas.map(
        (u) =>
          `  <url><loc>${escapar(u.loc)}</loc><changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`,
      ),
      ...negocios.map(
        (n) =>
          `  <url><loc>${escapar(`${base}/negocio/${n.slug}`)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
      ),
    ].join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    cache = { xml, expira: Date.now() + TTL_MS };
    res.send(xml);
  }),
);
