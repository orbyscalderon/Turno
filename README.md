# Turno — Plataforma SaaS de reservas para barberías

SaaS multi-tenant con 4 roles, motor de horarios dinámico por profesional y zona horaria
propia de cada negocio, control anti-colisión de citas (lock + índice único en BD), límites
por plan, fianza de reserva cobrada de verdad con Stripe, cierre de la cita con código de
validación en el local y recordatorios por email/WhatsApp.

## Stack

| Capa       | Tecnología                                                                         |
| ---------- | ---------------------------------------------------------------------------------- |
| Backend    | Node + TypeScript, Express, Prisma, **PostgreSQL**                                 |
| Auth       | JWT + bcrypt, RBAC por rol                                                         |
| Validación | Zod                                                                                |
| Frontend   | React + Vite + TypeScript                                                          |
| Móvil      | Expo + React Native (scaffold del flujo de cliente, en `mobile/`)                  |
| Pagos      | `PaymentProvider`: mock, **Stripe** (Elements + webhooks) y **PayPal** (Orders v2) |
| Seguridad  | helmet, rate-limiting, env validado con Zod, idempotencia de webhooks              |
| Calidad    | ESLint + Prettier, Vitest (63 tests) y Playwright (7 E2E de navegador)             |
| Monitoreo  | Logs estructurados (pino) + Sentry opcional (`SENTRY_DSN`)                         |

Se eligió **PostgreSQL** porque el sistema depende de sus garantías de concurrencia para
sostener dos invariantes de negocio:

1. **Nunca dos citas en el mismo hueco.** Se combinan `pg_advisory_xact_lock` por
   (profesional, día) y un **índice único parcial** en `reservaciones`
   (`WHERE estado_cita = 'confirmada'`), así que la invariante se mantiene incluso con
   varias instancias del backend o si fallara el lock de aplicación.
2. **Nunca más profesionales de los que permite el plan**, con lock por negocio.

## Requisitos

- Node.js 18+ (probado con Node 24)
- PostgreSQL 14+ — la forma más simple es Docker: `docker compose up -d`
  (si no usas Docker, instala Postgres y crea la base `turno`, luego ajusta `DATABASE_URL`).

## Puesta en marcha

### 1. Base de datos

```bash
# En la raíz del proyecto
docker compose up -d          # levanta Postgres en localhost:5432
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # ya viene un .env de desarrollo; ajústalo si hace falta
npm install
npm run prisma:generate       # genera el cliente Prisma
npm run prisma:migrate        # crea las tablas (o: npm run prisma:push)
npm run seed                  # datos de prueba (ver cuentas abajo)
npm run dev                   # API en http://localhost:4000
```

Comprobaciones de calidad:

```bash
npm run lint                  # ESLint
npx tsc --noEmit              # tipos
npm test                      # 139 tests (unitarios + integración + API)
npm run typecheck             # tipos de src, tests y scripts
npm run paypal:sandbox        # comprueba PayPal contra la API real de sandbox
```

Documentación de la API: **http://localhost:4000/api/docs** (OpenAPI en `/api/openapi.yaml`).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # app en http://localhost:5173 (proxy /api -> :4000)
npm run lint                  # ESLint
npm run test:e2e              # Playwright (requiere API y frontend arriba)
```

Para cobrar con tarjeta en desarrollo, añade tu clave de prueba en `frontend/.env`:

```env
VITE_STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

## Cuentas de prueba (password: `password123`)

| Rol           | Email                                                   |
| ------------- | ------------------------------------------------------- |
| Super Admin   | super@turno.app                                         |
| Dueño negocio | dueno@turno.app                                         |
| Peluqueros    | peluquero1@turno.app … peluquero5@turno.app (aceptados) |
| Peluquero     | peluquero6@turno.app (pendiente de aprobación)          |
| Cliente       | cliente@turno.app                                       |

Negocio sembrado: **Barbería El Corte Fino** con 5 peluqueros, cada uno con 3 servicios y
disponibilidad L-V (09-14 y 16-20) + sábado (10-14).

## Flujo del cliente (probar el camino feliz)

1. Login como `cliente@turno.app`.
2. **Reservar cita** → buscar "Barbería El Corte Fino" → elegir barbero → servicio → fecha.
3. Se listan los slots libres (calculados según duración + disponibilidad − citas confirmadas).
4. "Pagar y reservar": crea la reserva (el hueco queda bloqueado con cuenta atrás) y abre
   el pago de la fianza. Con `PAYMENT_PROVIDER=mock` se confirma al instante; con `stripe`
   aparece el formulario de tarjeta (Stripe Elements) y el pago lo sella el webhook.
5. En **Mis reservas** aparece con su código de validación y el botón de WhatsApp.
6. En el local, el profesional entra en **Agenda → Validar cita** e introduce ese código: la
   cita pasa a `completada`, el cliente recibe el email para dejar su reseña y la analítica
   de ingresos del negocio se actualiza.

## Decisiones y correcciones sobre el PRD

