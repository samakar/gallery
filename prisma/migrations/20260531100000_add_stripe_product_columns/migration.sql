-- AlterTable
ALTER TABLE "images" ADD COLUMN "stripe_product_id" TEXT;
ALTER TABLE "images" ADD COLUMN "stripe_price_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "images_stripe_product_id_key" ON "images"("stripe_product_id");
