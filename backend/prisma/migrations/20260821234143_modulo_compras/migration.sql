-- CreateTable
CREATE TABLE "compras" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "proveedor" VARCHAR(120),
    "total" DECIMAL(12,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineas_compra" (
    "id" TEXT NOT NULL,
    "compra_id" TEXT NOT NULL,
    "producto_id" TEXT,
    "nombre" VARCHAR(150) NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costo_unit" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "lineas_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compras_negocio_id_idx" ON "compras"("negocio_id");

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_compra" ADD CONSTRAINT "lineas_compra_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "compras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineas_compra" ADD CONSTRAINT "lineas_compra_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
