// Cálculo de amortización de préstamos (sistema francés: cuota fija).
// La tasa se expresa como % MENSUAL; para frecuencias más cortas se prorratea por período.

export interface CuotaCalculada {
  numero: number;
  fechaVencimiento: Date;
  monto: number; // cuota total del período (capital + interés)
  capital: number;
  interes: number;
}

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// Factor de la tasa mensual según la frecuencia de pago.
function factorPeriodo(frecuencia: string): number {
  if (frecuencia === "semanal") return 1 / 4;
  if (frecuencia === "quincenal") return 1 / 2;
  return 1; // mensual
}

// Suma k períodos a la fecha de inicio.
function sumarPeriodos(inicio: Date, k: number, frecuencia: string): Date {
  const d = new Date(inicio);
  if (frecuencia === "semanal") d.setDate(d.getDate() + 7 * k);
  else if (frecuencia === "quincenal") d.setDate(d.getDate() + 15 * k);
  else d.setMonth(d.getMonth() + k);
  return d;
}

export function calcularAmortizacion(params: {
  capital: number;
  tasaInteresMensual: number; // % mensual, p.ej. 5 = 5%
  plazoCuotas: number;
  frecuencia: string; // semanal | quincenal | mensual
  fechaInicio: Date;
}): CuotaCalculada[] {
  const { capital, tasaInteresMensual, plazoCuotas: n, frecuencia, fechaInicio } = params;
  const i = (tasaInteresMensual / 100) * factorPeriodo(frecuencia);
  // Cuota fija (francés). Con interés 0, reparto lineal del capital.
  const cuotaFija = i > 0 ? (capital * i) / (1 - Math.pow(1 + i, -n)) : capital / n;

  const cuotas: CuotaCalculada[] = [];
  let saldo = capital;
  for (let k = 1; k <= n; k++) {
    const interes = round2(saldo * i);
    let cap = round2(cuotaFija - interes);
    if (k === n) cap = round2(saldo); // la última cuota liquida el saldo restante (ajuste de redondeo)
    const monto = round2(cap + interes);
    saldo = round2(saldo - cap);
    cuotas.push({ numero: k, fechaVencimiento: sumarPeriodos(fechaInicio, k, frecuencia), monto, capital: cap, interes });
  }
  return cuotas;
}
