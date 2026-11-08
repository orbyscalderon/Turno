-- AlterTable
ALTER TABLE "reservaciones" ADD COLUMN     "cancelada_en" TIMESTAMP(3),
ADD COLUMN     "cancelada_por" VARCHAR(10),
ADD COLUMN     "completada_en" TIMESTAMP(3),
ADD COLUMN     "motivo_cancelacion" VARCHAR(200),
ADD COLUMN     "recordatorio_corto_en" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "webhook_eventos" (
    "id" SERIAL NOT NULL,
    "proveedor" VARCHAR(20) NOT NULL,
    "evento_id" VARCHAR(255) NOT NULL,
    "tipo" VARCHAR(80) NOT NULL,
    "procesado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_eventos_procesado_en_idx" ON "webhook_eventos"("procesado_en");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_eventos_proveedor_evento_id_key" ON "webhook_eventos"("proveedor", "evento_id");

-- CreateIndex
CREATE INDEX "negocios_estado_suscripcion_suscripcion_hasta_idx" ON "negocios"("estado_suscripcion", "suscripcion_hasta");

-- CreateIndex
CREATE INDEX "negocios_lat_lng_idx" ON "negocios"("lat", "lng");

-- CreateIndex
CREATE INDEX "negocios_stripe_customer_id_idx" ON "negocios"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "reservaciones_cliente_id_fecha_idx" ON "reservaciones"("cliente_id", "fecha");

-- CreateIndex
CREATE INDEX "reservaciones_id_transaccion_pasarela_idx" ON "reservaciones"("id_transaccion_pasarela");

-- Red de seguridad a nivel de BASE DE DATOS contra la doble reserva.
-- El lock de aplicación (pg_advisory_xact_lock) serializa las peticiones, pero este
-- índice garantiza la invariante aunque el lock falle o existan varias instancias:
-- un profesional no puede tener dos citas CONFIRMADAS que empiecen a la misma hora.
CREATE UNIQUE INDEX IF NOT EXISTS "reservaciones_slot_confirmado_unico"
  ON "reservaciones" ("peluquero_id", "fecha", "hora_inicio")
  WHERE "estado_cita" = 'confirmada';
