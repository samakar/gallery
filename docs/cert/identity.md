# Identity Subsystem

Identity + session + role gate. Magic SDK OAuth (Google / Apple) at the client; Magic admin DID-token verification on every authenticated route at the server. Role grants are row-existence in `creators` / `owners` (no role enum on `users`); the moderator role at MVP is the founder, enforced at the admin-route layer by env-config `magic_did`. The launch-phase creator-allowlist gate (`CREATOR_ALLOWLIST_ENABLED` env, §2.4) and the YouTube eligibility gate (§2.8) compose to authorize sign-cma. Wallet provisioning is triggered here post-ESIGN; the wallet primitive itself is Registry-owned per INV-4.

## 1. Interface

### 1.1 Inputs

#### verifyDidToken(token)
Server-side verification of the `Authorization: Bearer <did_token>` header.

#### requireRole(user, role)
role ∈ {`creator`, `owner`, `moderator`}.

#### assertCreatorAllowlisted(email)
Precondition for sign-cma. When `CREATOR_ALLOWLIST_ENABLED=true`, checks the email against the `CREATOR_ALLOWLIST_EMAILS` env list. When `false`, no-op (gate is inert). See §2.4.

#### verifyYoutubeEligibility(user_id, oauth_code)
Exchanges Google OAuth code for a YouTube `youtube.readonly` access token; calls YouTube Data API v3 `channels.list?part=snippet,statistics&mine=true`; gates on `statistics.subscriberCount >= 100_000`. On pass: persists `youtube_channel_id`, `youtube_channel_handle`, `youtube_subscriber_count_at_onboarding`, `youtube_verified_at` on the user's pending-creator profile. Single-shot gate -- not re-checked after onboarding (§2.8).

#### provisionWalletIfMissing(user_id)
Called by esign immediately after CMA / MJA capture. Idempotent on `users.wallet_address`.

### 1.2 Outputs

Authenticated principal: `{ user_id, magic_did, email, oauth_provider, wallet_address, roles: { is_creator, is_owner, is_moderator } }`.

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| MAGIC_DID_INVALID | DID token verification failed |
| ROLE_REQUIRED | principal lacks the required role |
| CREATOR_NOT_ALLOWLISTED | `CREATOR_ALLOWLIST_ENABLED=true` and the user's email is not in `CREATOR_ALLOWLIST_EMAILS` |
| ROLE_CONFLICT_USER_IS_BUYER | sign-cma attempted but the user already has an `owners` row (MVP single-role exclusivity, §2.3) |
| ROLE_CONFLICT_USER_IS_CREATOR | first-purchase MJA capture attempted but the user already has a `creators` row (MVP single-role exclusivity, §2.3) |
| YOUTUBE_OAUTH_FAILED | Google OAuth code exchange or `channels.list` / `playlistItems.list` call failed |
| YOUTUBE_NO_CHANNEL | OAuth succeeded but the Google account has no associated YouTube channel |
| YOUTUBE_INSUFFICIENT_SUBSCRIBERS | `subscriberCount < 100_000` |
| YOUTUBE_HIDDEN_SUBSCRIBERS | `hiddenSubscriberCount == true`; cannot verify the gate -- creator must unhide and retry |
| YOUTUBE_DORMANT_CHANNEL | Channel uploaded fewer than 6 public videos in the last 180 days (configurable via `YOUTUBE_DORMANCY_MIN_UPLOADS` / `YOUTUBE_DORMANCY_LOOKBACK_DAYS`) |
| YOUTUBE_CHANNEL_ALREADY_CLAIMED | OAuth + all gates passed but the verified `channel_id` (UC-prefix) is already bound to a different Epimage `users` row. One channel = one account; enforced by `User.youtube_channel_id @unique` constraint |
| ALREADY_VERIFIED | The current `users` row has already completed YouTube verification (`youtube_verified_at` not null). Re-verification is a no-op |

