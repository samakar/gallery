-- Email subsystem support per /docs/cert/email.md.
-- users.email_status drives Postmark bounce / complaint suppression so
-- subsequent sends short-circuit. signatures.email_message_id is the audit
-- anchor proving the buyer-retained PDF copy was dispatched.

ALTER TABLE "users" ADD COLUMN "email_status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "signatures" ADD COLUMN "email_message_id" TEXT;
