-- CreateTable
CREATE TABLE "gastos" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "categoria" VARCHAR(60),
    "descripcion" VARCHAR(200) NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes_negocio" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "telefono" VARCHAR(20),
    "email" VARCHAR(150),
    "direccion" VARCHAR(200),
    "notas" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gastos_negocio_id_idx" ON "gastos"("negocio_id");

-- CreateIndex
CREATE INDEX "clientes_negocio_negocio_id_idx" ON "clientes_negocio"("negocio_id");

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes_negocio" ADD CONSTRAINT "clientes_negocio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
