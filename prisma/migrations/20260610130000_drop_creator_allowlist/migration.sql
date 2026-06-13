-- Drop the creator_allowlist table.
--
-- The allowlist is now a launch-phase env-config gate (CREATOR_ALLOWLIST_ENABLED +
-- CREATOR_ALLOWLIST_EMAILS), not a per-user row. See identity.md §2.4.
--
-- The YouTube eligibility gate (§2.8) is a separate independent check on the
-- users.youtube_verified_at column, which stays. Pre-existing creators with
-- creators rows are unaffected -- the gate guarded sign-cma admission, not
-- ongoing entitlement.

DROP TABLE IF EXISTS "creator_allowlist";