Per R71 §3.7.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | authenticated routes carry `Authorization: Bearer <did_token>` |
| Post (verify pass) | `users` row exists for `magic_did`; created on first sight |
| Post (allowlist gate pass) | When `CREATOR_ALLOWLIST_ENABLED=true`, `users.email` is in `CREATOR_ALLOWLIST_EMAILS`; otherwise no-op |
| Post (wallet provision) | `users.wallet_address` populated; idempotent on re-auth |
| Post (YouTube eligibility pass) | `youtube_channel_id`, `youtube_channel_handle`, `youtube_subscriber_count_at_onboarding`, `youtube_verified_at` persisted on the pending-creator profile; values frozen at onboarding -- not refreshed. No allowlist side-effect (the allowlist is a separate launch-phase gate per §2.4). |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | valid DID token | `GET /v1/me` | profile returned |
| AC-02 | expired / forged DID | any authed route | `MAGIC_DID_INVALID` |
| AC-03 | first OAuth | `POST /v1/auth/session` | `users` row created; wallet NULL pending ESIGN |
| AC-04 | re-auth same identity | session call | same row + same wallet recovered |
| AC-05 | `CREATOR_ALLOWLIST_ENABLED=true` and email not in `CREATOR_ALLOWLIST_EMAILS` | `POST /v1/creator/sign-cma` | `CREATOR_NOT_ALLOWLISTED` |
| AC-05b | `CREATOR_ALLOWLIST_ENABLED=false` (gate inert) | `POST /v1/creator/sign-cma` | allowlist gate passes regardless of email |
| AC-06 | non-moderator | `POST /v1/admin/reviews/*` | `ROLE_REQUIRED` |
| AC-06b | user with existing `owners` row attempts sign-cma | `POST /v1/creator/sign-cma` | `ROLE_CONFLICT_USER_IS_BUYER`; no Signature row created |
| AC-06c | user with existing `creators` row attempts first-purchase MJA capture | first-purchase MJA capture | `ROLE_CONFLICT_USER_IS_CREATOR`; no Signature row created |
| AC-07 | YouTube OAuth + channel with 250k subs | `POST /v1/creator/youtube/verify` | persists `youtube_*` profile fields; sign-cma's YouTube gate now passes (allowlist gate still consulted independently if `CREATOR_ALLOWLIST_ENABLED=true`) |
| AC-08 | YouTube OAuth + channel with 42k subs | `POST /v1/creator/youtube/verify` | `YOUTUBE_INSUFFICIENT_SUBSCRIBERS`; no `youtube_*` fields persisted; sign-cma's YouTube gate still fails |
| AC-08b | YouTube OAuth + 250k subs + 2 uploads in last 180 days + `YOUTUBE_DORMANCY_ENABLED=true` | `POST /v1/creator/youtube/verify` | `YOUTUBE_DORMANT_CHANNEL`; no `youtube_*` fields persisted |
| AC-08c | YouTube OAuth + 250k subs + 8 uploads in last 180 days + `YOUTUBE_DORMANCY_ENABLED=true` | `POST /v1/creator/youtube/verify` | pass; `youtube_*` fields persisted |
| AC-08d | YouTube OAuth + 250k subs + 0 uploads ever + `YOUTUBE_DORMANCY_ENABLED=false` (MVP default) | `POST /v1/creator/youtube/verify` | pass; dormancy gate skipped entirely; `recent_upload_count=0` returned |
| AC-09 | YouTube OAuth + channel with hidden sub count | `POST /v1/creator/youtube/verify` | `YOUTUBE_HIDDEN_SUBSCRIBERS`; remediation message asks creator to unhide and retry |
| AC-10 | OAuth code revoked / channels.list 401 | `POST /v1/creator/youtube/verify` | `YOUTUBE_OAUTH_FAILED` |
| AC-11 | Google account with no YouTube channel | `POST /v1/creator/youtube/verify` | `YOUTUBE_NO_CHANNEL` |
| AC-12 | post-onboarding subscriber count drops below 100k | any creator route | no effect; profile fields are a frozen onboarding snapshot (OI-07) |
| AC-13 | second creator OAuth-verifies a channel already bound to user A | `POST /v1/creator/youtube/verify` on user B | `YOUTUBE_CHANNEL_ALREADY_CLAIMED`; no `youtube_*` fields persisted for user B; user A's binding unaffected |
| AC-14 | same creator re-runs the verify flow after a prior pass | `POST /v1/creator/youtube/verify` | `ALREADY_VERIFIED` (409); no token exchange, no API call, no DB write -- short-circuit at the entry gate |

