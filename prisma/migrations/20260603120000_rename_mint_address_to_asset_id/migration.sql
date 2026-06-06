-- Rename Deed.mint_address -> Deed.asset_id.
-- cNFTs (Bubblegum) are Merkle-tree leaves; they have no SPL Token mint account.
-- The Metaplex DAS standard identifier is asset_id; the legacy column name
-- was carried over from the Crossmint era (Token Metadata standard).
-- Stored values are unchanged; this is metadata-only.

ALTER TABLE "deeds" RENAME COLUMN "mint_address" TO "asset_id";

DROP INDEX "deeds_mint_address_key";
CREATE UNIQUE INDEX "deeds_asset_id_key" ON "deeds"("asset_id");
