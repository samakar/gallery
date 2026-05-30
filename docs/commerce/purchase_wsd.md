# Card 4: Purchase (Workflow Sequence)

Per-asset workflow that takes a buyer from anonymous image-page visit through deed-mint confirmation. First-purchase flow runs inline onboarding (OAuth, MJA + License Acceptance ESIGN, silent wallet provisioning) embedded in the buy click; returning-buyer flow skips onboarding. Per [ADR-0001](../adr/adr_0001_buyer_triggered_build.md), the webhook only transitions `purchases.status='paid'`; the buyer's monogram POST drives the async build. Per [ADR-0002](../adr/adr_0002_monogram_as_metadata.md), monogram is persisted as metadata before the build spawns. Authoritative MVP steps per R71 §2.4.

## 1. Preconditions

| Condition | Source |
|---|---|
| Image is `live` and unsold | `images.status='live'`; no `purchases` row in `confirmed` state for this image |
| Image is publicly visible | `images.visibility='public'` (pre-sale default) |
| Buyer's session authenticated by end of step 3 | identity.verifyDidToken |
| Owner role grant exists by end of step 4 | `owners` row created post-MJA |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | Anonymous arrival via shared link | Web App | -- | Image page renders Listing preview + "Own this" CTA per R62 §4.3 | -- |
| 2 | Click "Own this" | Web App | -- | Triggers inline onboarding for new buyer; returning buyer jumps to step 6 | -- |
| 3 | OAuth sign-in (Google / Apple) | Magic SDK | identity.verifyDidToken (post-callback) | `users` row upserted by `magic_did` | MAGIC_DID_INVALID |
| 4 | Bundled MJA + License Acceptance ESIGN | Web App + Backend | `POST /v1/buyer/sign-mja` → esign.bundleSign(MJA, LICENSE_ACCEPTANCE) | 2 `signatures` rows under one click event; `owners` row created in same txn | ESIGN_BUNDLE_PARTIAL_FAILURE |
| 5 | Silent wallet provisioning | Magic | identity.provisionWalletIfMissing (post-MJA, INV-2) | `users.wallet_address` populated via Registry's wallets subsystem (INV-4) | (Registry's wallets subsystem call) |
| 6 | Enter card via Stripe Embedded Checkout | Stripe (UI) | `POST /v1/purchases` → payments.initCheckout | `purchases` row with `status='started'`; Stripe Checkout Session created; client_secret returned | -- |
| 7 | Stripe processes payment | Stripe (external) | -- | -- | STRIPE_PAYMENT_FAILED |
| 8 | Payment success webhook | Stripe → Backend | payments.handleStripeWebhook(`payment_intent.succeeded`) | `purchases.status='paid'`; 90/10 net split persisted. **Does NOT spawn runImageOps** (ADR-0001) | -- |
| 9 | Buyer sees monogram form | Web App | -- | Default initials shown from Checkout Session `billing_details.name` + creator name | -- |
| 10 | Buyer submits monogram | Web App + Backend | `POST /v1/purchases/:id/start-build` → runImageOps owns the route | runImageOps calls metadata.captureMonogram → `purchases.monogram_text` persisted (ADR-0002); spawns runImageOps internal pipeline | MONOGRAM_REQUIRED |
| 11 | Decrypt + on-Arweave Master build | Backend → Arweave | Registry's arweave_master(image_id, buyer_wallet_pubkey) -- reads Original via image_gen.decryptOriginal | `images.arweave_uri` + `images.sha256` persisted; `enc_final` returned for mint payload | ARWEAVE_UPLOAD_FAILED |
| 12 | Share Copy build | Backend + Cloudinary | image_gen.generateShareCopy(image_id, 1, monogram_text) | Cloudinary `public_id` `<image_id>-share-1` exists with monogram + URL-text overlay (R62 §7.6) | VARIANT_BUILD_FAILED |
| 13 | Mint dispatch | Backend → Crossmint | Registry's crossmint_dispatch(image_id, buyer_wallet_pubkey, enc_final, sha256, license_signing_event_id) | `purchases.status='minting'`; Crossmint mint job queued | -- |
| 14 | Mint outcome | Crossmint → Backend | Registry's crossmint_webhook(`mint.succeeded` \| `mint.failed`) | On success: `deeds` row inserted; metadata.onMintSucceeded → `images.status='sold'` + `images.visibility='private'`; `purchases.status='confirmed'`. On failure: payments.refundPurchase called | MINT_FAILED |
| 15 | Buyer confirmation | Web App | -- | Buyer polls `GET /v1/purchases/:id`; renders confirmation screen on `status='confirmed'` with receipt + deed details + Collection link | -- |

**Returning-buyer flow**: skip steps 3-5 (session active → identity recovers wallet deterministically; MJA already on file in `signatures`). Step 4 becomes a per-image License Acceptance only (`POST /v1/purchases/:id/sign-license` → esign.captureSignature). Rest of flow identical.

## 3. State Transitions

`purchases.status` (R71 §3.8 purchase lifecycle):