## 2. Functional Requirements

### 2.1 Identity Providers
**User login** at MVP is Magic SDK with Google + Apple backends (R71 §2.1, §2.4), covering both creator and buyer authentication uniformly. No password, no email verification.

**Creator channel-ownership verification via YouTube OAuth** is active at MVP for the self-signup path (§2.8). The creator runs Google OAuth with the `youtube.readonly` scope after Magic login and before sign-cma; the YouTube Data API gates onboarding on `subscriberCount >= 100_000`. The allowlist (§2.4) is a separate launch-phase gate that composes with the YouTube gate.

### 2.2 DID Token Verification
Per request: `magic.token.validate(didToken)` then `magic.token.getIssuer(didToken)` -> resolves `users.magic_did` (R71 §3.3 Magic). Failure short-circuits with `MAGIC_DID_INVALID`.

### 2.3 Role Model (Row-Existence)

| Role | Grant |
|---|---|
| creator | `creators` row exists (created by esign after CMA per INV-2) |
| owner | `owners` row exists (created by esign after MJA per INV-2) |
| moderator | MVP: env-config `FOUNDER_MAGIC_DID` matches; see OI-01 |

**MVP single-role exclusivity.** A `users` row carries at most ONE of `creator` or `owner` at MVP. Once sign-cma succeeds and the `creators` row exists, that user cannot complete a first purchase (MJA capture blocked). Once a user signs MJA and the `owners` row exists, they cannot sign-cma. The schema does not enforce this -- two FK-independent tables would allow both -- the constraint is enforced at the role-grant entry points:

- **sign-cma**: rejects with `ROLE_CONFLICT_USER_IS_BUYER` if any `owners` row exists for this user_id.
- **first-purchase MJA capture**: rejects with `ROLE_CONFLICT_USER_IS_CREATOR` if any `creators` row exists for this user_id.

Both checks fire before the respective ESIGN signature is captured, so no orphan Signature rows are created on rejection. **Dual-role support is a planned future feature** -- the schema already permits concurrent rows; only the entry-point guards block it. Removing the guards re-enables dual-role; see OI-04b for design decisions to make at that point.

### 2.4 Creator Allowlist (launch-phase gate)

Binary toggle controlling whether sign-cma requires an explicitly-listed email. Configured via env vars; no DB table.

| Env var | Role |
|---|---|
| `CREATOR_ALLOWLIST_ENABLED` | `true` blocks sign-cma unless the user's email is in `CREATOR_ALLOWLIST_EMAILS`. `false` (default post-launch): the gate is inert and `assertCreatorAllowlisted` is a no-op. |
| `CREATOR_ALLOWLIST_EMAILS` | Comma-separated email list. Consulted only when `CREATOR_ALLOWLIST_ENABLED=true`. Whitespace and case are normalized before comparison. |

**Composition with the YouTube gate**: sign-cma authorization is the AND of the two independent gates -- allowlist (this section) and YouTube eligibility (§2.8). Either or both can be enabled; sign-cma succeeds when every enabled gate passes:

```
sign-cma allowed if:
    (NOT CREATOR_ALLOWLIST_ENABLED OR email in CREATOR_ALLOWLIST_EMAILS)
    AND
    (NOT CREATOR_YOUTUBE_GATE_ENABLED OR users.youtube_verified_at IS NOT NULL)
```

**Launch trajectory**:

| Phase | `CREATOR_ALLOWLIST_ENABLED` | YouTube gate | Net authorization |
|---|---|---|---|
| Early closed beta | `true` | off | Email must be in the env-config list; founder vets out-of-band |
| Public launch | `false` | on | YouTube eligibility (`subscriberCount >= 100k`) is the gate |
| Future | `false` | off | Open to any Magic-authenticated account |

