# Identity Subsystem

Identity + session + role gate. Magic SDK OAuth (Google / Apple) at the client; Magic admin DID-token verification on every authenticated route at the server. Role grants are row-existence in `creators` / `owners` (no role enum on `users`); the moderator role at MVP is the founder, enforced at the admin-route layer by env-config `magic_did`. The `creator_allowlist` is a hard precondition for sign-cma. Wallet provisioning is triggered here post-ESIGN; the wallet primitive itself is Registry-owned per INV-4.

## 1. Interface

### 1.1 Inputs

#### verifyDidToken(token)
Server-side verification of the `Authorization: Bearer <did_token>` header.

#### requireRole(user, role)
role ∈ {`creator`, `owner`, `moderator`}.

#### assertCreatorAllowlisted(email)
Precondition for sign-cma; matched against `creator_allowlist.email`.

#### provisionWalletIfMissing(user_id)
Called by esign immediately after CMA / MJA capture. Idempotent on `users.wallet_address`.

### 1.2 Outputs

Authenticated principal: `{ user_id, magic_did, email, oauth_provider, wallet_address, roles: { is_creator, is_owner, is_moderator } }`.

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| MAGIC_DID_INVALID | DID token verification failed |
| ROLE_REQUIRED | principal lacks the required role |
| CREATOR_NOT_ALLOWLISTED | email not in `creator_allowlist` at sign-cma |

Per R71 §3.7.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | authenticated routes carry `Authorization: Bearer <did_token>` |
| Post (verify pass) | `users` row exists for `magic_did`; created on first sight |
| Post (allowlist hit) | `users.email` matches a `creator_allowlist` row |
| Post (wallet provision) | `users.wallet_address` populated; idempotent on re-auth |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | valid DID token | `GET /v1/me` | profile returned |
| AC-02 | expired / forged DID | any authed route | `MAGIC_DID_INVALID` |
| AC-03 | first OAuth | `POST /v1/auth/session` | `users` row created; wallet NULL pending ESIGN |
| AC-04 | re-auth same identity | session call | same row + same wallet recovered |
| AC-05 | email not in allowlist | `POST /v1/creator/sign-cma` | `CREATOR_NOT_ALLOWLISTED` |
| AC-06 | non-moderator | `POST /v1/admin/reviews/*` | `ROLE_REQUIRED` |

## 2. Functional Requirements

### 2.1 Identity Providers
**User login** at MVP is Magic SDK with Google + Apple backends (R71 §2.1, §2.4), covering both creator and buyer authentication uniformly. No password, no email verification.

**Creator channel-ownership verification via YouTube OAuth** is a separate, deferred concern (R71 §2.1: "YouTube OAuth verification deferred to self-signup buildout"). At MVP the founder manually verifies the creator's YouTube channel during hand-recruitment, then inserts the creator's email into `creator_allowlist`. See §2.8 and OI-05.

### 2.2 DID Token Verification
Per request: `magic.token.validate(didToken)` then `magic.token.getIssuer(didToken)` -> resolves `users.magic_did` (R71 §3.3 Magic). Failure short-circuits with `MAGIC_DID_INVALID`.

### 2.3 Role Model (Row-Existence)

| Role | Grant |
|---|---|
| creator | `creators` row exists (created by esign after CMA per INV-2) |
| owner | `owners` row exists (created by esign after MJA per INV-2) |
| moderator | MVP: env-config `FOUNDER_MAGIC_DID` matches; see OI-01 |

A `users` row may carry both creator and owner roles concurrently.

### 2.4 Creator Allowlist
`POST /v1/creator/sign-cma` (R71 §3.7 row 4) rejects with `CREATOR_NOT_ALLOWLISTED` unless `users.email` matches a `creator_allowlist` row. Vetting evidence (subscriber count, channel handle, rationale) is out-of-band; the table records only the allow decision.

### 2.5 Session Endpoints
- `POST /v1/auth/session` (R71 §3.7 row 1): create or fetch `users` row; return profile.
- `DELETE /v1/auth/session` (row 2): clear server-side cached profile (sessions are token-stateless).
- `GET /v1/me` (row 3): current profile + derived `roles` flags.

### 2.6 Wallet Provisioning Trigger
On CMA capture (creators) and MJA capture (buyers), invoke Magic's silent wallet provisioning; write the returned `publicAddress` to `users.wallet_address`. Re-auth recovers the same wallet deterministically. The wallet primitive is Registry-owned per INV-4; identity is the trigger only.

### 2.7 Creator Profile Capture (at sign-cma)
`POST /v1/creator/sign-cma` (R71 §3.7 row 4) creates the `creators` row in the same transaction as the CMA `signatures` row (esign). Required profile fields combine R71 §2.1 step 2 + R62 §3.1 (creator-account display fields; image-page rendering per R62 §4.3 depends on these):