- **Colisión de horarios:** se implementa la fórmula correcta de solapamiento
  `inicioA < finB && finA > inicioB` (intervalos semiabiertos: una cita que termina 10:30
  no choca con otra que empieza 10:30). Ver [`backend/src/lib/time.ts`](backend/src/lib/time.ts).
- **Concurrencia:** la creación de reserva y la aprobación de peluqueros corren dentro de
  una transacción con `SELECT ... FOR UPDATE` para evitar condiciones de carrera
  (doble reserva del mismo slot / superar el límite de 5).
- **Concurrencia real:** `pg_advisory_xact_lock` + índice único parcial. (El
  `SELECT ... FOR UPDATE` original no bloqueaba nada cuando el profesional aún no tenía
  citas ese día, que es justo el caso de la primera reserva.)
- **Pago = fuente de verdad en el webhook:** la confirmación llega por
  `POST /api/reservas/webhook/pago`, no por el redirect del cliente. Se valida la firma y
  cada evento se procesa **una sola vez** (tabla `webhook_eventos`), de modo que los
  reintentos de Stripe no duplican emails ni WhatsApps. Si el pago llega después de caducar
  el hueco, se reembolsa en lugar de confirmar una cita que pudo revenderse.
- **Zona horaria por negocio:** `Negocio.timezone` rige huecos, agenda, política de
  cancelación y recordatorios. Las fechas de calendario se guardan y leen en UTC
  (`fechaUTC` / `fechaISO`) para que el día no se desplace según dónde esté el servidor.
- **Código de validación seguro:** en lugar del `id` secuencial (adivinable), cada reserva
  tiene un `codigoValidacion` aleatorio corto que va en el mensaje de WhatsApp.
- **Suscripción vencida:** manda la FECHA, no solo el estado. Un negocio cuya
  `suscripcionHasta` ya pasó deja de ser visible y de aceptar reservas al instante, y un job
  horario lo marca como `vencido` avisando al dueño por email.
- **Cierre de la cita:** `POST /api/reservas/validar` (código del cliente) o
  `PATCH /api/reservas/:id/completar` llevan la cita a `completada`; también existen
  `no-asistio` (sin reembolso) y `cancelar-negocio` (siempre con reembolso y aviso).
- **Ficha pública por negocio:** `/negocio/:slug` es una URL propia, compartible e
  indexable, incluida en el `sitemap.xml` generado con los negocios activos.

## Modelo de pago y liberación de slots

La reserva se crea como `confirmada` con `pago_reserva_status = pendiente` y un
`expira_pago_en` (por defecto +15 min, configurable con `RESERVA_HOLD_MINUTOS`). El webhook
la pasa a `pagado`. Un **job en segundo plano** (`src/jobs/expirarReservas.ts`, cada 60s)
cancela las reservas que sigan en `pendiente` tras el vencimiento, liberando el horario.

## Funciones añadidas (además del núcleo del PRD)

- **Stripe real** (`PAYMENT_PROVIDER=stripe`): `PaymentIntent` para la fianza + verificación
  de firma de webhook; reembolso automático al cancelar una cita pagada.
- **Suscripción SaaS mensual**: `POST /api/suscripcion/checkout` (Stripe Checkout en modo
  suscripción, o activación simulada en modo mock) y webhook que activa/vence el negocio.
- **Link de invitación único** para peluqueros (respeta el límite de 5, con lock).
- **Analítica del negocio** para el dueño (reservas por estado/peluquero, ingresos).
- **Subida de imágenes** (logo del negocio, foto del peluquero) con multer.
- **Recuperación de contraseña** (token con expiración; el enlace se registra en consola en dev).
- **Paginación** en el listado público de negocios.
- **Hardening**: helmet, rate-limiting (global + auth), validación estricta de configuración.
- **Lista de espera**: si un día está completo, el cliente se apunta y recibe un email
  automático cuando alguien cancela. Antes, un día completo era un cliente perdido.
- **Bonos y paquetes de sesiones**: el negocio los cobra en el local y aquí solo se llevan
  las sesiones; al reservar se descuenta una y el cliente no paga fianza. Si cancela a
  tiempo, la sesión se le devuelve.
- **Propinas**: se anotan al cerrar la cita y cuentan en los ingresos del profesional.
- **Segundo factor (TOTP)** para cualquier cuenta, obligatorio para superadmin con
  `EXIGIR_2FA_SUPERADMIN=true`. Implementado con `node:crypto` (RFC 6238, sin dependencias),
  secretos cifrados con AES-256-GCM y 10 códigos de recuperación de un solo uso.
- **Analítica de producto propia**: eventos del embudo guardados en la propia base de datos
  (nada va a terceros) y panel de embudo en superadmin, con la conversión y el abandono de
  cada paso.
- **Impuestos de la suscripción** con Stripe Tax (`STRIPE_TAX_ACTIVO=true`).
- **Accesibilidad**: WCAG 2.1 A/AA verificado con axe en el CI, navegación completa por
  teclado y campos de formulario asociados a su etiqueta.
- **Tests**: 139 en el backend, 42 unitarios en el frontend y 15 E2E de navegador
  (incluida la auditoría de accesibilidad). Todos en el CI.
