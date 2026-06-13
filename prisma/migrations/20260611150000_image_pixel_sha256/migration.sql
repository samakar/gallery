-- Adds images.pixel_sha256: sha256 over the JPEG file with metadata marker
-- segments (APP1 EXIF/XMP, APP2 ICC, APP13 IPTC, COM) byte-surgically
-- removed. Pixel-content identity anchor; metadata-agnostic. Tool-independent
-- given the precise strip rule in /src/cert/pixel_hash.ts. Null for
-- non-JPEG uploads (PNG / TIFF / HEIC / WebP) until parsers for those
-- containers ship.
--
-- Distinguishes "pixels intact + metadata edited" (sha256 mismatch +
-- pixel_sha256 match) from "pixels altered" (pixel_sha256 mismatch) in a
-- way the full-file sha256 and the perceptual phash cannot.

ALTER TABLE "images" ADD COLUMN "pixel_sha256" TEXT;
