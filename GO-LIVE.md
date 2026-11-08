# 🚀 Puesta en producción (GO-LIVE) — Turno

El código está terminado. Lo único que queda es **rellenar credenciales y contratar
infraestructura**: eso es lo que cubre esta guía.

> **El backend se niega a arrancar** en `NODE_ENV=production` si la configuración haría que
> el producto funcionara mal en silencio: `JWT_SECRET` débil, `FRONTEND_ORIGIN`/`APP_URL` sin
> `https://`, pagos simulados (no cobrarías nada) o emails a consola (nadie recibiría la
> verificación ni los recordatorios). Para un _staging_ puedes relajar los dos últimos con
> `PERMITIR_MODO_DEMO=true`.

---

## 0. Checklist

- [ ] PostgreSQL gestionado creado (con backups activados)
- [ ] Backend y frontend desplegados, dominio + HTTPS
- [ ] Stripe en vivo: fianza de la reserva **y** suscripción del SaaS
- [ ] **Los dos** secretos de webhook de Stripe configurados
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` en el build del frontend
- [ ] SMTP real con dominio verificado (SPF + DKIM)
- [ ] Almacenamiento de imágenes en S3/R2/B2
- [ ] `JWT_SECRET` fuerte y único
- [ ] Primer superadmin creado **con segundo factor activado**
- [ ] Datos reales de la empresa en `frontend/src/company.ts` (vienen de ejemplo)
- [ ] (Recomendado) `SENTRY_DSN`
- [ ] Sonda de caída activa (variable `API_URL` del repositorio)
- [ ] Ensayo de restauración del backup hecho una vez

---

## 1. Desplegar

### Opción A — Render (hay `render.yaml`)

1. Sube el repo a GitHub.
2. En Render: **New → Blueprint** y apunta al repo. Crea BD + API + web.
3. Render te pedirá las variables marcadas `sync: false` (Stripe, SMTP, S3, superadmin).
4. Cambia `FRONTEND_ORIGIN`, `APP_URL` y los `rewrite` del frontend a tu dominio real.

> El `render.yaml` pone las URLs **completas** a propósito. Render expone el host sin
> esquema (`turno-web.onrender.com`), y eso rompía CORS y dejaba inservibles los enlaces de
> verificación y de recuperación de contraseña que llegan por email.

### Opción B — Docker en un VPS

```bash
git clone <repo> && cd Turno
# crea un .env junto a docker-compose.full.yml con tus claves (ver cabecera del fichero)
docker compose -f docker-compose.full.yml up --build -d
```

Frontend en `:8080` (nginx ya proxea `/api`, `/uploads` y `/sitemap.xml` al backend).
Pon Caddy o Nginx delante con HTTPS.

### Opción C — Railway / Fly.io

Usa `backend/Dockerfile` y `frontend/Dockerfile` con un Postgres gestionado y las variables
de `backend/.env.production.example`.

> Las migraciones se aplican al arrancar (`prisma migrate deploy` en el `CMD`). El proceso
> arranca con `exec node`, así que recibe `SIGTERM` y cierra ordenadamente (termina las
> peticiones en curso y suelta la base de datos) en cada despliegue.

**Primer superadmin:** define `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` y se crea solo al
arrancar (es idempotente). O a mano: `npm run bootstrap:admin`.
**No ejecutes el seed de demo en producción** (`npx prisma db seed` es solo para desarrollo).

---

## 2. Stripe (fianza de la reserva + suscripción del SaaS)

1. Crea la cuenta en https://stripe.com y activa el modo **live**.
2. **Claves** → API keys:
   - `sk_live_...` → backend `STRIPE_SECRET_KEY`
   - `pk_live_...` → frontend `VITE_STRIPE_PUBLISHABLE_KEY` _(sin esta el cliente no puede
     pagar: el formulario de tarjeta avisa de que falta la configuración)_
3. **Productos recurrentes** (Products → Add product), uno por plan e intervalo, y copia los
   cuatro `price_...`:

   | Plan   | Intervalo | Precio  | Variable                      |
   | ------ | --------- | ------- | ----------------------------- |
   | Básico | mensual   | 25 USD  | `STRIPE_PRICE_BASICO_MENSUAL` |
   | Básico | anual     | 250 USD | `STRIPE_PRICE_BASICO_ANUAL`   |
   | Pro    | mensual   | 50 USD  | `STRIPE_PRICE_PRO_MENSUAL`    |
   | Pro    | anual     | 500 USD | `STRIPE_PRICE_PRO_ANUAL`      |

4. **Webhooks** (Developers → Webhooks → Add endpoint). Son **dos endpoints** y Stripe genera
   un `whsec_` **distinto para cada uno**:

   | Endpoint                                   | Eventos                                                                                                    | Variable del secreto                |
   | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
   | `https://TU_API/api/reservas/webhook/pago` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`                     | `STRIPE_WEBHOOK_SECRET_PAGOS`       |
   | `https://TU_API/api/suscripcion/webhook`   | `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted` | `STRIPE_WEBHOOK_SECRET_SUSCRIPCION` |