| Field | Type | Source | Notes |
|---|---|---|---|
| legal_name | string | R71 §2.1 step 2 | CMA counterparty; embedded in the rendered CMA text |
| legal_address | JSON | R71 §2.1 step 2 | service of process; standard contract practice |
| entity_type | enum | R71 §2.1 step 2 | `individual` \| `llc` \| `corp`; counterparty type and 1099 classification context |
| display_name | string | R71 §2.1 step 2 | public artist credit on image-page framing chrome (R62 §4.3) |
| youtube_channel_handle | string | R71 §2.1 step 2 | channel of record; founder-verified at MVP (see §2.8); `creator_channel_url` for R62 §4.3 creator-presence block is derived as `https://youtube.com/${handle}` |
| creator_headshot | Image (square, 512×512 min) | R62 §3.1 | required upload; persisted via storage subsystem; surfaces in image-page creator-presence block (R62 §4.3) and on the (post-MVP) Creator Page hero |
| creator_bio | text (80-800 chars) | R62 §3.1 | required at onboarding; first-person "about me" voice (distinct from the per-image `description` captured at Card 3 List, which is per-work voice) |

`creators.stripe_connect_account_id` is NULL at MVP launch and populated when the creator completes Stripe Connect Express onboarding (immediate post-launch buildout per R71 §2.1; tax ID, bank, and 1099 live on Stripe's side, not duplicated here). Standard `created_at` / `updated_at` are managed by Prisma.

Profile fields are creator-editable post-onboarding with immediate propagation across all of the creator's Gallery surfaces (R62 §3.1).

### 2.8 YouTube OAuth (Creator Channel Verification, Deferred)
At MVP, channel ownership is established out-of-band: the founder validates subscriber count, channel age, content cadence, and channel ownership during hand-recruitment, then inserts the creator's primary email into `creator_allowlist` (§2.4). Active YouTube OAuth verification -- the creator signing into their YouTube channel as a precondition for `youtube_channel_handle` capture -- is the self-signup buildout path (R71 §2.1) and out of MVP scope. The `youtube_channel_handle` field is captured at sign-cma but is trusted (founder-verified upstream); no programmatic verification at MVP. Activation triggers and OAuth scope are OI-05.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| DID verification latency | <= 50 ms p95 |
| Sessions | token-stateless; no server-side store |
| Audit | every failure logged via Pino with token hash + reason |
| Wallet provisioning | idempotent; never re-creates an existing wallet |

## 4. Dependencies

| Dependency | Role |
|---|---|
| `magic-sdk`, `@magic-sdk/admin` (R71 §3.2) | client OAuth + server DID verification |
| `users`, `creator_allowlist`, `creators`, `owners` (Prisma) | identity + role grants |
| esign | role-granting signatures (CMA, MJA) precede role-row creation per INV-2 |
| storage (TBD) | `creator_headshot` upload + persistence (R62 §3.1) |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Moderator role storage: env-config `FOUNDER_MAGIC_DID` at MVP. MMP delegation needs a `users.role` column or a `moderators` table; mirrors moderation OI-05 |
| OI-02 | DID verification cache: every request hits Magic. If latency dominates, a ~60s token-hash cache is the standard mitigation -- not at MVP |
| OI-03 | Logout: token stays valid until Magic-side expiry; explicit revocation would require Magic's `logoutByPublicAddress` |
| OI-04 | Allowlist removal post-CMA: existing `creators` row stays valid; intended behavior undecided |
| OI-05 | YouTube OAuth activation criteria: at MVP the founder verifies channel ownership manually before allowlisting, so YouTube OAuth is unneeded. Activation triggers (self-signup launch, scaling beyond founder bandwidth) and the implementation surface (Google OAuth scope `youtube.readonly`, channel-id resolution, binding to `youtube_channel_handle`) are spec'd post-MVP |
| OI-06 | R71 §3.6 `creators` schema does not yet carry `creator_headshot` or `creator_bio` columns (R62 §3.1 specifies them as required MVP fields). Treated as MVP scope here per the UI-follows-R62 decision; pending R71 schema propagation. `creator_channel_url` is derived at render time from `youtube_channel_handle` and needs no separate column |

## 6. Cross-References

| Doc | Purpose |
|---|---|
| esign | CMA / MJA capture invokes identity.provisionWalletIfMissing post-write |
| R71 §2.1 step 2 | creator profile fields captured at sign-cma |
| R71 §2.1, §2.3, §2.4 | onboarding flows |
| R71 §3.2 (Magic libraries) | magic-sdk + admin SDK |
| R71 §3.3 Magic | DID verification mechanics |
| R71 §3.6 | `users` / `creator_allowlist` / `creators` / `owners` tables |
| R71 §3.7 rows 1-3 | session endpoints |
| R71 §3.7 row 4 | sign-cma endpoint (creator profile capture orchestration) |
| R62 §3.1 | creator-account display fields (`creator_headshot`, `creator_bio`, `creator_channel_url`) -- canonical at MVP per UI-follows-R62 decision |
| R62 §4.3 | image-page creator-presence block + Creator Page hero -- consumes the §3.1 fields |
| Constitution INV-2 | ESIGN precedes role-row creation |
| Constitution INV-4 | wallet Registry-owned; identity is trigger only |

---
*Last Updated: 05/29/26 10:00*
