-- AlterTable
ALTER TABLE "reservaciones" ADD COLUMN     "bono_id" INTEGER,
ADD COLUMN     "propina" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "totp_activado_en" TIMESTAMP(3),
ADD COLUMN     "totp_secret" VARCHAR(255);

-- CreateTable
CREATE TABLE "codigos_recuperacion" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "usado_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_recuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lista_espera" (
    "id" SERIAL NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "peluquero_id" INTEGER NOT NULL,
    "servicio_id" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "hora_desde" VARCHAR(5),
    "hora_hasta" VARCHAR(5),
    "avisado_en" TIMESTAMP(3),
    "cancelada" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paquetes" (
    "id" SERIAL NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "servicio_id" INTEGER NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "sesiones" INTEGER NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "validez_dias" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paquetes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonos_cliente" (
    "id" SERIAL NOT NULL,
    "paquete_id" INTEGER NOT NULL,
    "cliente_id" INTEGER NOT NULL,
    "emitido_por" INTEGER NOT NULL,
    "sesiones_totales" INTEGER NOT NULL,
    "sesiones_usadas" INTEGER NOT NULL DEFAULT 0,
    "expira_en" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_producto" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "usuario_id" INTEGER,
    "sesion" VARCHAR(40) NOT NULL,
    "ruta" VARCHAR(160),
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_producto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "codigos_recuperacion_usuario_id_idx" ON "codigos_recuperacion"("usuario_id");

-- CreateIndex
CREATE INDEX "lista_espera_peluquero_id_fecha_cancelada_idx" ON "lista_espera"("peluquero_id", "fecha", "cancelada");

-- CreateIndex
CREATE UNIQUE INDEX "lista_espera_cliente_id_peluquero_id_servicio_id_fecha_key" ON "lista_espera"("cliente_id", "peluquero_id", "servicio_id", "fecha");

-- CreateIndex
CREATE INDEX "paquetes_negocio_id_activo_idx" ON "paquetes"("negocio_id", "activo");

-- CreateIndex
CREATE INDEX "paquetes_servicio_id_idx" ON "paquetes"("servicio_id");

-- CreateIndex
CREATE INDEX "bonos_cliente_cliente_id_expira_en_idx" ON "bonos_cliente"("cliente_id", "expira_en");

-- CreateIndex
CREATE INDEX "bonos_cliente_paquete_id_idx" ON "bonos_cliente"("paquete_id");

-- CreateIndex
CREATE INDEX "eventos_producto_nombre_created_at_idx" ON "eventos_producto"("nombre", "created_at");

-- CreateIndex
CREATE INDEX "eventos_producto_sesion_idx" ON "eventos_producto"("sesion");

-- CreateIndex
CREATE INDEX "eventos_producto_created_at_idx" ON "eventos_producto"("created_at");

-- CreateIndex
CREATE INDEX "reservaciones_bono_id_idx" ON "reservaciones"("bono_id");

-- AddForeignKey
ALTER TABLE "reservaciones" ADD CONSTRAINT "reservaciones_bono_id_fkey" FOREIGN KEY ("bono_id") REFERENCES "bonos_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_recuperacion" ADD CONSTRAINT "codigos_recuperacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_peluquero_id_fkey" FOREIGN KEY ("peluquero_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes" ADD CONSTRAINT "paquetes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paquetes" ADD CONSTRAINT "paquetes_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonos_cliente" ADD CONSTRAINT "bonos_cliente_paquete_id_fkey" FOREIGN KEY ("paquete_id") REFERENCES "paquetes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonos_cliente" ADD CONSTRAINT "bonos_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonos_cliente" ADD CONSTRAINT "bonos_cliente_emitido_por_fkey" FOREIGN KEY ("emitido_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