5. **Impuestos** (Settings → Tax): si vendes en la UE o en cualquier
   jurisdicción con IVA, actívalo y pon `STRIPE_TAX_ACTIVO=true`. El checkout
   pedirá entonces la dirección y el NIF/VAT del negocio, y Stripe calculará el
   impuesto. Con la variable en `false` la suscripción se cobra sin impuestos;
   consulta con tu asesor qué te obliga.
6. **Billing Portal** (Settings → Billing → Customer portal): actívalo. Es lo que permite al
   negocio cambiar de plan, actualizar la tarjeta, descargar facturas y cancelar desde su
   propio panel.
7. **Connect** (opcional, para repartir la fianza con cada negocio): activa Connect con
   cuentas **Express**. El dueño lo conecta desde su panel (_Cobros_) y la plataforma retiene
   su comisión como `application_fee`.
8. `PAYMENT_PROVIDER=stripe`.

**Probar en local:**

```bash
stripe listen --forward-to localhost:4000/api/reservas/webhook/pago
stripe listen --forward-to localhost:4000/api/suscripcion/webhook
```

> Los webhooks son **idempotentes**: cada evento se registra en `webhook_eventos` y los
> reintentos de Stripe se descartan, así que nunca se duplican emails ni WhatsApps. Un pago
> que llega después de caducar el hueco se reembolsa automáticamente.

### PayPal (alternativa)

`PAYMENT_PROVIDER=paypal` con `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_MODE=live` y
`PAYPAL_WEBHOOK_ID`. El flujo es por redirección (aprobar → volver → capturar).

La lógica está cubierta por pruebas contra la API de PayPal **simulada** (crear orden,
capturar, reembolsar y verificar la firma del webhook, con sus casos de error:
`backend/tests/paypal.test.ts`). Lo que esas pruebas no pueden comprobar es que _tus_
credenciales valen y que tu app tiene los permisos. Para eso, con las claves de sandbox:

```bash
cd backend
PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... PAYPAL_MODE=sandbox npm run paypal:sandbox
```

Crea una orden real de sandbox (no cobra nada), imprime el enlace de aprobación y avisa si
falta el webhook. Ábrelo, paga con una cuenta de comprador de sandbox y comprueba que la
reserva queda confirmada: eso cierra el circuito.

PayPal no tiene equivalente al _destination charge_ de Stripe Connect, así que el reparto
automático con el negocio solo funciona con Stripe.

---

## 3. Emails (obligatorio)

1. Proveedor: **SendGrid**, **Amazon SES**, **Mailgun** o **Postmark**.
2. Verifica tu dominio remitente (**SPF + DKIM**) o todo irá a spam.
3. Configura:

```env
EMAIL_TRANSPORT=smtp
EMAIL_FROM="Turno <no-reply@tudominio.com>"
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<tu-api-key>
```

