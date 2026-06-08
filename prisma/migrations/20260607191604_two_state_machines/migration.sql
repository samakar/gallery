-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_deeds" (
    "image_id" TEXT NOT NULL PRIMARY KEY,
    "asset_id" TEXT NOT NULL,
    "owner_wallet_address" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "deed_state" TEXT NOT NULL DEFAULT 'sealed',
    "legal_state" TEXT NOT NULL DEFAULT 'legit',
    "variant_hashes" TEXT NOT NULL,
    "enc_final_unwrapped" TEXT,
    "minted_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "deeds_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images" ("image_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deeds_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_deeds" ("asset_id", "created_at", "deed_state", "enc_final_unwrapped", "image_id", "minted_at", "owner_id", "owner_wallet_address", "updated_at", "variant_hashes") SELECT "asset_id", "created_at", "deed_state", "enc_final_unwrapped", "image_id", "minted_at", "owner_id", "owner_wallet_address", "updated_at", "variant_hashes" FROM "deeds";
DROP TABLE "deeds";
ALTER TABLE "new_deeds" RENAME TO "deeds";
CREATE UNIQUE INDEX "deeds_asset_id_key" ON "deeds"("asset_id");
CREATE INDEX "deeds_owner_wallet_address_idx" ON "deeds"("owner_wallet_address");
CREATE INDEX "deeds_owner_id_minted_at_idx" ON "deeds"("owner_id", "minted_at" DESC);
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
