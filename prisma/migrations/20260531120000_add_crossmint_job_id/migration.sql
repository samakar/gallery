-- AlterTable
ALTER TABLE "purchases" ADD COLUMN "crossmint_job_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "purchases_crossmint_job_id_key" ON "purchases"("crossmint_job_id");