Con esto se envían: verificación de email, confirmación de reserva, aviso al profesional,
recordatorio de 24 h, recordatorio corto (`RECORDATORIO_CORTO_HORAS`), cancelación por parte
del negocio, petición de reseña al completar la cita y aviso de suscripción vencida.

---

## 4. WhatsApp automático (opcional)

Por defecto (`WHATSAPP_PROVIDER=deeplink`) se genera un enlace `wa.me` gratuito. Para enviar
la confirmación automáticamente con la **Cloud API de Meta**:

1. App en https://developers.facebook.com → producto **WhatsApp**.
2. Número de WhatsApp Business verificado → **Phone Number ID** → `WHATSAPP_PHONE_ID`.
3. Token permanente (System User con `whatsapp_business_messaging`) → `WHATSAPP_TOKEN`.
4. Plantilla aprobada con **5 variables** en este orden: `{{1}}` profesional, `{{2}}`
   servicio, `{{3}}` fecha, `{{4}}` hora, `{{5}}` código → `WHATSAPP_TEMPLATE`.
5. `WHATSAPP_PROVIDER=cloud`.

---

## 5. Dominio, HTTPS y zonas horarias

- `FRONTEND_ORIGIN` y `APP_URL` con el dominio real **y `https://`**.
- `TIMEZONE_DEFECTO`: zona de los negocios nuevos. Cada negocio puede cambiar la suya desde
  su panel, y de ella dependen los huecos, la agenda, la política de cancelación y los
  recordatorios.
- Edita `frontend/public/robots.txt` y cambia `https://tudominio.com/sitemap.xml` por tu
  dominio. El sitemap lo genera el backend con las fichas `/negocio/:slug` activas.

---

## 6. Imágenes

En la mayoría de PaaS el disco es efímero: usa S3 compatible.

```env
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_BUCKET=turno-uploads
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://cdn.tudominio.com
```

Alternativa en VPS: volumen persistente montado en `UPLOAD_DIR` (ver
`docker-compose.full.yml`). Al sustituir un logo o una foto, la imagen anterior se borra sola.

---

## 7. Backups (y ensayo de restauración)

- En proveedores gestionados (Render/Neon/Supabase): activa los backups automáticos.
- O programa el script incluido:

```
0 3 * * * DATABASE_URL=postgresql://... /ruta/Turno/scripts/backup.sh /ruta/backups
```

**Un backup que nunca se ha restaurado no es un backup.** El ensayo crea una base temporal,
restaura el último backup en ella, comprueba que están todas las tablas, las migraciones y
el índice que impide la doble reserva, y la borra:

```bash
DATABASE_URL=postgresql://... ./scripts/verificar-backup.sh
```

Hazlo una vez antes de abrir al público y luego una vez al mes (o en un cron semanal). Para
una recuperación real:

```bash
./scripts/restaurar.sh backups/turno_AAAAMMDD_HHMMSS.sql.gz "postgresql://..."
```

> Los scripts limpian solos los parámetros propios de Prisma (`?schema=`, `?pgbouncer=`) de
> la URL: `pg_dump` los rechaza y por eso el backup fallaba con la misma URL que usa la
> aplicación.

---

## 8. Observabilidad

