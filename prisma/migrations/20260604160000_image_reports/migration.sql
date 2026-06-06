-- Third-party abuse / safety / rights reports submitted via the image-page
-- Report footer. Anonymous-allowed: reporter_user_id and reporter_email both
-- nullable. recaptcha_score captures the reCAPTCHA Enterprise verdict at
-- submit time (0.0..1.0); status drives the moderation queue.

CREATE TABLE "image_reports" (
    "id"                TEXT NOT NULL PRIMARY KEY,
    "image_id"          TEXT NOT NULL,
    "reporter_user_id"  TEXT,
    "reporter_email"    TEXT,
    "reason"            TEXT NOT NULL,
    "description"       TEXT,
    "ip_address"        TEXT,
    "recaptcha_score"   REAL,
    "recaptcha_action"  TEXT,
    "status"            TEXT NOT NULL DEFAULT 'open',
    "created_at"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "image_reports_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images" ("image_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "image_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users" ("user_id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "image_reports_image_id_created_at_idx" ON "image_reports"("image_id", "created_at" DESC);
CREATE INDEX "image_reports_status_created_at_idx" ON "image_reports"("status", "created_at" DESC);
