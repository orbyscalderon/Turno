/*
  Warnings:

  - You are about to drop the `clientes_negocio` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `comandas` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compras` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `cuotas_prestamo` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `gastos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lineas_comanda` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lineas_compra` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lineas_venta` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lotes_biologicos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mesas` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `movimientos_stock` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ordenes_servicio` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `prestamos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `productos` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `registros_agro` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sesiones_caja` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ventas` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "clientes_negocio" DROP CONSTRAINT "clientes_negocio_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "comandas" DROP CONSTRAINT "comandas_mesa_id_fkey";

-- DropForeignKey
ALTER TABLE "comandas" DROP CONSTRAINT "comandas_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "compras" DROP CONSTRAINT "compras_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "cuotas_prestamo" DROP CONSTRAINT "cuotas_prestamo_prestamo_id_fkey";

-- DropForeignKey
ALTER TABLE "gastos" DROP CONSTRAINT "gastos_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "lineas_comanda" DROP CONSTRAINT "lineas_comanda_comanda_id_fkey";

-- DropForeignKey
ALTER TABLE "lineas_compra" DROP CONSTRAINT "lineas_compra_compra_id_fkey";

-- DropForeignKey
ALTER TABLE "lineas_compra" DROP CONSTRAINT "lineas_compra_producto_id_fkey";

-- DropForeignKey
ALTER TABLE "lineas_venta" DROP CONSTRAINT "lineas_venta_producto_id_fkey";

-- DropForeignKey
ALTER TABLE "lineas_venta" DROP CONSTRAINT "lineas_venta_venta_id_fkey";

-- DropForeignKey
ALTER TABLE "lotes_biologicos" DROP CONSTRAINT "lotes_biologicos_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "mesas" DROP CONSTRAINT "mesas_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "movimientos_stock" DROP CONSTRAINT "movimientos_stock_producto_id_fkey";

-- DropForeignKey
ALTER TABLE "ordenes_servicio" DROP CONSTRAINT "ordenes_servicio_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "prestamos" DROP CONSTRAINT "prestamos_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "productos" DROP CONSTRAINT "productos_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "registros_agro" DROP CONSTRAINT "registros_agro_lote_id_fkey";

-- DropForeignKey
ALTER TABLE "sesiones_caja" DROP CONSTRAINT "sesiones_caja_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "ventas" DROP CONSTRAINT "ventas_negocio_id_fkey";

-- DropForeignKey
ALTER TABLE "ventas" DROP CONSTRAINT "ventas_sesion_caja_id_fkey";

-- DropTable
DROP TABLE "clientes_negocio";

-- DropTable
DROP TABLE "comandas";

-- DropTable
DROP TABLE "compras";

-- DropTable
DROP TABLE "cuotas_prestamo";

-- DropTable
DROP TABLE "gastos";

-- DropTable
DROP TABLE "lineas_comanda";

-- DropTable
DROP TABLE "lineas_compra";

-- DropTable
DROP TABLE "lineas_venta";

-- DropTable
DROP TABLE "lotes_biologicos";

-- DropTable
DROP TABLE "mesas";

-- DropTable
DROP TABLE "movimientos_stock";

-- DropTable
DROP TABLE "ordenes_servicio";

-- DropTable
DROP TABLE "prestamos";

-- DropTable
DROP TABLE "productos";

-- DropTable
DROP TABLE "registros_agro";

-- DropTable
DROP TABLE "sesiones_caja";

-- DropTable
DROP TABLE "ventas";

-- DropEnum
DROP TYPE "EstadoPrestamo";