```env
SENTRY_DSN=https://...ingest.sentry.io/...
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Sin DSN, los errores quedan solo en el log estructurado. Sondas disponibles:
`/api/health` (comprueba la base de datos, devuelve 503 si está caída) y `/api/health/live`
(solo proceso, para el orquestador). Ninguna de las dos cuenta para el límite de peticiones.

### Aviso de caída

Sentry informa de errores **mientras el proceso vive**. Si el contenedor muere, la base se
desconecta o un despliegue deja la API caída, Sentry no dice nada. El workflow
`.github/workflows/uptime.yml` sondea `/api/health` cada 10 minutos desde fuera y falla si
no responde tras tres intentos; GitHub te manda un email cuando un workflow falla.

Para activarlo: **Settings → Secrets and variables → Actions → Variables** del repositorio,
variable `API_URL` con la URL pública de tu API. Sin ella el workflow no hace nada.

### Prueba de carga

```bash
# Con el límite por IP levantado, para medir el servidor y no el limitador:
cd backend && RATE_LIMIT_MAX=1000000 npm run dev
# en otra terminal:
CONCURRENCIA=50 DURACION=10 node scripts/carga.mjs
```

Mide req/s y p50/p95/p99 de los endpoints públicos. Referencia en un portátil con Postgres
local: 1.100–3.800 req/s con p95 por debajo de 61 ms y 0 errores. Repítelo contra tu
infraestructura real antes de una campaña: el cuello de botella será el plan de la base de
datos, no el proceso de Node.

---

## 8 bis. Segundo factor (2FA)

Cualquier cuenta puede activarlo desde el candado 🔒 de la cabecera: QR para Google
Authenticator / Authy / 1Password, más 10 códigos de recuperación de un solo uso.

En producción pon **`EXIGIR_2FA_SUPERADMIN=true`**. El superadmin ve todos los negocios,
todos los usuarios y todos los ingresos: una contraseña sola es poca defensa. Con esa
variable activa, un superadmin sin 2FA puede iniciar sesión (lo necesita para configurarlo)
pero su panel queda cerrado hasta que lo active.

`TOTP_CLAVE` cifra los secretos TOTP en la base de datos. Si la dejas vacía se deriva de
`JWT_SECRET`. **Cambiarla (o rotar `JWT_SECRET` sin ella) deja los segundos factores
ilegibles** y habrá que entrar con los códigos de recuperación.

---

## 9. Qué queda fuera del alcance actual

- **App móvil**: el scaffold de Expo (`mobile/`) reserva y paga en modo `mock`; con Stripe el
  hueco se reserva y el pago se termina en la web. Para cobrar dentro de la app hay que
  integrar `@stripe/stripe-react-native` y compilar con EAS; las notificaciones push
  necesitan además un proyecto de Expo/FCM/APNs y cuentas de desarrollador de Apple y
  Google. Nada de eso se puede preparar sin esas cuentas.
- **Multi-sede**: *decidido el 2026-11-08 — se queda así a propósito.* Un negocio es una
  dirección, y una cadena con tres locales usa tres cuentas. Funciona hoy y cada local
  mantiene su ficha, su equipo y su agenda.

  No se construye todavía porque las tres formas razonables de hacerlo llevan a modelos de
  datos incompatibles entre sí:

  | Modelo | Qué comparten los locales | Coste |
  |---|---|---|
  | Cuenta por local (actual) | nada | ninguno |
  | Sedes dentro de un negocio | suscripción, marca y ficha; equipo y horario por sede | toca huecos, agenda, analítica, límites de plan y sitemap |
  | Organización que agrupa negocios | solo la facturación y un panel conjunto | cambio menor, pero cada local sigue con ficha propia |

  Elegir mal obliga a migrar datos reales de clientes después. La decisión se toma cuando un
  negocio con varios locales diga **cómo** lo necesita, no antes.
- **Pasarelas locales** (Bizum, Mercado Pago, Redsys): se añaden implementando
  `PaymentProvider` en `backend/src/modules/pagos.provider.ts`.
- **Búsqueda por texto a gran escala**: con decenas de miles de negocios conviene añadir el
  índice trigram (requiere la extensión `pg_trgm`, no incluida en las migraciones porque no
  todos los proveedores permiten crearla):

  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX negocios_nombre_trgm ON negocios USING gin (nombre_comercial gin_trgm_ops);
  CREATE INDEX negocios_direccion_trgm ON negocios USING gin (direccion gin_trgm_ops);
  ```

  La búsqueda por cercanía ya se resuelve en SQL con caja de coordenadas + Haversine.
