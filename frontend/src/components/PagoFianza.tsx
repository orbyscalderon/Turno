import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api, ApiError, STRIPE_PK, type DatosPago } from "../api";
import { useT } from "../i18n";

// Cobro de la fianza de la reserva.
//
// Esto era el agujero principal del producto: el frontend llamaba a
// /reservas/:id/pagar, que con Stripe devuelve 400 (USE_STRIPE), así que con la
// pasarela real NADIE podía pagar y la reserva caducaba a los 15 minutos.
// Ahora:
//   - mock   -> confirma contra el endpoint autenticado (desarrollo).
//   - stripe -> Stripe Elements con el clientSecret del PaymentIntent.
//   - paypal -> redirección a la aprobación y captura al volver.

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise && STRIPE_PK) stripePromise = loadStripe(STRIPE_PK);
  return stripePromise;
}

interface Props {
  reservaId: number;
  pago: DatosPago;
  montoUsd: number;
  expiraPagoEn?: string | null;
  onPagado: () => void;
  onCancelar: () => void;
}

/** Cuenta atrás del tiempo que el hueco sigue reservado esperando el pago. */
function Contador({ expiraPagoEn }: { expiraPagoEn?: string | null }) {
  const { t } = useT();
  const [restante, setRestante] = useState(() =>
    expiraPagoEn ? Math.max(0, new Date(expiraPagoEn).getTime() - Date.now()) : 0,
  );

  useEffect(() => {
    if (!expiraPagoEn) return;
    const id = setInterval(
      () => setRestante(Math.max(0, new Date(expiraPagoEn).getTime() - Date.now())),
      1000,
    );
    return () => clearInterval(id);
  }, [expiraPagoEn]);

  if (!expiraPagoEn) return null;
  const min = Math.floor(restante / 60000);
  const seg = Math.floor((restante % 60000) / 1000);
  return (
    <p className={`small ${restante < 120000 ? "err" : "muted"}`}>
      {restante === 0
        ? t("pay.expired")
        : `${t("pay.holdLeft")}: ${min}:${String(seg).padStart(2, "0")}`}
    </p>
  );
}

