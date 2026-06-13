-- Adds images.story: optional long-form photographer's narrative ("Story"
-- per Magnum / WPP / Sony Awards photography convention; UI label "Story").
-- 0-2000 chars; plain text with `\n\n` paragraph breaks. Body-only on the
-- deed metadata JSON (not promoted to Arweave tags). Pairs with the existing
-- `description` column (UI-labeled "Caption", 40-280 chars, marketplace-
-- preview blurb).

ALTER TABLE "images" ADD COLUMN "story" TEXT;
