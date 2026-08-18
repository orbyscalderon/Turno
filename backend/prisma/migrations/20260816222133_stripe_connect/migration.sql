-- AlterTable
ALTER TABLE "negocios" ADD COLUMN     "cobros_activos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_connect_account_id" VARCHAR(255);
