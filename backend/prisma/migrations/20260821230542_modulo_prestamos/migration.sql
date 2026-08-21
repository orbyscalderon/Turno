-- CreateEnum
CREATE TYPE "EstadoPrestamo" AS ENUM ('activo', 'pagado', 'cancelado');

-- CreateTable
CREATE TABLE "prestamos" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "deudor_nombre" VARCHAR(120) NOT NULL,
    "deudor_telefono" VARCHAR(20),
    "capital" DECIMAL(12,2) NOT NULL,
    "tasa_interes_mensual" DECIMAL(6,3) NOT NULL,
    "plazo_cuotas" INTEGER NOT NULL,
    "frecuencia" VARCHAR(12) NOT NULL DEFAULT 'mensual',
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoPrestamo" NOT NULL DEFAULT 'activo',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prestamos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuotas_prestamo" (
    "id" TEXT NOT NULL,
    "prestamo_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "fecha_vencimiento" TIMESTAMP(3) NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "capital" DECIMAL(12,2) NOT NULL,
    "interes" DECIMAL(12,2) NOT NULL,
    "monto_pagado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pagada" BOOLEAN NOT NULL DEFAULT false,
    "fecha_pago" TIMESTAMP(3),

    CONSTRAINT "cuotas_prestamo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prestamos_negocio_id_idx" ON "prestamos"("negocio_id");

-- CreateIndex
CREATE INDEX "cuotas_prestamo_prestamo_id_idx" ON "cuotas_prestamo"("prestamo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cuotas_prestamo_prestamo_id_numero_key" ON "cuotas_prestamo"("prestamo_id", "numero");

-- AddForeignKey
ALTER TABLE "prestamos" ADD CONSTRAINT "prestamos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuotas_prestamo" ADD CONSTRAINT "cuotas_prestamo_prestamo_id_fkey" FOREIGN KEY ("prestamo_id") REFERENCES "prestamos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