- **App móvil** Expo en `mobile/` (ver su README).

## Configurar Stripe (producción)

```env
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
# Stripe genera un secreto DISTINTO por endpoint de webhook:
STRIPE_WEBHOOK_SECRET_PAGOS=whsec_...
STRIPE_WEBHOOK_SECRET_SUSCRIPCION=whsec_...
# Un price por plan e intervalo:
STRIPE_PRICE_BASICO_MENSUAL=price_...
STRIPE_PRICE_BASICO_ANUAL=price_...
STRIPE_PRICE_PRO_MENSUAL=price_...
STRIPE_PRICE_PRO_ANUAL=price_...
# Y en el frontend (sin esto el cliente no ve el formulario de tarjeta):
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Webhooks a registrar: fianza → `POST /api/reservas/webhook/pago`; suscripción →
`POST /api/suscripcion/webhook`. El detalle de eventos, Billing Portal, Connect e impuestos
está en [GO-LIVE.md](GO-LIVE.md).

## Operación

```bash
# Backup con rotación (conserva los 14 últimos)
DATABASE_URL=postgresql://... ./scripts/backup.sh ./backups

# Ensayo de restauración: restaura en una base temporal y comprueba el esquema
DATABASE_URL=postgresql://... ./scripts/verificar-backup.sh

# Restauración real
./scripts/restaurar.sh backups/turno_AAAAMMDD_HHMMSS.sql.gz "postgresql://..."

# Prueba de carga de los endpoints públicos (p50/p95/p99 y req/s)
CONCURRENCIA=50 DURACION=10 node scripts/carga.mjs
```

La sonda de caída (`.github/workflows/uptime.yml`) llama a `/api/health` cada 10 minutos;
se activa definiendo la variable de repositorio `API_URL`.

## Endpoints principales

```
POST   /api/auth/registro | /api/auth/login | GET /api/auth/me
GET    /api/negocios                 # listado público (solo suscripción vigente)
GET    /api/negocios/:slug           # detalle + peluqueros aceptados
GET    /api/negocios/mios            # negocios del dueño (admin_negocio)
POST   /api/negocios                 # crear negocio (admin_negocio)
POST   /api/negocios/:id/solicitudes # peluquero solicita unirse
GET    /api/negocios/:id/equipo      # equipo + solicitudes (admin)
PATCH  /api/negocios/:id/equipo/:sid # aceptar/rechazar (límite de 5, con lock)
GET    /api/servicios/peluquero/:id  # catálogo público de un peluquero
POST   /api/servicios | PUT/DELETE   # CRUD del peluquero
PUT    /api/disponibilidad/mia       # rangos horarios del peluquero
GET    /api/reservas/slots           # huecos libres (peluqueroId, servicioId, fecha)
POST   /api/reservas                 # crear reserva + intento de pago
POST   /api/reservas/:id/pagar       # confirmar pago (SOLO modo mock)
POST   /api/reservas/:id/capturar    # capturar pago aprobado (PayPal)
POST   /api/reservas/webhook/pago    # confirmación de pago (pasarela, idempotente)
GET    /api/reservas/mias            # historial del cliente (paginado)
GET    /api/reservas/:id             # una reserva (cliente o negocio)
GET    /api/reservas/agenda          # agenda del profesional
PATCH  /api/reservas/:id/cancelar    # cancela el cliente (reembolso según política)
PATCH  /api/reservas/:id/reprogramar # cambia fecha/hora (anti-colisión)
POST   /api/reservas/validar         # validar código en el local -> completada
PATCH  /api/reservas/:id/completar   # cerrar la cita sin código
PATCH  /api/reservas/:id/no-asistio  # no-show (la fianza no se devuelve)
PATCH  /api/reservas/:id/cancelar-negocio  # cancela el negocio (reembolsa y avisa)
DELETE /api/negocios/:id/equipo/:mid # dar de baja a un profesional
POST   /api/suscripcion/portal       # portal de facturación de Stripe
POST   /api/suscripcion/cancelar     # no renovar al final del periodo
GET    /api/superadmin/metricas      # métricas globales
PATCH  /api/superadmin/negocios/:id/suscripcion  # suspender/activar
GET    /api/sitemap.xml              # sitemap con las fichas de negocio activas
GET    /api/docs                     # documentación OpenAPI navegable
```

## Estructura

```
Turno/
├─ docker-compose.yml        # PostgreSQL
├─ backend/
│  ├─ prisma/schema.prisma   # modelo de datos
│  ├─ prisma/seed.ts         # datos de prueba
│  └─ src/
│     ├─ lib/                # auth, time, whatsapp, codes, errors, prisma
│     ├─ middleware/         # auth/RBAC + manejo de errores
│     ├─ modules/            # auth, negocios, servicios, disponibilidad, reservas, pagos, superadmin
│     └─ app.ts, server.ts
└─ frontend/
   └─ src/
      ├─ api.ts, auth.tsx
      └─ components/         # Login, Cliente, Peluquero, Admin, Superadmin
```
