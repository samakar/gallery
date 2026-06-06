# Pre-Journey: Creator Onboarding (Workflow Sequence)

Per-creator workflow that gates a prospective creator from anonymous arrival through CMA execution and wallet provisioning. Ends at the boundary of Card 1 Certify (creator dashboard, ready to upload). Authoritative MVP steps per R71 §2.1.

## 1. Preconditions

| Condition | Source |
|---|---|
| Prospective creator has a Google or Apple account | external |
| Prospective creator owns a YouTube channel with >=100,000 subscribers | external (YouTube Silver Creator Award tier) |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | OAuth sign-in (Google / Apple) via Magic | Web App + Magic SDK | -- | DID token issued client-side | -- |
| 2 | Session creation | `POST /v1/auth/session` (R71 §3.7 row 1) | identity.verifyDidToken | `users` row upserted by `magic_did`; `email`, `oauth_provider` populated; `wallet_address` NULL pending ESIGN | MAGIC_DID_INVALID |
| 3 | Client requests YouTube OAuth URL | `GET /v1/creator/youtube/authorize-url` (R71 §3.7) | identity (URL builder; binds `state` to Magic session) | -- | -- |
| 4 | Client redirects to Google OAuth (`youtube.readonly`); Google returns auth code | Google (external) | -- | -- | -- |
| 5 | YouTube eligibility verify | `POST /v1/creator/youtube/verify` (R71 §3.7) | identity.verifyYoutubeEligibility(user_id, oauth_code) -- exchanges code, calls `channels.list?part=snippet,statistics&mine=true`, applies gates in order (presence -> hidden -> subscriber>=100_000); dormancy sub-gate skipped at MVP per identity.md §2.8.1 (feature-flagged off) | On pass: `creator_allowlist` upsert with `note='youtube_oauth'`; `users.youtube_channel_id`, `users.youtube_channel_handle`, `users.youtube_subscriber_count_at_onboarding`, `users.youtube_verified_at` persisted; access token discarded (no refresh) | YOUTUBE_OAUTH_FAILED / YOUTUBE_NO_CHANNEL / YOUTUBE_HIDDEN_SUBSCRIBERS / YOUTUBE_INSUFFICIENT_SUBSCRIBERS (identity.md §1.3) |
| 6 | Profile capture + CMA sign | `POST /v1/creator/sign-cma` (R71 §3.7 row 4) | identity.assertCreatorAllowlisted(email) -> esign.captureSignature(CMA) | Single transaction: `signatures` row with `document_type='CMA'` + `creators` row created with `legal_name`, `legal_address`, `entity_type`, `display_name`, `creator_headshot`, `creator_bio` (identity.md §2.7); `creator_channel_url` derived at render time from `youtube_channel_handle` | CREATOR_NOT_ALLOWLISTED / ESIGN_DOCUMENT_REQUIRED |
| 7 | Wallet provisioning (post-ESIGN) | Backend (inline at step 6 endpoint) | identity.provisionWalletIfMissing(user_id) -> Magic silent wallet provisioning (Registry-owned per INV-4) | `users.wallet_address` populated (Solana pubkey); idempotent on re-auth | -- |
| 8 | Onboarding complete; creator dashboard renders | Web App | -- | Card 1 Certify entry point (file-select) unlocked | -- |

## 3. State Transitions

`users` row lifecycle within this workflow:

| From | To | Trigger | Step |
|---|---|---|---|
| (none) | row exists; `wallet_address=NULL` | identity.verifyDidToken first-sight | 2 |
| `wallet_address=NULL` | `wallet_address` populated | identity.provisionWalletIfMissing post-CMA | 7 |

`creator_allowlist`:

| From | To | Trigger | Step |
|---|---|---|---|
| (no row for email) | row inserted with `note='youtube_oauth'` | verifyYoutubeEligibility pass | 5 |

`creators` (role grant per identity.md §2.3):

