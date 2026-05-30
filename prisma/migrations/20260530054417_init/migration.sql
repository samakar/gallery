-- CreateTable
CREATE TABLE "users" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "magic_did" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "oauth_provider" TEXT NOT NULL,
    "wallet_address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "creator_allowlist" (
    "email" TEXT NOT NULL PRIMARY KEY,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "creators" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "legal_address" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "youtube_channel_handle" TEXT NOT NULL,
    "creator_headshot_url" TEXT,
    "creator_bio" TEXT,
    "stripe_connect_account_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "creators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "owners" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "stripe_customer_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "owners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "images" (
    "image_id" TEXT NOT NULL PRIMARY KEY,
    "creator_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "creation_date" DATETIME NOT NULL,
    "listed_price" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "takedown_reason" TEXT,
    "dek_wrapped" BLOB,
    "arweave_uri" TEXT,
    "sha256" TEXT,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "privacy_updated_at" DATETIME,
    "signing_event_id_authorship" TEXT,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "images_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "image_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "image_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "checks" TEXT NOT NULL,
    "ncmec_report_filed_at" DATETIME,
    "decided_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "image_reviews_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images" ("image_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "image_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_version_hash" TEXT NOT NULL,
    "document_version_label" TEXT NOT NULL,
    "image_id" TEXT,
    "clicked_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    CONSTRAINT "signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "signatures_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images" ("image_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "image_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "seller_user_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
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

-- CreateTable
CREATE TABLE "deeds" (
    "image_id" TEXT NOT NULL PRIMARY KEY,
    "mint_address" TEXT NOT NULL,
    "owner_wallet_address" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "deed_state" TEXT NOT NULL DEFAULT 'sealed',
    "variant_hashes" TEXT NOT NULL,
    "minted_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "deeds_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images" ("image_id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deeds_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners" ("user_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_magic_did_key" ON "users"("magic_did");

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "owners_stripe_customer_id_idx" ON "owners"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "images_creator_id_status_idx" ON "images"("creator_id", "status");

-- CreateIndex
CREATE INDEX "images_status_published_at_idx" ON "images"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "images_status_created_at_idx" ON "images"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "image_reviews_image_id_idx" ON "image_reviews"("image_id");

-- CreateIndex
CREATE INDEX "signatures_user_id_document_type_idx" ON "signatures"("user_id", "document_type");

-- CreateIndex
CREATE INDEX "purchases_stripe_payment_intent_id_idx" ON "purchases"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "purchases_owner_id_created_at_idx" ON "purchases"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "purchases_seller_user_id_status_created_at_idx" ON "purchases"("seller_user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "deeds_mint_address_key" ON "deeds"("mint_address");

-- CreateIndex
CREATE INDEX "deeds_owner_wallet_address_idx" ON "deeds"("owner_wallet_address");

-- CreateIndex
CREATE INDEX "deeds_owner_id_minted_at_idx" ON "deeds"("owner_id", "minted_at" DESC);
