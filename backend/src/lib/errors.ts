// Error de dominio con código HTTP asociado. El manejador global lo traduce a respuesta JSON.
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const BadRequest = (msg: string, code?: string) => new AppError(400, msg, code);
export const Unauthorized = (msg = "No autenticado") => new AppError(401, msg, "UNAUTHORIZED");
export const Forbidden = (msg = "No autorizado") => new AppError(403, msg, "FORBIDDEN");
export const NotFound = (msg = "No encontrado") => new AppError(404, msg, "NOT_FOUND");
export const Conflict = (msg: string, code?: string) => new AppError(409, msg, code);
