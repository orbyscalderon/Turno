import { z } from "zod";

// Parseo estándar de parámetros de paginación desde la query string.
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function paginar(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}

export function metaPaginacion(total: number, page: number, limit: number) {
  return { total, page, limit, totalPaginas: Math.ceil(total / limit) };
}