### 2.5 Session Endpoints
- `POST /v1/auth/session` (R71 §3.7 row 1): create or fetch `users` row; return profile.
- `DELETE /v1/auth/session` (row 2): clear server-side cached profile (sessions are token-stateless).
- `GET /v1/me` (row 3): current profile + derived `roles` flags.

### 2.6 Wallet Provisioning Trigger
On CMA capture (creators) and MJA capture (buyers), invoke Magic's silent wallet provisioning; write the returned `publicAddress` to `users.wallet_address`. Re-auth recovers the same wallet deterministically. The wallet primitive is Registry-owned per INV-4; identity is the trigger only.

**Sequencing constraint for ESIGN.** Per [esign.md](esign.md), each signature is recorded as a Solana transaction co-signed by the user's wallet, with a Memo carrying the `legal_binder_uri` from [legal_binder.md](legal_binder.md). The wallet must therefore be provisioned **before** the first ESIGN capture for any user. At sign-cma this means: provisioning runs inline, the dispatcher waits for `magic.user.getInfo().wallets.solana.publicAddress` to resolve, then builds the CMA Solana tx with that pubkey as the required signer. Subsequent captures (ISA per-image, MJA at first purchase, LICENSE per-image) read `users.wallet_address` directly.

### 2.6.1 Recovery Key Retrieval
The wallet's private key is held by Magic (DKMS), never by Epimage -- INV-02 by construction. Users are pointed to a static instructions page at `/recovery-key` ([`src/ui/RecoveryKey.tsx`](../../src/ui/RecoveryKey.tsx)) that explains the flow and renders one button that opens Magic's per-app hosted portal in a new tab (`VITE_MAGIC_PORTAL_URL`, e.g. `https://reveal.magic.link/epimage`). The user re-auths there with the same email they used at Epimage sign-in, then follows Magic's reveal flow. The `magic.link` address bar in the new tab is the trust anchor -- no iframe.

The same recovery-key URL is linked from three transactional emails ([`src/cert/email_templates.ts`](../../src/cert/email_templates.ts)): the CMA welcome (creator onboarding), the MJA welcome (buyer onboarding), and the COA at-mint (post-purchase). The link text is identical across all three so users see the same message at every touchpoint.

Onboarding does NOT ask users to download or save the key at signup -- it surfaces only the retrieval path, on the principle that users can act on it any time and shouldn't have to manage a downloaded HTML/PDF doc up-front. The client-side "embed-the-key-in-an-HTML-doc" flow discussed during early architecture (R72 deadman-switch context) is NOT implemented at MVP; Magic's hosted portal is the single retrieval surface.

### 2.7 Creator Profile Capture (at sign-cma)
`POST /v1/creator/sign-cma` (R71 §3.7 row 4) creates the `creators` row in the same transaction as the CMA `signatures` row (esign). Required profile fields combine R71 §2.1 step 2 + R62 §3.1 (creator-account display fields; image-page rendering per R62 §4.3 depends on these):