function FormularioStripe({
  reservaId,
  montoUsd,
  onPagado,
  onCancelar,
  expiraPagoEn,
}: Omit<Props, "pago">) {
  const { t } = useT();
  const stripe = useStripe();
  const elements = useElements();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  /**
   * Tras confirmar en Stripe, el pago lo sella el WEBHOOK (asíncrono). Se sondea
   * la reserva unos segundos para no decirle al cliente "pagado" antes de que el
   * backend lo haya registrado.
   */
  async function esperarConfirmacion() {
    setConfirmando(true);
    for (let i = 0; i < 10; i++) {
      try {
        const { reserva } = await api.get<{ reserva: { pagoReservaStatus: string } }>(
          `/reservas/${reservaId}`,
        );
        if (reserva.pagoReservaStatus === "pagado") {
          setConfirmando(false);
          return onPagado();
        }
      } catch {
        /* reintenta */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    // El cobro salió bien en Stripe; el webhook puede tardar algo más.
    setConfirmando(false);
    onPagado();
  }

  async function pagar() {
    if (!stripe || !elements) return;
    setError("");
    setProcesando(true);
    const { error: err } = await stripe.confirmPayment({
      elements,
      // Sin redirección cuando el método de pago no la necesita (tarjeta).
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/?pago=ok` },
    });
    setProcesando(false);

    if (err) {
      setError(err.message ?? t("pay.failed"));
      return;
    }
    await esperarConfirmacion();
  }

  if (confirmando) {
    return (
      <div className="card">
        <p className="muted">{t("pay.confirming")}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div>
        <strong>{t("pay.title")}</strong>
        <p className="small muted">{t("pay.depositNote", { monto: montoUsd.toFixed(2) })}</p>
        <Contador expiraPagoEn={expiraPagoEn} />
      </div>

      <PaymentElement />

      {error && <p className="err small">{error}</p>}

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={pagar} disabled={procesando || !stripe}>
          {procesando ? t("pay.processing") : t("pay.payNow", { monto: montoUsd.toFixed(2) })}
        </button>
        <button className="ghost" onClick={onCancelar} disabled={procesando}>
          {t("common.cancel")}
        </button>
      </div>
      <p className="small faint">{t("pay.secureNote")}</p>
    </div>
  );
}

export function PagoFianza(props: Props) {
  const { t } = useT();
  const { pago } = props;
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState(false);

  // --- Modo mock (desarrollo): confirma contra el backend ---
  useEffect(() => {
    if (pago.provider !== "mock") return;
    let vivo = true;
    (async () => {
      setProcesando(true);
      try {
        await api.post(`/reservas/${props.reservaId}/pagar`, {});
        if (vivo) props.onPagado();
      } catch (e) {
        if (vivo) setError(e instanceof ApiError ? e.message : t("pay.failed"));
      } finally {
        if (vivo) setProcesando(false);
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pago.provider, props.reservaId]);

  // --- PayPal: redirección a la pantalla de aprobación ---
  useEffect(() => {
    if (pago.provider === "paypal" && pago.clientSecret) {
      window.location.assign(pago.clientSecret);
    }
  }, [pago.provider, pago.clientSecret]);

  const opciones = useMemo(
    () => ({
      clientSecret: pago.clientSecret,
      appearance: {
        theme: "night" as const,
        variables: { colorPrimary: "#4f8cff", borderRadius: "10px" },
      },
    }),
    [pago.clientSecret],
  );

  if (pago.provider === "mock") {
    return (
      <div className="card">
        {error ? (
          <>
            <p className="err small">{error}</p>
            <button className="ghost" onClick={props.onCancelar}>
              {t("common.back")}
            </button>
          </>
        ) : (
          <p className="muted">{procesando ? t("pay.processing") : t("common.loading")}</p>
        )}
      </div>
    );
  }

  if (pago.provider === "paypal") {
    return (
      <div className="card">
        <p className="muted">{t("pay.redirecting")}</p>
      </div>
    );
  }

  // --- Stripe ---
  const stripe = getStripe();
  if (!stripe) {
    return (
      <div className="card">
        <p className="err">{t("pay.missingKey")}</p>
        <button className="ghost" onClick={props.onCancelar}>
          {t("common.back")}
        </button>
      </div>
    );
  }
  if (!pago.clientSecret) {
    return (
      <div className="card">
        <p className="err">{t("pay.noSecret")}</p>
      </div>
    );
  }

  return (
    <Elements stripe={stripe} options={opciones}>
      <FormularioStripe {...props} />
    </Elements>
  );
}

/**
 * Pantalla de vuelta de PayPal (/pago/paypal/:reservaId): captura el pago aprobado.
 */
export function RetornoPayPal({ reservaId }: { reservaId: number }) {
  const { t } = useT();
  const [estado, setEstado] = useState<"procesando" | "ok" | "error">("procesando");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    (async () => {
      try {
        await api.post(`/reservas/${reservaId}/capturar`, {});
        setEstado("ok");
      } catch (e) {
        setEstado("error");
        setMensaje(e instanceof ApiError ? e.message : t("pay.failed"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservaId]);

  return (
    <div className="container">
      <div className="card" style={{ textAlign: "center" }}>
        {estado === "procesando" && <p className="muted">{t("pay.capturing")}</p>}
        {estado === "ok" && (
          <>
            <h3>{t("pay.done")}</h3>
            <p className="small muted">{t("pay.doneNote")}</p>
          </>
        )}
        {estado === "error" && <p className="err">{mensaje}</p>}
        <a className="primary" href="/" style={{ display: "inline-block", marginTop: 12 }}>
          {t("pay.goHome")}
        </a>
      </div>
    </div>
  );
}
