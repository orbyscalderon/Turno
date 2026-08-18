-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('superadmin', 'admin_negocio', 'peluquero', 'cliente');

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('activo', 'vencido', 'prueba');

-- CreateEnum
CREATE TYPE "EstadoAprobacion" AS ENUM ('pendiente', 'aceptado', 'rechazado');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('pendiente', 'pagado', 'reembolsado');

-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('confirmada', 'cancelada', 'no_asistio', 'completada');

-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "telefono" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "rol" "Rol" NOT NULL,
    "foto_url" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negocios" (
    "id" TEXT NOT NULL,
    "nombre_comercial" VARCHAR(150) NOT NULL,
    "slug" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "telefono_contacto" VARCHAR(20) NOT NULL,
    "logo_url" VARCHAR(255),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
    "estado_suscripcion" "EstadoSuscripcion" NOT NULL DEFAULT 'prueba',
    "suscripcion_hasta" TIMESTAMP(3),
    "stripe_customer_id" VARCHAR(255),
    "stripe_subscription_id" VARCHAR(255),
    "dueno_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negocios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones_negocio" (
    "id" SERIAL NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "usada_por" INTEGER,
    "usada_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "expira_en" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peluqueros_equipos" (
    "id" SERIAL NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "estado_aprobacion" "EstadoAprobacion" NOT NULL DEFAULT 'pendiente',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peluqueros_equipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" SERIAL NOT NULL,
    "peluquero_id" INTEGER NOT NULL,
    "nombre_servicio" VARCHAR(100) NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "duracion_minutos" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disponibilidades" (
    "id" SERIAL NOT NULL,
    "peluquero_id" INTEGER NOT NULL,
    "dia" "DiaSemana" NOT NULL,
    "hora_inicio" VARCHAR(5) NOT NULL,
    "hora_fin" VARCHAR(5) NOT NULL,

    CONSTRAINT "disponibilidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservaciones" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "peluquero_id" INTEGER NOT NULL,
    "servicio_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_inicio" VARCHAR(5) NOT NULL,
    "hora_fin" VARCHAR(5) NOT NULL,
    "pago_reserva_status" "EstadoPago" NOT NULL DEFAULT 'pendiente',
    "estado_cita" "EstadoCita" NOT NULL DEFAULT 'confirmada',
    "id_transaccion_pasarela" VARCHAR(255),
    "id_reembolso_pasarela" VARCHAR(255),
    "codigo_validacion" VARCHAR(12) NOT NULL,
    "expira_pago_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "negocios_slug_key" ON "negocios"("slug");

-- CreateIndex
CREATE INDEX "negocios_estado_suscripcion_idx" ON "negocios"("estado_suscripcion");

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_negocio_token_key" ON "invitaciones_negocio"("token");

-- CreateIndex
CREATE INDEX "invitaciones_negocio_negocio_id_idx" ON "invitaciones_negocio"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "peluqueros_equipos_negocio_id_estado_aprobacion_idx" ON "peluqueros_equipos"("negocio_id", "estado_aprobacion");

-- CreateIndex
CREATE UNIQUE INDEX "peluqueros_equipos_negocio_id_usuario_id_key" ON "peluqueros_equipos"("negocio_id", "usuario_id");

-- CreateIndex
CREATE INDEX "servicios_peluquero_id_idx" ON "servicios"("peluquero_id");

-- CreateIndex
CREATE INDEX "disponibilidades_peluquero_id_dia_idx" ON "disponibilidades"("peluquero_id", "dia");

-- CreateIndex
CREATE UNIQUE INDEX "reservaciones_codigo_validacion_key" ON "reservaciones"("codigo_validacion");

-- CreateIndex
CREATE INDEX "reservaciones_peluquero_id_fecha_estado_cita_idx" ON "reservaciones"("peluquero_id", "fecha", "estado_cita");

-- CreateIndex
CREATE INDEX "reservaciones_pago_reserva_status_expira_pago_en_idx" ON "reservaciones"("pago_reserva_status", "expira_pago_en");

-- AddForeignKey
ALTER TABLE "negocios" ADD CONSTRAINT "negocios_dueno_id_fkey" FOREIGN KEY ("dueno_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_negocio" ADD CONSTRAINT "invitaciones_negocio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peluqueros_equipos" ADD CONSTRAINT "peluqueros_equipos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peluqueros_equipos" ADD CONSTRAINT "peluqueros_equipos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_peluquero_id_fkey" FOREIGN KEY ("peluquero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_peluquero_id_fkey" FOREIGN KEY ("peluquero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservaciones" ADD CONSTRAINT "reservaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservaciones" ADD CONSTRAINT "reservaciones_peluquero_id_fkey" FOREIGN KEY ("peluquero_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservaciones" ADD CONSTRAINT "reservaciones_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