| Field | Type | Source | Notes |
|---|---|---|---|
| legal_name | string | R71 §2.1 step 2 | CMA counterparty; embedded in the rendered CMA text |
| legal_address | JSON | R71 §2.1 step 2 | service of process; standard contract practice |
| entity_type | enum | R71 §2.1 step 2 | `individual` \| `llc` \| `corp`; counterparty type and 1099 classification context |
| display_name | string | auto-defaulted at sign-cma to `youtube_channel_handle` (with leading `@` stripped); creator edits to a real public name on `/creator/profile` post-onboarding | public artist credit on image-page framing chrome (R62 §4.3). Not in the CMA `document_version_hash` (profile field, not signing artifact). `checkProfileForListing` gates first listing on a non-empty value, so the creator MUST edit before going live. Editable post-onboarding |
| youtube_channel_handle | string | YouTube Data API at §2.8 verification | OAuth-derived from the verified channel (`snippet.customUrl` -> handle); not creator-typed. `creator_channel_url` for R62 §4.3 creator-presence block is derived as `https://youtube.com/${handle}`. Read-only post-onboarding (changing it would invalidate the verified-channel binding; see OI-08) |
| youtube_channel_id | string | YouTube Data API at §2.8 verification | YouTube's stable `UC`-prefix channel identifier. Survives handle changes; the durable anchor for re-verification or audit. Never user-typed |
| youtube_subscriber_count_at_onboarding | int | YouTube Data API at §2.8 verification | Snapshot of `statistics.subscriberCount` at verify time. Frozen; not refreshed post-onboarding (OI-07) |
| youtube_verified_at | datetime | §2.8 verification timestamp | UTC instant of OAuth + threshold pass |
| creator_headshot | Image (square, 512×512 min) | R62 §3.1 | required upload; persisted via storage subsystem; surfaces in image-page creator-presence block (R62 §4.3) and on the (post-MVP) Creator Page hero |
| creator_bio | text (80-800 chars) | R62 §3.1 | required at onboarding; first-person "about me" voice (distinct from the per-image `description` captured at Card 3 List, which is per-work voice) |

