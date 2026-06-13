-- Adds optional YouTube video association to images + moment-of-sealing
-- snapshot columns to deeds.
--
-- images.video_url, images.video_moment_seconds:
--   Creator-entered YouTube video association captured at upload/listing.
--   Frozen into deeds.video_snapshot + the Arweave metadata JSON's
--   `video_snapshot` block at mint.
--
-- deeds.creator_snapshot, deeds.video_snapshot:
--   JSON-stringified snapshots fetched from the YouTube Data API at mint
--   (the "moment of sealing"). DB columns mirror what gets written into the
--   Arweave metadata JSON so the platform UI / sweepers can read them
--   without a fresh YouTube fetch or an Arweave round-trip.

ALTER TABLE "images" ADD COLUMN "video_url" TEXT;
ALTER TABLE "images" ADD COLUMN "video_moment_seconds" INTEGER;

ALTER TABLE "deeds" ADD COLUMN "creator_snapshot" TEXT;
ALTER TABLE "deeds" ADD COLUMN "video_snapshot" TEXT;