| From | To | Trigger | Step |
|---|---|---|---|
| (none) | started | payments.initCheckout | 6 |
| started | paid | `payment_intent.succeeded` webhook | 8 |
| paid | building | buyer's start-build POST spawns runImageOps (ADR-0001) | 10 |
| building | minting | crossmint_dispatch | 13 |
| minting | confirmed | `mint.succeeded` | 14 |
| started | failed | `payment_intent.payment_failed` | 7 (failure path) |
| building / minting | failed | runImageOps terminal failure OR `mint.failed` | 11/12/14 (failure path) |
| failed | refunded | `charge.refunded` (after `runStripeRefund`) | post-failure |

`images.status`:
- `live → sold` (step 14, metadata.onMintSucceeded)

`images.visibility`:
- `public → private` (step 14, post-mint hook -- Vault mode default per R71 §2.6)

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 3 (OAuth) | Magic error surfaced; buyer retries; no DB state |
| 4 (ESIGN bundle) | Prisma transaction rolled back; both signatures absent; no `owners` row; buyer retries |
| 7 (Stripe failure) | `purchases.status='failed'`; `failure_reason='STRIPE_PAYMENT_FAILED:<decline_code>'`; no refund (no charge captured) |
| 10 (MONOGRAM_REQUIRED) | Validation reject; buyer re-enters; no DB write |
| 11 / 12 (build) | runImageOps terminal: `purchases.status='failed'`; payments.refundPurchase inline; eventual `charge.refunded` → `'refunded'`; no deed minted |
| 14 (mint.failed) | crossmint_webhook calls payments.refundPurchase; same refund path; no `deeds` row inserted |
| 15 polling | Buyer can close tab; build + mint complete server-side; buyer returns via `/collection` later |

## 5. Subsystems Invoked

| Subsystem | Steps |
|---|---|
| identity | 3 (OAuth), 5 (wallet provisioning trigger) |
| esign | 4 (bundle MJA + License) |
| payments | 6 (initCheckout), 8 (webhook), refund callback on failure |
| metadata | 10 (captureMonogram), 14 (onMintSucceeded) |
| image_gen | 11 (decryptOriginal -- called by arweave_master), 12 (generateShareCopy) |
| runImageOps | 10-13 (async orchestrator) |
| Registry: wallets | 5 (Magic provisioning) |
| Registry: arweave_master | 11 |
| Registry: crossmint_dispatch | 13 |
| Registry: crossmint_webhook | 14 |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Stale `'paid'` purchases per ADR-0001 -- if buyer closes tab before step 10, `purchases.status` stays at `paid` forever. Grace-period sweeper TBD (mirrors payments OI-08 + metadata OI-05) |
| OI-02 | Confirmation polling vs WebSocket -- MVP uses polling `GET /v1/purchases/:id`. At MMP scale, push-notification surface may be needed |
| OI-03 | Returning-buyer detection logic -- UI checks for `signatures` with `document_type='MJA'` to decide whether to skip step 4. Endpoint/heuristic TBD |
| OI-04 | OAuth pop-up dismissal at step 3 -- buyer can close window mid-flow; UI recovery + retry path |
| OI-05 | Idempotent re-submission of start-build (step 10) -- if buyer re-POSTs with same monogram, should it no-op or spawn again? `metadata.captureMonogram` is last-write-wins; runImageOps spawn should check `purchases.status != 'paid'` to avoid double-spawn |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| **ADR-0001** | Build trigger -- step 8 webhook does NOT spawn runImageOps; step 10 buyer POST does |
| **ADR-0002** | Monogram captureMonogram at step 10 (metadata-persisted) |
| identity.md | OAuth + DID + role + wallet provisioning trigger |
| esign.md | bundle MJA + License Acceptance + per-image License on returning purchase |
| payments.md | initCheckout + webhook + refund |
| metadata.md | captureMonogram + onMintSucceeded + visibility |
| image_gen.md | generateShareCopy (step 12) + decryptOriginal (called by arweave_master step 11) |
| moderation.md | Card 1 precondition -- image becomes `live` only post-moderator-approval |
| Registry: arweave_master (TBD) | step 11 |
| Registry: crossmint_dispatch (TBD) | step 13 |
| Registry: crossmint_webhook (TBD) | step 14 |
| Registry: wallets (TBD) | step 5 |
| runImageOps (TBD) | owns steps 10-13 orchestration |
| R71 §2.4 | Buyer purchase flow (authoritative; diverges per ADRs) |
| R71 §3.7 rows 14, 15, 16, 18, 21 | API endpoints used by this flow |
| R71 §3.8 | Purchase + Image + Privacy lifecycles |
| R71 §3.9 | runImageOps + runStripeRefund async patterns |
| R62 §3.1 Card 4 | Reference card |
| R62 §4.3 | Image page composition (Default-public, Buy state, Confirmation state) |
| Constitution INV-2 | ESIGN precedes role-row creation (MJA precedes owner) |
| Constitution INV-4 | Wallet primitive Registry-owned; identity is trigger |

---
*Last Updated: 05/29/26 16:00*
