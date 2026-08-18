# 🚀 Guía de puesta en producción (GO-LIVE) — Turno

Todo el código está listo. Esta guía cubre lo que necesita **credenciales o infraestructura externa**
(lo único que no se puede automatizar desde el repo). Sigue los pasos en orden.

## 0. Checklist rápido
- [ ] Base de datos PostgreSQL gestionada creada
- [ ] Backend y frontend desplegados
- [ ] Dominio + HTTPS configurados
- [ ] Stripe en vivo (fianza $2 + suscripción SaaS)
- [ ] SMTP real (emails de verificación/confirmación/recordatorio)
- [ ] Backups automáticos de la BD
- [ ] `JWT_SECRET` fuerte y único

---

## 1. Desplegar (elige una opción)

### Opción A — Render (más simple, hay `render.yaml`)
1. Sube el repo a GitHub.
2. En Render: **New → Blueprint** y apunta al repo. Render lee `render.yaml` y crea BD + API + web.
3. Al terminar, ajusta en el servicio `turno-api` los secrets reales (Stripe, SMTP) — ver abajo.

### Opción B — Docker en un VPS
```bash
git clone <repo> && cd Turno
# edita las variables dentro de docker-compose.full.yml (JWT_SECRET, dominios, etc.)
docker compose -f docker-compose.full.yml up --build -d
```
Frontend en `:8080`, API interna. Pon un reverse proxy (Caddy/Nginx) con HTTPS delante.

### Opción C — Railway / Fly.io
Usa `backend/Dockerfile` y `frontend/Dockerfile`. Crea un Postgres gestionado y pega las
variables de `backend/.env.production.example`.

> Las migraciones se aplican solas al arrancar el backend (`prisma migrate deploy` en el CMD del Dockerfile).
> **NO ejecutes el seed demo en producción.** Para crear el primer superadmin de forma segura:
> ```bash
> SUPERADMIN_EMAIL=admin@tudominio.com SUPERADMIN_PASSWORD=una-clave-fuerte npm run bootstrap:admin
> ```
> El seed demo (`npx prisma db seed`) es solo para desarrollo/staging.

> **Guardarraíles automáticos**: en `NODE_ENV=production` el backend se niega a arrancar si el
> `JWT_SECRET` es débil o el de desarrollo, si faltan `STRIPE_*`/`SMTP_*` cuando esos proveedores
> están activos, o si `FRONTEND_ORIGIN` apunta a localhost. Esto evita despliegues inseguros.

---

## 2. Stripe en vivo (cobro real de la fianza de $2 y del SaaS)
1. Crea cuenta en https://stripe.com y activa el modo *live*.
2. Copia `sk_live_...` → `STRIPE_SECRET_KEY`.
3. Crea un **Product recurrente** (plan mensual del negocio) → copia su `price_...` → `STRIPE_PRICE_SAAS`.
4. Configura los webhooks (Developers → Webhooks → Add endpoint):
   - Fianza: `https://TU_API/api/reservas/webhook/pago` — eventos `payment_intent.succeeded`, `payment_intent.payment_failed`.
   - Suscripción: `https://TU_API/api/suscripcion/webhook` — eventos `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
   - Copia el `whsec_...` → `STRIPE_WEBHOOK_SECRET`.
5. Pon `PAYMENT_PROVIDER=stripe`. (El frontend ya usa el `clientSecret` que devuelve la API; integra Stripe Elements/Checkout en el paso de pago para capturar la tarjeta.)

**Probar en local:** `stripe listen --forward-to localhost:4000/api/reservas/webhook/pago`

> PayPal: el proveedor está como stub (`PAYMENT_PROVIDER=paypal`). Para activarlo hay que
> completar la integración de la API de Orders v2 en `backend/src/modules/pagos.provider.ts`.

---

## 3b. WhatsApp automático (Cloud API de Meta)
Por defecto (`WHATSAPP_PROVIDER=deeplink`) se genera un enlace `wa.me` que el cliente pulsa (gratis).
Para **enviar la confirmación automáticamente** al cliente:
1. Crea una app en https://developers.facebook.com → producto **WhatsApp**.
2. Añade/verifica un número de **WhatsApp Business** → copia su **Phone Number ID** → `WHATSAPP_PHONE_ID`.
3. Genera un **token permanente** (System User con permiso `whatsapp_business_messaging`) → `WHATSAPP_TOKEN`.
4. Crea y **aprueba una plantilla** (Message Templates) con **5 variables** en el cuerpo, en este orden:
   `{{1}}` profesional, `{{2}}` servicio, `{{3}}` fecha, `{{4}}` hora, `{{5}}` código. Pon su nombre en `WHATSAPP_TEMPLATE`.
5. Configura:
   ```
   WHATSAPP_PROVIDER=cloud
   WHATSAPP_TOKEN=...
   WHATSAPP_PHONE_ID=...
   WHATSAPP_TEMPLATE=confirmacion_reserva
   WHATSAPP_LANG=es
   ```
> Meta exige plantilla aprobada para mensajes iniciados por el negocio (fuera de la ventana de 24h).
> Alternativa más simple (de pago): Twilio WhatsApp — se adaptaría el mismo `enviarWhatsApp()`.

## 3. Emails reales (SMTP)
1. Elige proveedor: **SendGrid**, **Amazon SES**, **Mailgun** o **Postmark**.
2. Verifica tu dominio remitente (SPF + DKIM) para no caer en spam.
3. Rellena en producción:
   ```
   EMAIL_TRANSPORT=smtp
   EMAIL_FROM="Turno <no-reply@tudominio.com>"
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=<tu-api-key>
   ```
   Con esto se envían de verdad: verificación de email, confirmación de reserva,
   recordatorio (24h antes) y recuperación de contraseña.

---

## 4. Dominio + HTTPS
- Apunta tu dominio al frontend. HTTPS es obligatorio (Render/Railway lo dan automático; en VPS usa Caddy o Certbot).
- Actualiza `FRONTEND_ORIGIN` y `APP_URL` al dominio real (afecta CORS y los enlaces de los emails).

---

## 5. Backups de la base de datos
- Proveedores gestionados (Render/Neon/Supabase) incluyen backups automáticos: actívalos.
- O programa el script incluido con cron (diario 03:00):
  ```
  0 3 * * * DATABASE_URL=postgresql://... /ruta/Turno/scripts/backup.sh /ruta/backups
  ```

---

## 6. Imágenes subidas (logos/fotos)
En producción el disco local no es persistente en muchos PaaS. Opciones:
- Montar un **volumen persistente** para `UPLOAD_DIR` (ver `docker-compose.full.yml`), o
- Migrar a **S3/Cloudflare R2** (adaptar `backend/src/modules/uploads.routes.ts`).

---

## 7. Lo que aún queda como mejora (no bloquea el lanzamiento)
- **App móvil**: scaffold Expo en `mobile/`, requiere compilar con Expo/EAS.
- **PayPal**: completar la integración real (hoy stub).
- **i18n**: ES/EN cubre login, cuenta, navegación y todo el flujo del cliente; algunos textos
  profundos de paneles admin/profesional siguen en español y se traducen añadiendo claves en `frontend/src/i18n.tsx`.
