-- YouTube OAuth + subscriber gate per identity.md §2.8.
-- Adds four nullable identity-snapshot fields to users (populated by
-- POST /v1/creator/youtube/verify) and a note column to creator_allowlist
-- so we can tell apart auto-inserted (YouTube OAuth) vs founder-curated rows.

ALTER TABLE "users" ADD COLUMN "youtube_channel_id" TEXT;
ALTER TABLE "users" ADD COLUMN "youtube_channel_handle" TEXT;
ALTER TABLE "users" ADD COLUMN "youtube_subscriber_count_at_onboarding" INTEGER;
ALTER TABLE "users" ADD COLUMN "youtube_verified_at" DATETIME;

CREATE UNIQUE INDEX "users_youtube_channel_id_key" ON "users"("youtube_channel_id");

ALTER TABLE "creator_allowlist" ADD COLUMN "note" TEXT NOT NULL DEFAULT 'manual';
