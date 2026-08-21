-- CreateTable
CREATE TABLE "lotes_biologicos" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "especie" VARCHAR(20) NOT NULL DEFAULT 'broiler',
    "tipo_produccion" VARCHAR(20) NOT NULL DEFAULT 'meat',
    "cantidad_inicial" INTEGER NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "costo_inicial" DECIMAL(12,2),
    "estado" VARCHAR(10) NOT NULL DEFAULT 'activo',
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_biologicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_agro" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "mortalidad" INTEGER NOT NULL DEFAULT 0,
    "alimento_kg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "peso_promedio_g" DECIMAL(12,3),
    "produccion" INTEGER NOT NULL DEFAULT 0,
    "notas" VARCHAR(200),

    CONSTRAINT "registros_agro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesas" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "nombre" VARCHAR(40) NOT NULL,
    "estado" VARCHAR(10) NOT NULL DEFAULT 'libre',

    CONSTRAINT "mesas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comandas" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "mesa_id" TEXT,
    "estado" VARCHAR(10) NOT NULL DEFAULT 'abierta',
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comandas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_comanda" (
    "id" TEXT NOT NULL,
    "comanda_id" TEXT NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unit" DECIMAL(12,2) NOT NULL,
    "notas" VARCHAR(200),

    CONSTRAINT "lineas_comanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordenes_servicio" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "cliente_nombre" VARCHAR(120) NOT NULL,
    "cliente_telefono" VARCHAR(20),
    "equipo" VARCHAR(200) NOT NULL,
    "problema" TEXT,
    "diagnostico" TEXT,
    "estado" VARCHAR(15) NOT NULL DEFAULT 'recibido',
    "costo_estimado" DECIMAL(12,2),
    "costo_final" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lotes_biologicos_negocio_id_idx" ON "lotes_biologicos"("negocio_id");

-- CreateIndex
CREATE INDEX "registros_agro_lote_id_idx" ON "registros_agro"("lote_id");

-- CreateIndex
CREATE UNIQUE INDEX "registros_agro_lote_id_fecha_key" ON "registros_agro"("lote_id", "fecha");

-- CreateIndex
CREATE INDEX "mesas_negocio_id_idx" ON "mesas"("negocio_id");

-- CreateIndex
CREATE INDEX "comandas_negocio_id_idx" ON "comandas"("negocio_id");

-- CreateIndex
CREATE INDEX "ordenes_servicio_negocio_id_idx" ON "ordenes_servicio"("negocio_id");

-- AddForeignKey
ALTER TABLE "lotes_biologicos" ADD CONSTRAINT "lotes_biologicos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_agro" ADD CONSTRAINT "registros_agro_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_biologicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_mesa_id_fkey" FOREIGN KEY ("mesa_id") REFERENCES "mesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_comanda" ADD CONSTRAINT "lineas_comanda_comanda_id_fkey" FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_servicio" ADD CONSTRAINT "ordenes_servicio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