| From | To | Trigger | Step |
|---|---|---|---|
| (no row) | row inserted in same txn as CMA `signatures` row | sign-cma success | 6 |

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 2 (MAGIC_DID_INVALID) | No `users` row; client retries OAuth |
| 5 (YOUTUBE_OAUTH_FAILED) | No allowlist row; no profile fields persisted; creator retries from step 3 |
| 5 (YOUTUBE_NO_CHANNEL) | Same; remediation message: connect a Google account that owns a YouTube channel |
| 5 (YOUTUBE_HIDDEN_SUBSCRIBERS) | Same; remediation: unhide subscriber count on YouTube and retry |
| 5 (YOUTUBE_INSUFFICIENT_SUBSCRIBERS) | Same; hard block -- creator cannot proceed to sign-cma |
| 5 (YOUTUBE_CHANNEL_ALREADY_CLAIMED) | All gates passed but the channel_id is already bound to another `users` row. No allowlist insert; remediation: creator must use the Magic email they used at first verify. Manual founder override path: allowlist insert with `note='manual:channel_transfer'` after off-band verification (identity.md §2.8.4b) |
| 5 (ALREADY_VERIFIED) | This `users` row has already passed YouTube verification; the endpoint short-circuits before token exchange. No-op |
| 6 (CREATOR_NOT_ALLOWLISTED) | Should not occur after step 5 pass; indicates allowlist row absent (race / DB error); retry or escalate |
| 6 (ESIGN failure) | Prisma transaction rolled back; no `creators` row; no `signatures` row; creator retries sign-cma |
| 7 (wallet provisioning failure) | `creators` row + CMA already committed; identity.provisionWalletIfMissing re-runs on next authed call (idempotent on `users.wallet_address`) |

## 5. Subsystems Invoked

| Subsystem | Step |
|---|---|
| identity | 2 (verifyDidToken), 5 (verifyYoutubeEligibility), 6 (assertCreatorAllowlisted), 7 (provisionWalletIfMissing) |
| esign | 6 (CMA capture) |
| storage (TBD) | 6 (`creator_headshot` upload per identity.md §2.7) |
| Registry: wallets | 7 (Magic Solana wallet provisioning per INV-4) |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Multi-channel Google accounts: step 5 takes `items[0]`; channel-picker UI deferred (identity.md OI-09) |
| OI-02 | Post-onboarding subscriber drift: no re-check; frozen snapshot per identity.md §2.8.1 + OI-07 |
| OI-03 | Dormancy gate activation timing: MVP-off per identity.md §2.8.1; production cutover is a flag flip in the go-live checklist §4.5, not a code change |
| OI-04 | Step 6 / step 7 atomicity: wallet provisioning failure leaves `creators` row without `wallet_address`; recovery is the idempotent re-call on next authed route -- acceptable but not transactional |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| identity.md §2.2 | DID token verification mechanics (step 2) |
| identity.md §2.5 | session endpoints (step 2) |
| identity.md §2.6 | wallet provisioning trigger (step 7) |
| identity.md §2.7 | creator profile fields captured at sign-cma (step 6) |
| identity.md §2.8 | YouTube OAuth + eligibility gate (steps 3-5) |
| identity.md §2.8.1 | dormancy sub-gate feature-flagged off at MVP |
| identity.md §2.8.4b | channel-uniqueness guarantee (`User.youtube_channel_id @unique`) |
| identity.md §1.3 | per-step error codes |
| R71 §2.1 | Creator Onboarding (authoritative MVP spec) |
| R71 §3.7 | endpoint contracts (`/v1/auth/session`, `/v1/creator/youtube/authorize-url`, `/v1/creator/youtube/verify`, `/v1/creator/sign-cma`) |
| Constitution INV-2 | ESIGN precedes role-row creation (CMA precedes `creators` row) |
| Constitution INV-4 | wallet Registry-owned; identity is trigger only |
| Go-live checklist §4.5 | dormancy-gate activation (`YOUTUBE_DORMANCY_ENABLED=true`) for production cutover |
| certify_wsd.md | downstream workflow -- consumes the post-onboarding `creators` row + wallet as preconditions |

---
*Last Updated: 26/06/04 13:00*
