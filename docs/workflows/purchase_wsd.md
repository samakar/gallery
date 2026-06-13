# Card 4: Purchase (Workflow Sequence)

Per-asset workflow that takes a buyer from anonymous image-page visit through deed-mint confirmation. First-purchase flow runs inline onboarding (OAuth, MJA + License Acceptance ESIGN, silent wallet provisioning) embedded in the buy click; returning-buyer flow skips onboarding. Per [ADR-0001](../adr/adr_0001_buyer_triggered_build.md), the webhook only transitions `purchases.status='paid'`; the buyer's monogram POST drives the async build. Per [ADR-0002](../adr/adr_0002_monogram_as_metadata.md), monogram is persisted as metadata before the build spawns. Authoritative MVP steps per R71 §2.4.

## 1. Preconditions

| Condition | Source |
|---|---|
| Image is `live` and unsold | `images.status='live'`; no `purchases` row in `confirmed` state for this image |
| Image is publicly visible | `images.visibility='public'` (pre-sale default) |
| Buyer's session authenticated by end of step 3 | identity.verifyDidToken |
| Wallet provisioned by end of step 4 | `users.wallet_address` non-null (required for Solana-tx ESIGN at step 5 per esign.md §2.8) |
| Owner role grant exists by end of step 5 | `owners` row created on MJA capture |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | Anonymous arrival via shared link | Web App | -- | Image page renders Listing preview + "Own this" CTA per R62 §4.3 | -- |
| 2 | Click "Own this" | Web App | -- | Triggers inline onboarding for new buyer; returning buyer jumps to step 6 | -- |
| 3 | OAuth sign-in (Google / Apple) | Magic SDK | identity.verifyDidToken (post-callback) | `users` row upserted by `magic_did` | MAGIC_DID_INVALID |
| 4 | Silent wallet provisioning (pre-ESIGN per esign.md §2.8) | Magic | identity.provisionWalletIfMissing | `users.wallet_address` populated via Registry's wallets subsystem (INV-4). Required before MJA capture so the Solana-tx ESIGN can be co-signed by the user's wallet. | WALLET_PROVISION_FAILED (retry on next authed call) |
| 5 | Bundled MJA + SAL ESIGN (Solana-tx ESIGN per esign.md §2.8 -- user's wallet co-signs the Memo tx) | `POST /v1/signatures` (one call per document_type per esign.md §2.10) | esign.captureSignature(MJA) + esign.captureSignature(SAL) | 2 `signatures` rows; `owners` row created on MJA capture; single-role exclusivity enforced (no `creators` row for this user_id; rejects `ROLE_CONFLICT_USER_IS_CREATOR`). SAL replaces the legacy LICENSE_ACCEPTANCE per the architectural commitment in [/docs/r62_r71_alignment.md](../r62_r71_alignment.md). **Precondition**: `users.wallet_address NOT NULL` (set at step 4). | WALLET_REQUIRED / ESIGN_DOCUMENT_REQUIRED / ROLE_CONFLICT_USER_IS_CREATOR |
| 6 | Enter card via Stripe Embedded Checkout | Stripe (UI) | `POST /v1/purchases` → payments.initCheckout | `purchases` row with `status='started'`; Stripe Checkout Session created; client_secret returned | -- |
| 7 | Stripe processes payment | Stripe (external) | -- | -- | STRIPE_PAYMENT_FAILED |
| 8 | Payment success webhook | Stripe → Backend | payments.handleStripeWebhook(`payment_intent.succeeded`) | `purchases.status='paid'`; 90/10 net split persisted. **Does NOT spawn runImageOps** (ADR-0001) | -- |
| 9 | Buyer sees monogram form | Web App | -- | Default initials shown from Checkout Session `billing_details.name` + creator name | -- |
| 10 | Buyer submits monogram | Web App + Backend | `POST /v1/purchases/:id/start-build` → runImageOps owns the route | runImageOps calls metadata.captureMonogram → `purchases.monogram_text` persisted (ADR-0002); spawns runImageOps internal pipeline | MONOGRAM_REQUIRED |
| 11 | Read encrypted Master + Arweave upload | Backend → Arweave | Registry's `arweave_master.buildAndUpload(image_id, buyer_wallet_pubkey)` -- reads ciphertext from `EncryptedMasterStore` (set at Card 1) + reads `images.dek_wrapped` (set at Card 1) + `unwrapDek` + `decryptMaster` (in-memory) + `buildArweaveZip` + Turbo upload | `images.arweave_uri` persisted; `sha256` is read-through from Card 1 (no recompute); `enc_final` returned for mint payload. Byte-identity preserved end-to-end (no Cloudinary round-trip). | ARWEAVE_UPLOAD_FAILED |
| 12 | Share Copy build | Backend + Cloudinary | image_gen.generateShareCopy(image_id, 1, monogram_text) | Cloudinary `public_id` `<image_id>-share-1` exists with monogram + URL-text overlay (R62 §7.6) | VARIANT_BUILD_FAILED |
| 13 | Mint dispatch | Backend → Solana (self-mint per ADR-0008) | Registry's cnft_dispatch(image_id, buyer_wallet_pubkey, enc_final, sha256, ...) | `purchases.status='minting'`; Bubblegum V2 mint tx submitted + awaited synchronously | -- |
| 14 | Mint outcome | Bubblegum V2 → Backend (synchronous) | cnft_dispatch returns `{asset_id}` or throws | On success: post_mint.applyMintSucceeded → `deeds` row inserted; metadata.onMintSucceeded → `images.status='sold'` + `images.visibility='private'`; `purchases.status='confirmed'`. On failure: runImageOps catches, calls payments.refundPurchase | MINT_FAILED |
| 15 | Buyer confirmation | Web App | -- | Buyer polls `GET /v1/purchases/:id`; renders confirmation screen on `status='confirmed'` with receipt + deed details + Collection link | -- |

**Returning-buyer flow**: skip steps 3-5 (session active → wallet already provisioned → MJA already on file in `signatures`). Step 5 becomes a per-image SAL only (`POST /v1/signatures` with `document_type='SAL'` → esign.captureSignature; same Solana-tx ESIGN co-sign by the wallet). Rest of flow identical.

## 3. State Transitions

`purchases.status` (R71 §3.8 purchase lifecycle):

| From | To | Trigger | Step |
|---|---|---|---|
| (none) | started | payments.initCheckout | 6 |
| started | paid | `payment_intent.succeeded` webhook | 8 |
| paid | building | buyer's start-build POST spawns runImageOps (ADR-0001) | 10 |
| building | minting | cnft_dispatch | 13 |
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
| 14 (mint thrown) | cnft_dispatch throws; runImageOps catches and calls payments.refundPurchase; same refund path; no `deeds` row inserted |
| 15 polling | Buyer can close tab; build + mint complete server-side; buyer returns via `/collection` later |

## 5. Subsystems Invoked

| Subsystem | Steps |
|---|---|
| identity | 3 (OAuth), 4 (wallet provisioning trigger) |
| Registry: wallets | 4 (Magic Solana wallet provisioning per INV-4) |
| esign | 5 (bundle MJA + SAL; Solana-tx Memo co-signed by wallet per esign.md §2.8) |
| payments | 6 (initCheckout), 8 (webhook), refund callback on failure |
| metadata | 10 (captureMonogram), 14 (onMintSucceeded) |
| image_gen | 12 (generateShareCopy) -- step 11 no longer calls image_gen; arweave_master reads from EncryptedMasterStore directly |
| EncryptedMasterStore (registry/arweave_master) | 11 (read ciphertext set at Card 1) |
| runImageOps | 10-13 (async orchestrator) |
| Registry: arweave_master | 11 |
| Registry: cnft_dispatch | 13 |
| Registry: post_mint (applyMintSucceeded) | 14 |

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
| image_gen.md | generateShareCopy (step 12). Step 11 no longer depends on image_gen; arweave_master reads encrypted bytes from EncryptedMasterStore. |
| moderation.md | Card 1 precondition -- image becomes `live` only post-moderator-approval |
| Registry: arweave_master (TBD) | step 11 |
| Registry: cnft_dispatch | step 13 |
| Registry: post_mint (applyMintSucceeded) | step 14 |
| Registry: wallets (TBD) | step 5 |
| runImageOps (TBD) | owns steps 10-13 orchestration |
| R71 §2.4 | Buyer purchase flow (authoritative; diverges per ADRs) |
| R71 §3.7 rows 14, 15, 16, 18, 21 | API endpoints used by this flow |
| R71 §3.8 | Purchase + Image + Privacy lifecycles |
| R71 §3.9 | runImageOps + runStripeRefund async patterns |
| R62 §3.1 Card 4 | Reference card |
| R62 §4.3 | Image page composition (Default-public, Buy state, Confirmation state) |
| Constitution INV-2 | ESIGN precedes role-row creation (MJA precedes owner) -- wallet provisioning at step 4 is a precondition for ESIGN (not the entity ESIGN admits), so INV-2 still holds: the role-grant (owners row) is created in the same txn as the MJA signature at step 5 |
| Constitution INV-4 | Wallet primitive Registry-owned; identity is trigger |
| esign.md §2.8 | Solana-tx ESIGN architecture -- the wallet co-signs the MJA / SAL Memo tx, hence wallet provisioning at step 4 precedes ESIGN at step 5 |

---
*Last Updated: 26/06/10 19:00*
