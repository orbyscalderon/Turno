# 🚀 Despliegue: Railway + Supabase + Cloudflare + Backblaze B2

Stack elegido:
- **Supabase** → PostgreSQL gestionado
- **Railway** → backend API (Node) con jobs siempre activos
- **Cloudflare Pages** → frontend estático + **Cloudflare CDN** para imágenes
- **Backblaze B2** → almacenamiento de imágenes (compatible S3), servido por el CDN

El código ya está preparado para todo esto. Sigue los pasos en orden.

---

## 1. Base de datos — Supabase
1. Crea un proyecto en https://supabase.com.
2. **Project Settings → Database → Connection string**. Copia dos:
   - **Transaction pooler** (puerto **6543**) → será `DATABASE_URL` (añade `?pgbouncer=true` al final).
   - **Session / Direct** (puerto **5432**) → será `DIRECT_URL`.
3. Guárdalas para el paso 2.

> Prisma usa `DATABASE_URL` (pooled) en runtime y `DIRECT_URL` (directa) para migraciones — ya está configurado en `schema.prisma`.

---

## 2. Backend — Railway
1. Crea proyecto en https://railway.app → **Deploy from GitHub repo** → selecciona el repo.
2. En el servicio, **Settings → Root Directory = `backend`** (usa el `backend/Dockerfile`).
3. **Variables** (Settings → Variables) — pega desde `backend/.env.production.example`:
   ```
   DATABASE_URL   = (Supabase pooler 6543, con ?pgbouncer=true)
   DIRECT_URL     = (Supabase directa 5432)
   NODE_ENV       = production
   JWT_SECRET     = (genera: openssl rand -base64 48)
   FRONTEND_ORIGIN= https://turno.pages.dev   (o tu dominio de Cloudflare)
   APP_URL        = https://turno.pages.dev
   PAYMENT_PROVIDER = mock      (cámbialo a stripe con tus claves cuando quieras cobrar)
   EMAIL_TRANSPORT  = dev        (cámbialo a smtp con tu proveedor)
   STORAGE_PROVIDER = s3
   S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_PUBLIC_URL  (paso 4)
   ```
4. El Dockerfile ejecuta `prisma migrate deploy` al arrancar → las tablas se crean solas.
5. **Crea el primer superadmin** (una vez): en Railway → pestaña del servicio → **Shell**, o con `railway run`:
   ```
   SUPERADMIN_EMAIL=admin@tudominio.com SUPERADMIN_PASSWORD=clave-fuerte npm run bootstrap:admin
   ```
6. Copia la **URL pública** del backend (p. ej. `https://turno-api.up.railway.app`).

> No corras el seed demo en producción. El backend además **se niega a arrancar** si el `JWT_SECRET` es débil o `FRONTEND_ORIGIN` apunta a localhost.

---

## 3. Frontend — Cloudflare Pages
1. En Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**.
2. Configura el build:
   - **Root directory:** `frontend`
   - **Build command:** `npm ci && npm run build`
   - **Output directory:** `dist`
3. **Environment variables** (Settings → Environment variables → Production):
   ```
   VITE_API_URL = https://turno-api.up.railway.app   (la URL del backend en Railway)
   ```
4. Deploy. Cloudflare te da una URL `https://turno.pages.dev` (o tu dominio).
5. **Vuelve a Railway** y pon ese dominio en `FRONTEND_ORIGIN` y `APP_URL`.

> El frontend ya resuelve las llamadas a la API y las imágenes contra `VITE_API_URL` (soporta frontend y backend en dominios distintos). CORS ya está configurado con `FRONTEND_ORIGIN`.

---

## 4. Imágenes — Backblaze B2 + Cloudflare CDN
1. En https://www.backblaze.com/ → crea un **bucket** (público) `turno-imagenes`.
2. **App Keys → Add a New Application Key** (con acceso al bucket). Anota `keyID` y `applicationKey`.
3. Del bucket, mira su **Endpoint** (p. ej. `s3.us-west-004.backblazeb2.com`) y la **región** (`us-west-004`).
4. **CDN gratis con Cloudflare** (Bandwidth Alliance, egress $0):
   - Apunta un subdominio (`cdn.tudominio.com`) vía Cloudflare a la URL "friendly" de B2 del bucket, o usa un **Cloudflare Worker/Transform Rule** que reescriba `cdn.tudominio.com/uploads/*` → el bucket de B2.
   - Si aún no tienes dominio, deja `S3_PUBLIC_URL` vacío y se usará el endpoint del bucket directamente.
5. En **Railway**, define:
   ```
   STORAGE_PROVIDER = s3
   S3_ENDPOINT = https://s3.us-west-004.backblazeb2.com
   S3_REGION   = us-west-004
   S3_BUCKET   = turno-imagenes
   S3_ACCESS_KEY_ID = (keyID)
   S3_SECRET_ACCESS_KEY = (applicationKey)
   S3_PUBLIC_URL = https://cdn.tudominio.com   (o vacío)
   ```
6. A partir de aquí, logos/portadas/fotos se suben a B2 y se sirven por el CDN (URLs absolutas).

---

## 5. Dominio + HTTPS
- En Cloudflare, añade tu dominio y apunta:
  - `tudominio.com` → Cloudflare Pages (frontend).
  - `api.tudominio.com` → Railway (backend) [opcional; puedes usar la URL de Railway].
  - `cdn.tudominio.com` → bucket B2 (imágenes).
- HTTPS es automático en Cloudflare y Railway.
- Actualiza `FRONTEND_ORIGIN`, `APP_URL` y `VITE_API_URL` a los dominios finales y redeploya.

---

## 6. Pagos y emails reales (cuando quieras cobrar)
- **Stripe:** pon `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SAAS`, y registra los webhooks (ver `GO-LIVE.md`).
- **Email:** `EMAIL_TRANSPORT=smtp` + `SMTP_*` (SendGrid/SES).

---

## Checklist final
- [ ] Supabase creado, `DATABASE_URL` + `DIRECT_URL`
- [ ] Backend en Railway, variables puestas, migraciones aplicadas, superadmin creado
- [ ] Frontend en Cloudflare Pages con `VITE_API_URL`
- [ ] `FRONTEND_ORIGIN`/`APP_URL` apuntando al dominio real
- [ ] B2 + CDN configurados (`STORAGE_PROVIDER=s3`)
- [ ] Dominio + HTTPS
- [ ] (Opcional) Stripe y SMTP reales