`creators.stripe_connect_account_id` is NULL at MVP launch and populated when the creator completes Stripe Connect Express onboarding (immediate post-launch buildout per R71 §2.1; tax ID, bank, and 1099 live on Stripe's side, not duplicated here). Standard `created_at` / `updated_at` are managed by Prisma.

Profile fields are creator-editable post-onboarding with immediate propagation across all of the creator's Gallery surfaces (R62 §3.1).

### 2.8 YouTube OAuth + Eligibility Gate
Active at MVP for the self-signup creator path. Runs after Magic email login (§2.5) and before sign-cma (§2.7). On pass, persists `youtube_*` profile fields. The allowlist gate (§2.4) is checked independently; both must pass when both are enabled.

#### 2.8.1 Thresholds
Two independent gates. The subscriber gate is on at MVP; the activity gate is implemented but feature-flagged off at MVP and activated for production via the go-live checklist.

| Gate | Threshold | MVP default | Override env var |
|---|---|---|---|
| Subscriber count | `statistics.subscriberCount >= 100_000` (YouTube Silver Creator Award tier) | ON | `YOUTUBE_SUBSCRIBER_THRESHOLD` |
| Activity / non-dormant | At least 6 public uploads in the last 180 days | **OFF** (set `YOUTUBE_DORMANCY_ENABLED=true` to activate; see go-live checklist §4.5) | `YOUTUBE_DORMANCY_ENABLED`, `YOUTUBE_DORMANCY_MIN_UPLOADS`, `YOUTUBE_DORMANCY_LOOKBACK_DAYS` |

Single-shot at onboarding; not re-checked at any later point (OI-07 covers post-onboarding drift; current behavior is no effect).

#### 2.8.2 Flow

| Step | Action |
|---|---|
| 1 | Client redirects to Google OAuth with scope `https://www.googleapis.com/auth/youtube.readonly` and a state token bound to the Magic session |
| 2 | Google returns an authorization code to `POST /v1/creator/youtube/verify` |
| 3 | Server exchanges code for an access token (Google's `oauth2.googleapis.com/token`) |
| 4 | Server calls `GET https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true` with the access token |
| 5 | Server reads `items[0].statistics.{subscriberCount, hiddenSubscriberCount}`, `items[0].snippet.customUrl`, `items[0].id`, `items[0].contentDetails.relatedPlaylists.uploads` |
| 6 | Apply gates in order: presence of `items[0]` (else `YOUTUBE_NO_CHANNEL`); `hiddenSubscriberCount==true` (else `YOUTUBE_HIDDEN_SUBSCRIBERS`); `subscriberCount >= 100_000` (else `YOUTUBE_INSUFFICIENT_SUBSCRIBERS`) |
| 7 | **If `YOUTUBE_DORMANCY_ENABLED`** -- Server walks the uploads playlist newest-first via `playlistItems.list?playlistId=<uploads>&part=snippet&maxResults=50`, counts items with `publishedAt` inside the lookback window. Stops on min hit (pass) or first out-of-window item (fail -- list is sorted newest-first). Capped at 2 pages (100 items) to bound API spend. If the flag is off, the call is skipped entirely (saves quota + latency) and `recent_upload_count = 0` is returned |
| 8 | **If `YOUTUBE_DORMANCY_ENABLED`** -- Apply dormancy gate: `recent_upload_count >= 6` (else `YOUTUBE_DORMANT_CHANNEL`) |
| 9 | On pass: persist `youtube_channel_id`, `youtube_channel_handle` (derived from `snippet.customUrl`, see §2.8.3), `youtube_subscriber_count_at_onboarding`, `youtube_verified_at` on the pending-creator row |
| 10 | Access token is discarded immediately (no refresh token requested -- single-shot use) |

**Quota cost**: 1 unit for `channels.list` (always); +1 unit per page of `playlistItems.list` (max 2 pages, only when `YOUTUBE_DORMANCY_ENABLED`). At MVP default (dormancy off), 10,000 verifications/day fit in the default quota; with dormancy on, ~3,300 worst-case before a quota bump request to Google.

#### 2.8.3 Handle Derivation
`snippet.customUrl` is the canonical handle source. Per YouTube convention it starts with `@` (e.g. `@samakar`); we persist it exactly as returned, including the leading `@`, to match the existing DB convention (server.ts URL routing strips `@` for the `/c/<handle>` path).

#### 2.8.4 Token Storage
The OAuth access token is used in-request and discarded. No refresh token is stored; the verify operation is one-shot. Storing the refresh token would let us re-poll subscriber count, which is OI-07 territory and explicitly out of scope at MVP.

#### 2.8.4b Channel Uniqueness Across the Platform
One YouTube channel = one Epimage account. Enforced by `User.youtube_channel_id @unique` at the DB layer (migration `20260603150000_youtube_oauth_fields`). The verify endpoint catches the unique-violation in a try/catch and surfaces it cleanly as `YOUTUBE_CHANNEL_ALREADY_CLAIMED` (HTTP 409) rather than a 500. Two scenarios this guards against:

| Scenario | Outcome |
|---|---|
| Same channel, different Epimage emails (creator forgot which Magic email they used; tries to re-verify under a new one) | New row blocked; creator must use the original Magic email |
| Channel-owner dispute (channel ownership transferred on YouTube side, both parties try to claim) | First-write-wins on `channel_id`; resolution path is operational (founder clears the prior binding off-band; the new owner re-runs YouTube verification), not automatic |

The `channel_id` (not `channel_handle`) is the uniqueness key because the handle can change on YouTube; the `UC`-prefix channel id cannot. Handle changes are tracked separately under OI-08.

#### 2.8.5 Email Decoupling (Non-Requirement)
The YouTube OAuth does NOT request `userinfo.email` and the platform never reads or stores the email of the Google account that owns the YouTube channel. The Magic-OAuth email (captured at §2.5 session creation) is the canonical email for every platform-facing purpose: support, sales notifications, takedown notices, and the ESIGN audit trail row on `signatures`. ESIGN binding is to `creators.legal_name` + Magic-verified email at signing time -- not to the Google account that owns the YouTube channel. Creators with separate personal-vs-channel Google accounts are explicitly supported; the two emails can diverge with no effect on platform identity, contracts, or comms routing.

#### 2.8.6 Google OAuth Configuration
Production Google Cloud project must list `youtube.readonly` (and ONLY that scope) in the OAuth consent screen scopes. The Magic Dedicated Wallet OAuth setup (BYO Auth) and the YouTube OAuth share the same Google Cloud project; configure separate OAuth client IDs to keep redirect-URI lists isolated (Magic's callback vs `/v1/creator/youtube/verify`).

## 3. Architecture

Two identity providers, composed orthogonally. Magic SDK (R71 §3.2) carries the platform-wide login surface for both creators and buyers via Google + Apple OAuth. YouTube Data API + Google OAuth (`youtube.readonly` scope) carries the creator-eligibility gate (channel ownership + `subscriberCount >= 100_000`). Magic owns "who is this user"; YouTube owns "is this user an eligible creator." A user's Magic identity persists across sessions; YouTube verification is a one-time gate that stamps `users.youtube_verified_at` on success and is never re-run.

Row-existence role model (no RBAC table). Roles are encoded by the presence of rows in dedicated tables: `creators` row = creator; `owners` row = buyer/owner; founder/moderator = env-config DID match (`FOUNDER_MAGIC_DID`). This collapses the auth-check at every route to a foreign-key existence check (sub-ms). MVP single-role exclusivity: a `users` row may carry at most ONE of `creators` or `owners`. Enforcement is at the role-grant entry points (sign-cma / first-purchase MJA), not at the schema -- removing the entry-point guards re-enables dual-role without migration.

Wallet provisioning is silent and idempotent. Magic creates the wallet under the hood on first successful OAuth completion; no per-user click is required. The trigger lives in the session-bootstrap path: post-Magic-login, the server checks `users.wallet_address` and -- if null -- calls Magic admin to derive the wallet address from the DID and persists it. Subsequent logins are no-ops. INV-02 holds because Magic holds the private key on the user's device-bound vault; the platform never sees it.

ESIGN-precedes-role-row ordering (INV-02 in identity scope). A `creators` row exists only AFTER successful CMA signature capture; an `owners` row exists only AFTER successful MJA capture. This means role membership is always backed by a legally-binding consent record. The `esign` subsystem is the only caller authorized to insert into `creators` or `owners`; identity routes never INSERT into those tables directly.

Session is stateless. The DID token (returned by Magic SDK) is verified per-request via `magic.token.validate` + `magic.token.getIssuer`. No server-side session store. Verification is sub-50ms p95 (cached Magic DID issuer keys). Failure short-circuits with `MAGIC_DID_INVALID` before any business logic runs.

YouTube verification, conversely, IS persisted. The OAuth callback receives an access token, calls `channels.list` for the authenticated user's own channels, asserts `subscriberCount >= 100_000`, and writes `users.youtube_channel_id` + `youtube_verified_at`. The access token is discarded after the gate check -- no long-lived YouTube credential is retained. Subsequent channel-data reads (for `creator_snapshot` at mint time) use the platform's separate server-side API key, not the creator's OAuth.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| DID verification latency | <= 50 ms p95 |
| Sessions | token-stateless; no server-side store |
| Audit | every failure logged via Pino with token hash + reason |
| Wallet provisioning | idempotent; never re-creates an existing wallet |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `magic-sdk`, `@magic-sdk/admin` (R71 §3.2) | client OAuth + server DID verification |
| `users`, `creators`, `owners` (Prisma) | identity + role grants |
| `CREATOR_ALLOWLIST_ENABLED`, `CREATOR_ALLOWLIST_EMAILS` (env) | launch-phase allowlist gate per §2.4 |
| esign | role-granting signatures (CMA, MJA) precede role-row creation per INV-2 |
| storage (TBD) | `creator_headshot` upload + persistence (R62 §3.1) |
| Google OAuth 2.0 + YouTube Data API v3 (`channels.list`) | §2.8 channel-ownership + subscriber-count gate |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Moderator role storage: env-config `FOUNDER_MAGIC_DID` at MVP. MMP delegation needs a `users.role` column or a `moderators` table; mirrors moderation OI-05 |
| OI-02 | DID verification cache: every request hits Magic. If latency dominates, a ~60s token-hash cache is the standard mitigation -- not at MVP |
| OI-03 | Logout: token stays valid until Magic-side expiry; explicit revocation would require Magic's `logoutByPublicAddress` |
| OI-04 | Founder updating `CREATOR_ALLOWLIST_EMAILS` after a creator's email is removed: existing `creators` row stays valid (the allowlist is a sign-cma gate, not an ongoing entitlement). Revocation of an existing creator's privileges is a separate concern; intended behavior TBD. |
| OI-04b | **Dual-role support is a planned future feature.** §2.3 currently blocks the second role grant at MVP. When dual-role lands, the two `ROLE_CONFLICT_*` checks in §1.3 are removed; the schema already supports concurrent rows. Open design choices for that future work: (a) does sign-cma-as-existing-buyer require any extra evidence (e.g. a separate "intent to create" attestation)?; (b) does first-purchase-as-existing-creator skip the buyer-onboarding email since the same person already received CMA onboarding?; (c) UI changes to clearly surface both role statuses on the profile page. |
| OI-06 | R71 §3.6 `creators` schema does not yet carry `creator_headshot` or `creator_bio` columns (R62 §3.1 specifies them as required MVP fields). Treated as MVP scope here per the UI-follows-R62 decision; pending R71 schema propagation. `creator_channel_url` is derived at render time from `youtube_channel_handle` and needs no separate column. R71 §3.6 schema also pending propagation for the §2.8 fields: `youtube_channel_id`, `youtube_subscriber_count_at_onboarding`, `youtube_verified_at` |
| OI-07 | Post-onboarding subscriber-count drift: current behavior is no effect -- a creator who falls below 100k retains full privileges. If product later wants re-verification (quarterly, before each new listing, etc.), the change requires storing the refresh token (§2.8.4) and adding a re-check cron + revocation flow for live listings. Out of scope at MVP per AC-12 |
| OI-08 | Handle-change handling: YouTube allows channel handle changes. We bind on `youtube_channel_id` (durable), but `youtube_channel_handle` is the display value rendered everywhere (R62 §4.3) and the `/c/<handle>` URL slug. If the upstream handle changes, our cached value goes stale: image-page links break, `/c/<old-handle>` 404s, the on-chain deed `name` field (`epima.ge/<image_id>` -- independent, unaffected) and the per-deed `external_url` (`epimage.com/<image_id>` -- independent, unaffected) are fine. Reconciliation path is TBD. Manual creator-edit at MVP is acceptable but not implemented (handle is currently read-only post-onboarding per §2.7) |
| OI-09 | Multi-channel creators: a Google account can own multiple YouTube channels. We currently take `items[0]` (the primary channel). Behavior when the OAuth-connected Google account has multiple channels is undefined; channel-picker UI is the natural fix but not at MVP |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| esign | CMA / MJA capture invokes identity.provisionWalletIfMissing post-write |
| R71 §2.1 step 2 | creator profile fields captured at sign-cma |
| R71 §2.1, §2.3, §2.4 | onboarding flows |
| R71 §3.2 (Magic libraries) | magic-sdk + admin SDK |
| R71 §3.3 Magic | DID verification mechanics |
| R71 §3.6 | `users` / `creators` / `owners` tables |
| R71 §3.7 rows 1-3 | session endpoints |
| R71 §3.7 row 4 | sign-cma endpoint (creator profile capture orchestration) |
| R62 §3.1 | creator-account display fields (`creator_headshot`, `creator_bio`, `creator_channel_url`) -- canonical at MVP per UI-follows-R62 decision |
| R62 §4.3 | image-page creator-presence block + Creator Page hero -- consumes the §3.1 fields |
| Constitution INV-2 | ESIGN precedes role-row creation |
| Constitution INV-4 | wallet Registry-owned; identity is trigger only |
| email.md | downstream: `onboarding_creator` template fires post-sign-cma carrying executed CMA PDF (R62 §3.5); `onboarding_buyer` fires post-MJA. Spec'd, deferred to post-MVP per R71 §1.2. Both onboarding templates + `coa_at_mint` carry the §2.6.1 recovery-key link |
| Constitution INV-02 | platform never holds buyer private keys -- enforced by §2.6.1 (Magic-held DKMS, hosted reveal flow) |

---
*Last Updated: 26/06/12 18:00*
