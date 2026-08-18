import { env } from "../config/env.js";

// Cálculo del reparto de la fianza teniendo en cuenta la comisión REAL de Stripe.
// La fianza ($2) se divide en: comisión de Stripe + comisión de Turno + parte del negocio.
// La comisión de Stripe se reparte según FEE_STRIPE_REPARTO para que nadie la asuma sola.

export interface SplitFianza {
  fianzaUsd: number;         // fianza base ($2)
  montoCobradoUsd: number;   // lo que realmente paga el cliente (fianza, o fianza+fee si reparto=cliente)
  feeStripeUsd: number;      // lo que se lleva Stripe
  applicationFeeUsd: number; // lo que Turno retiene en Stripe (comisión + parte del fee del negocio)
  alNegocioUsd: number;      // lo que recibe el negocio (neto)
  turnoNetoUsd: number;      // lo que le queda a Turno tras el fee de Stripe
  feeNegocioUsd: number;     // parte del fee de Stripe que asume el negocio
  feePlataformaUsd: number;  // parte del fee de Stripe que asume Turno
  reparto: string;
}

const r2 = (n: number) => Number(n.toFixed(2));

export function calcularSplitFianza(): SplitFianza {
  const fianza = env.fianzaUsd;
  const comision = env.fianzaComisionUsd;
  const reparto = env.feeStripeReparto;

  // Si el cliente paga el fee encima, el fee se calcula sobre el monto total cobrado.
  const montoCobrado = reparto === "cliente" ? r2(fianza + (fianza * env.stripeFeePct) / 100 + env.stripeFeeFijo) : fianza;
  const feeStripe = r2((montoCobrado * env.stripeFeePct) / 100 + env.stripeFeeFijo);

  let feeNegocio = 0;
  let feePlataforma = 0;
  if (reparto === "negocio") feeNegocio = feeStripe;
  else if (reparto === "plataforma") feePlataforma = feeStripe;
  else if (reparto === "cliente") {
    /* el cliente ya lo cubre en montoCobrado: negocio y plataforma no asumen nada */
  } else {
    feeNegocio = r2(feeStripe / 2);
    feePlataforma = r2(feeStripe - feeNegocio);
  }

  // Application fee = comisión de Turno + la parte del fee que carga al negocio.
  const applicationFee = r2(comision + feeNegocio);
  const alNegocio = r2(montoCobrado - applicationFee);
  const turnoNeto = r2(applicationFee - feeStripe);

  return {
    fianzaUsd: fianza,
    montoCobradoUsd: montoCobrado,
    feeStripeUsd: feeStripe,
    applicationFeeUsd: applicationFee,
    alNegocioUsd: alNegocio,
    turnoNetoUsd: turnoNeto,
    feeNegocioUsd: feeNegocio,
    feePlataformaUsd: feePlataforma,
    reparto,
  };
}
