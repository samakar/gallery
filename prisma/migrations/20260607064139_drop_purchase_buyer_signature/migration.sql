/*
  Warnings:

  - You are about to drop the column `buyer_signature_b64` on the `purchases` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_purchases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "image_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "crossmint_job_id" TEXT,
    "amount_gross_cents" INTEGER,
    "amount_creator_net_cents" INTEGER,
    "amount_platform_net_cents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'started',
    "failure_reason" TEXT,
    "monogram_text" TEXT,
    "deed_mint_tx_signature" TEXT,
    "signing_event_id_mja" TEXT,
    "signing_event_id_license" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "purchases_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images" ("image_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "purchases_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "purchases_signing_event_id_mja_fkey" FOREIGN KEY ("signing_event_id_mja") REFERENCES "signatures" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchases_signing_event_id_license_fkey" FOREIGN KEY ("signing_event_id_license") REFERENCES "signatures" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_purchases" ("amount_creator_net_cents", "amount_gross_cents", "amount_platform_net_cents", "completed_at", "created_at", "crossmint_job_id", "deed_mint_tx_signature", "failure_reason", "id", "image_id", "monogram_text", "owner_id", "seller_user_id", "signing_event_id_license", "signing_event_id_mja", "status", "stripe_checkout_session_id", "stripe_payment_intent_id") SELECT "amount_creator_net_cents", "amount_gross_cents", "amount_platform_net_cents", "completed_at", "created_at", "crossmint_job_id", "deed_mint_tx_signature", "failure_reason", "id", "image_id", "monogram_text", "owner_id", "seller_user_id", "signing_event_id_license", "signing_event_id_mja", "status", "stripe_checkout_session_id", "stripe_payment_intent_id" FROM "purchases";
DROP TABLE "purchases";
ALTER TABLE "new_purchases" RENAME TO "purchases";
CREATE UNIQUE INDEX "purchases_crossmint_job_id_key" ON "purchases"("crossmint_job_id");
CREATE INDEX "purchases_stripe_payment_intent_id_idx" ON "purchases"("stripe_payment_intent_id");
CREATE INDEX "purchases_owner_id_created_at_idx" ON "purchases"("owner_id", "created_at" DESC);
CREATE INDEX "purchases_seller_user_id_status_created_at_idx" ON "purchases"("seller_user_id", "status", "created_at" DESC);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
