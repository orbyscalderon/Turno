/**
 * Comprobación de PayPal contra la API REAL de sandbox.
 *
 *   cd backend
 *   PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... PAYPAL_MODE=sandbox npm run paypal:sandbox
 *
 * Qué hace: pide el token, crea una orden de verdad por el importe de la fianza
 * y muestra el enlace de aprobación. Lo que los tests NO pueden comprobar sin
 * credenciales: que las claves valen, que la app tiene los permisos y que PayPal
 * acepta el cuerpo que enviamos.
 *
 * No cobra nada: la orden se queda sin aprobar y caduca sola.
 */
import { env } from "../src/config/env.js";
import { PayPalProvider } from "../src/modules/pagos.provider.js";
import { calcularSplitFianza } from "../src/lib/split.js";

async function main() {
  if (!env.paypalClientId || !env.paypalSecret) {
    console.error("❌ Faltan PAYPAL_CLIENT_ID y/o PAYPAL_SECRET.");
    console.error("   Sácalos de https://developer.paypal.com → Apps & Credentials (Sandbox).");
    process.exit(1);
  }
  if (env.paypalMode === "live") {
    console.error("❌ PAYPAL_MODE=live. Esta comprobación es solo para sandbox.");
    process.exit(1);
  }

  const split = calcularSplitFianza();
  console.log(`Modo: ${env.paypalMode}`);
  console.log(`Importe de la fianza: ${split.montoCobradoUsd} USD`);

  const proveedor = new PayPalProvider();

  console.log("\n1/3 Pidiendo access token y creando la orden...");
  const intento = await proveedor.crearIntento({
    reservaId: 999999,
    montoUsd: split.montoCobradoUsd,
    clienteEmail: "comprobacion@turno.test",
  });
  console.log(`   ✅ Orden creada: ${intento.transaccionId}`);

  if (!intento.clientSecret) {
    console.error("   ❌ PayPal no devolvió enlace de aprobación (rel=payer-action|approve).");
    process.exit(1);
  }
  console.log(`   ✅ Enlace de aprobación: ${intento.clientSecret}`);

  console.log("\n2/3 Comprobando que la orden se puede leer...");
  // Token propio: el del proveedor es privado a propósito y no se va a abrir
  // solo para un script de comprobación.
  const auth = Buffer.from(`${env.paypalClientId}:${env.paypalSecret}`).toString("base64");
  const oauth = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const { access_token: token } = (await oauth.json()) as { access_token: string };
  const res = await fetch(
    `https://api-m.sandbox.paypal.com/v2/checkout/orders/${intento.transaccionId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const orden = (await res.json()) as { status?: string };
  console.log(`   ${res.ok ? "✅" : "❌"} GET orden -> ${res.status} (estado: ${orden.status ?? "?"})`);

  console.log("\n3/3 Webhook");
  if (!env.paypalWebhookId) {
    console.log("   ⚠️  PAYPAL_WEBHOOK_ID vacío: los webhooks se descartarán.");
    console.log("      Créalo en el panel (Apps & Credentials → tu app → Webhooks) apuntando a");
    console.log(`      ${env.appUrl.replace(/\/$/, "")}/api/reservas/webhook/pago con los eventos`);
    console.log("      PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED y CHECKOUT.ORDER.VOIDED.");
  } else {
    console.log(`   ✅ PAYPAL_WEBHOOK_ID configurado: ${env.paypalWebhookId}`);
  }

  console.log("\n--- Siguiente paso manual ---");
  console.log("Abre el enlace de aprobación, paga con una cuenta de comprador de sandbox y");
  console.log("comprueba que la reserva queda confirmada. Eso cierra el circuito completo.");
}

main().catch((e) => {
  console.error("\n❌ Falló la comprobación:", e instanceof Error ? e.message : e);
  process.exit(1);
});
