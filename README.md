# Turno — Plataforma SaaS de reservas para barberías

MVP full-stack de la plataforma descrita en el PRD: SaaS multi-tenant con 4 roles, motor
de horarios dinámico por peluquero, control anti-colisión de citas, límite estricto de 5
peluqueros por negocio, fianza de reserva de $2 USD y deep link de WhatsApp.

## Stack

| Capa      | Tecnología                                             |
|-----------|--------------------------------------------------------|
| Backend   | Node + TypeScript, Express, Prisma, **PostgreSQL**     |
| Auth      | JWT + bcrypt, RBAC por rol                             |
| Validación| Zod                                                    |
| Frontend  | React + Vite + TypeScript                              |
| Móvil     | Expo + React Native (scaffold del flujo de cliente, en `mobile/`) |
| Pagos     | Abstracción `PaymentProvider` (mock + **Stripe real**) |
| Seguridad | helmet, rate-limiting, validación de env con Zod       |
| Tests     | Vitest (lógica de horarios, colisiones, WhatsApp, códigos) |

Se eligió **PostgreSQL** porque el sistema depende de transacciones con locks
(`SELECT ... FOR UPDATE`) para garantizar dos invariantes de negocio bajo concurrencia:
no permitir dobles reservas del mismo slot y no superar los 5 peluqueros.

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

### 3. Frontend

```bash
cd frontend
npm install
npm run dev                   # app en http://localhost:5173 (proxy /api -> :4000)
```

## Cuentas de prueba (password: `password123`)

| Rol            | Email                                   |
|----------------|-----------------------------------------|
| Super Admin    | super@turno.app                         |
| Dueño negocio  | dueno@turno.app                         |
| Peluqueros     | peluquero1@turno.app … peluquero5@turno.app (aceptados) |
| Peluquero      | peluquero6@turno.app (pendiente de aprobación) |
| Cliente        | cliente@turno.app                       |

Negocio sembrado: **Barbería El Corte Fino** con 5 peluqueros, cada uno con 3 servicios y
disponibilidad L-V (09-14 y 16-20) + sábado (10-14).

## Flujo del cliente (probar el camino feliz)

1. Login como `cliente@turno.app`.
2. **Reservar cita** → buscar "Barbería El Corte Fino" → elegir barbero → servicio → fecha.
3. Se listan los slots libres (calculados según duración + disponibilidad − citas confirmadas).
4. "Pagar $2 y reservar": crea la reserva y simula el pago (webhook mock) que la confirma.
5. En **Mis reservas** aparece con su código de validación y el botón de WhatsApp.

## Decisiones y correcciones sobre el PRD

- **Colisión de horarios:** se implementa la fórmula correcta de solapamiento
  `inicioA < finB && finA > inicioB` (intervalos semiabiertos: una cita que termina 10:30
  no choca con otra que empieza 10:30). Ver [`backend/src/lib/time.ts`](backend/src/lib/time.ts).
- **Concurrencia:** la creación de reserva y la aprobación de peluqueros corren dentro de
  una transacción con `SELECT ... FOR UPDATE` para evitar condiciones de carrera
  (doble reserva del mismo slot / superar el límite de 5).
- **Pago = fuente de verdad en el webhook:** la confirmación del pago llega por
  `POST /api/reservas/webhook/pago`, no por el redirect del cliente. Con Stripe real se
  valida la firma del evento `payment_intent.succeeded`.
- **Código de validación seguro:** en lugar del `id` secuencial (adivinable), cada reserva
  tiene un `codigoValidacion` aleatorio corto que va en el mensaje de WhatsApp.
- **Suscripción vencida:** los negocios `vencido` se ocultan del listado público de clientes.

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
- **Tests** (`npm test` en `backend/`): 16 aserciones sobre la lógica crítica.
- **App móvil** Expo en `mobile/` (ver su README).

## Configurar Stripe (opcional, producción)

```env
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...      # de `stripe listen` o del dashboard
STRIPE_PRICE_SAAS=price_...          # precio recurrente del plan mensual
```
Webhooks a registrar: fianza → `POST /api/reservas/webhook/pago`; suscripción →
`POST /api/suscripcion/webhook` (eventos `payment_intent.*`, `invoice.paid`,
`customer.subscription.deleted`).

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
GET    /api/reservas/slots           # slots libres (peluqueroId, servicioId, fecha)
POST   /api/reservas                 # crear reserva (cliente) + intento de pago
POST   /api/reservas/webhook/pago    # confirmación de pago (pasarela)
GET    /api/reservas/mias            # historial del cliente
GET    /api/reservas/agenda          # agenda del peluquero
GET    /api/superadmin/metricas      # métricas globales
PATCH  /api/superadmin/negocios/:id/suscripcion  # suspender/activar
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
