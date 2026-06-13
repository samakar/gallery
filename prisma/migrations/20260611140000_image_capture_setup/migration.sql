-- Adds images.capture_setup (JSON-stringified): EXIF-derived camera, lens,
-- and exposure fields read at Card 1 upload. Distinguishes professional
-- capture (specific Make/Model, lens metadata, manual exposure, RAW format,
-- pre-programmed Artist/Copyright) from phone / point-and-shoot defaults.
-- Frozen into the deed's `capture_setup` block in the Arweave metadata JSON
-- at mint.

ALTER TABLE "images" ADD COLUMN "capture_setup" TEXT;
