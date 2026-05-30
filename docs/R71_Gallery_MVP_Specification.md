# Gallery MVP Specification

## SUMMARY

Gallery MVP validates Elanoid's digital ownership protocol with 10 hand-recruited creators reaching buyers via social links. The MVP implements the three-function architecture specified in R62 §1 (Certification, Commerce, Registry), mapped onto a single-process Node + SQLite stack for the cohort scope. Creators upload a single JPEG (Q90+) within an ingestion window scoped to guarantee an 11x14 inch print and to stay inside the Cloudinary transformation limit (§1.3). Encrypted Masters mint as one-of-one Solana deeds (image is the artifact; deed is the receipt), settle via Stripe with the 90 / 10 split persisted on `purchases` at launch (Connect Express transfers post-launch), and render through Share Copies carrying a per-owner monogram. The image's sealed / opened state (per R62 §3.5.1, recorded as `deed_state`) is `sealed` for every MVP deed since deed-holder Master download is deferred to MMP. The Keepsake Copy variant and Limited / Unlimited edition tiers (R62 §2.2 Commerce, §2.3 Registry) are deferred to MMP; MVP ships only the Master Image (encrypted on-Arweave storage, no deed-holder download at MVP) and the Share Copy (1080px personalized variant, deed-page render and Collection download). Moderation: founder manual review of Tier 0 (CSAM, NCII) and Tier 1 (adult, violence, hate, drugs) via a two-checkbox UI before the creator ESIGN affirmation; Tier 2 items (AI authenticity, right-of-publicity, sole-copy) carried by an expanded creator ESIGN warranty; automated PhotoDNA, Thorn, and Hive integrations deferred to MMP. 30-day measurement targets 100 image sales at $50 average ($5K GMV), ≥40% conversion, zero unrecovered failures; operations run until MMP launch.

---

## 1. SCOPE

The MVP's in-scope feature table is below. Validation goals, behavioral hypotheses, and cohort / operating-window parameters are captured in Appendix B (Validation Context and Cohort).

### 1.1 In-Scope Features

| Feature Area | MVP Inclusion |
|---|---|
| Creator signup via Google / Apple OAuth (no email / password); ESIGN-affirmed Creator Master Agreement (CMA); creator profile capture (display name and primary YouTube channel) | Yes |
| Creator wallet provisioned silently via Magic SDK post-CMA acceptance during onboarding; same wallet recovered deterministically on subsequent sign-ins | Yes |
| Single-file image upload (JPEG only, Q90+; image ingestion window per §1.3: 4200 x 3300 px per-edge floor, 38 MP total-pixel ceiling) | Yes |
| Image-id assigned at ingestion (5-char base-36 lowercase universal handle per R62 §2.3) | Yes |
| Original (the clean source file from creator upload) encrypted at rest with AES-256-GCM (`DEK_image` per file, wrapped to a server-side KEK held in env-secret) and persisted to the application server's local filesystem as canonical workhorse for every variant build | Yes |
| Listing preview composed from the Original at ingestion via Cloudinary; Thumbnail composed at ingestion as aspect-preserving (no AI cropping), unwatermarked, bounded at 500 px long-edge (half the Share Copy's 1080 px width per the public-variant hierarchy) | Yes |
| One-of-one Solana NFT deed mint via Crossmint API; on-Arweave Master built once at Card 5 from the Original, encrypted with the same `DEK_image` used for the Original (single-DEK architecture per R65 §3.14); doubly-nested `enc_final = encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)` added to deed metadata for license-survival per R62 §2.3 Registry; single Arweave upload | Yes |
| Deed-holder Share Copy generation during the purchase flow (§2.4 step 13, before the deed mint): decrypt Original from server-side custody, compose the Share Copy variant, cache | Yes |
| Buyer monogram personalization at purchase: default monogram from the buyer's Stripe billing initials plus the creator name, buyer-overridable with custom text (§2.4 step 9) | Yes |
| Buyer onboarding inline within Buy flow via Google / Apple OAuth (no pre-flight signup, no email / password); ESIGN-affirmed Master Joint Agreement (MJA) bundled with first License Acceptance | Yes |
| Buyer wallet provisioned silently via Magic SDK post-MJA acceptance during first-purchase inline onboarding; same wallet recovered deterministically on subsequent sign-ins | Yes |
| Buyer purchase via Stripe Embedded Checkout (credit / debit card; PAN vaulted at Stripe, no platform-side card storage; card re-entered on every purchase, saved-card deferred to MMP) | Yes |
| ESIGN click-wrap at checkout: MJA + per-image License Acceptance bundled in one Sign click on first purchase; License Acceptance only on subsequent purchases | Yes |
| Stripe Embedded Checkout buyer payment + 90 / 10 net-amount split persisted on `purchases` and accruing in Elanoid's Stripe balance (creator-side Stripe Connect Express onboarding and automated transfers deferred to MMP) | Yes |
| Public image page with Listing-preview rendering and OG / Twitter Card; render branches on (`images.visibility`, sold-status) per §2.7: pre-sale shows the live listing, post-sale shows the blank `image <image-id> is private` Gallery stub until the owner clicks Share (§2.6), then shows the Share Copy surface | Yes |
| Deed-holder Collection view of cached Share Copy with per-owner monogram | Yes |
| Owner privacy state on owned images: `images.visibility` defaults to `'private'` at deed mint (post-mint hook); one-way owner-triggered flip to `'public'` via the Share action on the Collection card (§2.6); resets to `'private'` on resale (post-MVP). State machine in §3.8 | Yes |
| Owner Share Copy download from Collection at the 1080px social-native format (JPEG; in-pixel URL text and monogram embedded -- monogram default from the buyer's Stripe billing initials, buyer-overridable); Master Image download, Keepsake Copy, buyer-selectable print sizing, and print fulfillment all deferred to MMP | Yes |
| In-pixel URL text on the Share Copy variant rendering the image-id slug (per R67 §5.9; R67 Appendix I); resolves to the public image page | Yes |
| Per-deed shareable URL | Yes |
| Public Report button on every public deed surface; tickets routed to Elanoid for manual handling | Yes |
| Privacy-friendly analytics via Plausible (cookie-free; custom funnel events: image-page visit, Sign In click, Buy click, OAuth completion, purchase complete, Report click); per-creator-per-post attribution via UTM | Yes |

### 1.3 Image Ingestion Window

Gallery accepts a single upload format -> **JPEG at quality 90 or above** -> bounded by a resolution floor, a megapixel ceiling, and an aspect-ratio band. Window derivation is in R62 §6 and R65 §1.5.

| Bound | Parameter | Value | Constraint Type |
|---|---|---|---|
| Floor | Long-edge resolution | ≥ 4200 px | per-edge minimum |
| Floor | Short-edge resolution | ≥ 3300 px | per-edge minimum |
| Ceiling | Total pixels | ≤ 38 MP | total-pixel maximum |
| Format | File type | JPEG only | exact match |
| Format | JPEG quality | Q90+ | estimated minimum |
| Aspect | Longer / shorter edge | 1 to 2 | ratio band |

The accepted window and the per-frame-size fit table are reproduced by the analysis script `r71_ingestion_analysis.py` (`python r71_ingestion_analysis.py window`).

---

## 2. PARTICIPANT WORKFLOWS

### 2.1 Creator Onboarding

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Sign up via Google / Apple OAuth | Magic SDK | OAuth authenticates creator identity; no password, no email verification |
| 2 | Enter creator profile: legal identity and display details | Web App | Captured fields: `legal_name` (CMA counterparty), `legal_address` (service of process), `entity_type` (`individual` \| `llc` \| `corp`), `display_name` (artist credit shown on image pages), `youtube_channel_handle` (channel of record; surfaced on image page); founder manually verifies channel ownership during hand-recruitment (YouTube OAuth verification deferred to self-signup buildout). Legal identity fields are needed before step 3 so they are embedded in the rendered CMA text the creator signs |
| 3 | Accept ToS, Privacy Policy, and Creator Master Agreement | Web App | Click-wrap; the rendered CMA carries the step-2 legal identity (`legal_name`, `legal_address`, `entity_type`) so the document is personalized to the counterparty before signing; document version hashes recorded; ESIGN-compliant |
| 4 | Wallet provisioned silently | Magic SDK | Embedded Solana wallet bound to OAuth identity post-CMA; wallet address persisted to creator profile; deterministically recovered on subsequent sign-ins |
| 5 | Creator lands on Gallery dashboard | Web App | Authenticated dashboard surface; creator can initiate first upload from §2.2 |

Creator recruitment is hand-shepherded by the founder before allowlisting: the founder identifies a 100K+ subscriber creator, validates the creator's profile manually (subscriber count, channel age, content cadence), and inserts the creator's primary email into the `creator_allowlist` table (§3.6). The `POST /v1/creator/sign-cma` endpoint enforces the allowlist as a hard precondition: the authenticated user's OAuth-verified email must match a `creator_allowlist` row, otherwise the call is rejected before any `creators` row is created. Re-use is naturally prevented by the `creators.user_id` UNIQUE constraint; a single allowlist row maps to at most one creator. Creators are continuing counterparties under the CMA with material ongoing liability surface (IP indemnification, right-of-publicity, Sole Copy warranty, payout claw-back on chargebacks), so the `creators` row captures the legal identity (`legal_name`, `legal_address`, `entity_type`) at signing time -> the CMA is a contract between Elanoid and a named counterparty, not between Elanoid and an OAuth email. This asymmetry against `owners` is intentional: owners are one-shot transactional counterparties whose identity is sufficiently anchored by Magic OAuth + Stripe Customer, whereas creators have ongoing CMA obligations that require contract-grade identification. Creator earnings accrue in Elanoid's Stripe balance from first sale; Stripe Connect Express onboarding is an immediate post-launch feature (first post-MVP buildout) enabling automated payouts to the creator's bank account every 4 weeks from the launch date once the creator completes Connect KYC; the first payout lands at the 4-week mark. Tax ID, bank, and 1099 issuance are collected and handled by Stripe at Connect onboarding and are not duplicated on the platform.

### 2.2 Creator Upload and Listing

The creator uploads a high-resolution source file and publishes it as a public image page. The flow covers acceptance gates and the creator ESIGN affirmation; image-id assignment, Original encryption-at-rest, and Listing preview / Thumbnail generation from the Original; and listing metadata, price, and record creation. Deed issuance, the on-Arweave Master build, and Arweave upload occur at purchase, not at upload.

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Sign in on Gallery sign-in page via Google / Apple OAuth | Magic SDK | Skipped if session is active from §2.1; verified creators only; same embedded wallet recovered deterministically on re-auth; no new wallet provisioned |
| 2 | Select image file from Gallery dashboard | Web App | Authenticated creator surface; JPEG only at Q90+ (8-bit per channel, JPEG-inherent); image ingestion window per §1.3: 4200 x 3300 px per-edge floor, 38 MP total-pixel ceiling |
| 3 | Local quality checks | Web App | Instant check against the §1.3 ingestion window, run entirely in the browser before any upload. (1) Format: read the file's first two bytes via the native File API and assert the JPEG SOI marker (`0xFF 0xD8`); `File.type` is extension-derived and spoofable, so the magic-number check is the canonical format gate. (2) SOF + DQT extraction: a single `exifr.parse(file, { sof: true, dqt: true })` pass (per §3.2) returns `ImageWidth` and `ImageHeight` from the mandatory SOF marker and the luminance quantization table from the DQT marker. (3) Dimension and aspect arithmetic on the SOF outputs: long-edge floor (4200 px), short-edge floor (3300 px), total-pixel ceiling (38 MP), aspect ratio band (1 <= longer / shorter <= 2). (4) Quality: a small in-house utility inverts the IJG scaling formula on the luminance QT to derive the libjpeg-equivalent quality factor, asserted >= 90. A file failing any check is rejected and the specific failing parameter is displayed to the creator |
| 4 | Upload to staging storage | Backend | Off-chain, access-controlled; Master not yet on Arweave |
| 5 | Founder manual image review (Tier 0 + Tier 1) | Web App (admin surface) | Image enters the founder review queue. Creator sees "Image submitted for review (typically <24h)"; creator receives email notification on decision. Founder reviews via the two-checkbox UI: (1) Tier 0 clean -> no CSAM, no NCII; (2) Tier 1 clean -> no adult/NSFW, no violence-against-persons, no hate symbols, no drug promotion. Both boxes checked -> Submit approves and the image moves to step 6. Tier 1 unchecked -> creator notified "Tier 1 content violation"; image deleted from staging. Tier 0 unchecked -> creator account locked, image hash + metadata preserved for §2258A reporting (90-day minimum), NCMEC CyberTipline checklist opens (§6.1). Per-checkbox state and timestamp persisted in `image_reviews` as the audit-grade decision record |
| 6 | Creator per-image ESIGN affirmation (Image Signing + Sole Copy combined) | Web App + Backend | Only runs on founder-approved images. Single-image signing screen displays the source file alongside the combined text: "I sign this work as my own original work -> not generated by an AI system except as disclosed, and not the work of any other person. I confirm that I have rights to any identifiable persons depicted, including model releases where required, and that this work has not been previously licensed for sale and is not concurrently listed elsewhere as a singular work. I authorize the platform to mint deeds for this work to verified buyers on my behalf at prices I set, subject to the platform fee schedule and the creator royalty terms I encode in the deed at mint. I commit to destroying my retained source copy after upload as a buyer-trust commitment (Sole Copy Agreement). [Creator Verified Name], [today's date]"; explicit Sign click; click event captured with timestamp, IP, session token, signing_event_id. The expanded text carries the Tier 2 warranty (AI non-generation, right-of-publicity rights, sole-copy commitment) -> Tier 2 enforcement is contractual via this affirmation plus the CMA, not pre-mint operational |
| 7 | Assign image-id; generate DEK_image; encrypt Original at rest server-side | Backend (local FS + env-secret KEK) | Image-id = 5-char base-36 lowercase universal handle (R62 §2.3) assigned at this step and bound to the Original; filename is the image-id. Platform generates `DEK_image` (per-image AES-256 DEK), wraps it to a server-side KEK held in env-secret, persists the wrapped DEK to the `images` row in SQLite. The clean source file from creator upload is the Original; encrypted with `DEK_image` (AES-256-GCM) and written to the local filesystem at `/var/originals/<image-id>.enc`. The same `DEK_image` is reused at Card 5 to encrypt the on-Arweave Master; security rationale in R65 §3.14 Decryption-Key Architecture Rationale. The Original is the canonical workhorse for every variant build across the deed's lifetime |
| 8 | Generate Listing preview and Thumbnail variants from Original | Backend + Cloudinary | Decrypt Original from local FS, push plaintext to Cloudinary; compose Listing preview (scaled to fit within a 1080 x 1080 bounding box preserving the Original's aspect ratio -> always ≤ the shareable Share Copy's dimensions, so the public preview cannot exceed the variant designed for free distribution; creator credit overlay; large horizontal "PREVIEW" text watermark at ~30% opacity, aligned to the bottom edge with a small breathing offset, spanning roughly 60% of the image width) and Thumbnail (aspect-preserving, unwatermarked, bounded at 500 px long-edge -> half the Share Copy width per the public-variant hierarchy Thumbnail < Share Copy < Master; discovery surfaces render via CSS `object-fit: contain` within a common square bounding box per R62 §1). The Listing preview and Thumbnail are public-circulation variants delivered through the CDN per R62 §7.4 -> not on-chain-anchored; verification of these candidates routes through the off-chain image match engine (R62 §6.2, post-MVP), and the Thumbnail is also the canonical anchor for post-MVP pHash verification |
| 9 | Enter listing metadata and fixed price; submit to create public listing | Web App + Backend | User-facing form captures title, description, creation date, and fixed price (within $20 - $2,000 platform range); on submit, backend creates image record (creator reference, staging URL, content hash, signing_event_id, Cloudinary preview URLs; deed address null); image becomes live as public image page displaying Listing preview and 'Creator-signed [date]' provenance; purchasable |

### 2.3 Buyer Onboarding

There is no standalone buyer onboarding flow. The buyer arrives at an image page anonymously via a creator-shared social link and onboards inline within the Buy flow on first purchase (§2.4). No pre-flight signup surface, no separate identity verification step.

Buyer KYC is not required at the MVP since secondary market is out of scope; identity at purchase is anchored by credit-card verification at Stripe plus wallet existence.

### 2.4 Buyer Purchase

The buyer arrives at the image page anonymously via a creator-shared social link and completes the purchase journey. The first-purchase flow runs inline onboarding (OAuth, MJA + License Acceptance, silent wallet provisioning), payment with revenue distribution, monogram personalization, the image operations that build the on-Arweave Master and the Share Copy, and -> once those operations complete -> deed issuance to the buyer wallet. The returning-buyer flow skips onboarding.

**First-purchase flow (new buyer; inline onboarding):**

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Discover image page anonymously | Web App | Via creator-shared social link; no auth required to view |
| 2 | Click "Buy" on image page | Web App | Triggers inline onboarding for new buyer |
| 3 | OAuth sign-in via Google / Apple | Magic SDK | OAuth authenticates buyer identity; no password, no email verification |
| 4 | Bundled MJA + per-image License Acceptance ESIGN click-wrap | Web App + Backend | Single Sign click captures both documents under one signing_event_id; MJA terms (ToS, dispute resolution, RUFADAA posture, no-reliance Howey defense, baseline warranty disclaimers) plus per-image license terms (field of use, territory, term, commercial-use permission, sublicensing, derivative-work rights, display permissions) displayed above Sign; both document version hashes, timestamp, IP, session token persisted; MJA fires first purchase only |
| 5 | Wallet provisioned silently | Magic SDK | Embedded Solana wallet bound to OAuth identity post-MJA; wallet address persisted to `users.wallet_address`; deterministically recovered on subsequent sign-ins |
| 6 | Enter card via Stripe Embedded Checkout | Stripe | Credit / debit; CVV, AVS, 3D Secure; fingerprint uniqueness check; Stripe Radar applies OFAC and SDN screening at payment-instrument level |
| 7 | Payment authorized | Stripe Webhook | payment_intent.succeeded fires |
| 8 | Persist Stripe customer handle | Backend | Stripe customer ID saved to the `owners` row (created at step 4 alongside the MJA grant). Billing name and address remain in Stripe's Customer object and are not duplicated on the platform; the monogram default at step 9 is derived live from the Checkout Session's `billing_details.name`. Card vaulted at Stripe (PAN never on platform) |
| 9 | Monogram personalization | Web App + Backend | The buyer is shown the Share Copy monogram with the default initials derived live from the current Checkout Session's `billing_details.name` (no platform-stored seed), plus the creator name, rendered per the R62 §2.2 monogram typography (restrained gallery-register typeface and color treatment; human-readability and aesthetics optimized, outside the §7.6 URL-text OCR contract). The buyer may keep the default or override it with custom text; the chosen monogram is captured in `purchases.monogram_text` for the Share Copy build at step 13. Full artist credit is retained regardless of the monogram choice |
| 10 | Revenue distribution | Backend ledger (Stripe Connect post-launch) | The 90 / 10 split is computed net of the Stripe processing fee: 90% accrues to the creator and 10% to Elanoid, held in Elanoid's Stripe balance at MVP launch; Connect Express transfers activate immediate post-launch |
| 11 | Build on-Arweave Master from Original | Backend (AES-256 + asymmetric key wrap) | Decrypt Original from local FS using `DEK_image` (env-secret KEK unwrap of platform-KEK wrap). Compute `sha256(canonical_pixels)` of the Master and hold it for the deed-mint metadata (step 14). Encrypt the working copy with the SAME `DEK_image` used at Card 2 for the Original. Construct the doubly-nested deed-metadata ciphertext per R62 §2.3 Registry: inner = `encrypt(DEK_image, buyer_wallet_pubkey)`; outer = `encrypt(inner, platform_DEK)` where `platform_DEK` is the same env-secret platform KEK that wraps `DEK_image` for the operational copy. The resulting `enc_final = encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)` travels with the deed (step 14) and enables per-owner post-cessation self-decryption after the trustee publishes `platform_DEK`. The operational platform-KEK wrap of `DEK_image` in SQLite is unchanged. Single-DEK rationale in R65 §3.14. The Original is unchanged and remains in local-FS custody as the canonical workhorse for every future variant build |
| 12 | Upload encrypted Master to Arweave | @ardrive/turbo-sdk (Turbo bundler) | Pay-once permanent storage via the ArDrive Turbo bundler (managed paid Arweave provider; FIAT credit-card top-up so Elanoid does not hold AR tokens); Arweave transaction ID (URI) returned; single Arweave upload per image |
| 13 | Generate Share Copy share variant from Original | Backend / Cloudinary | Decrypt Original from local FS, push plaintext to Cloudinary. Share-friendly variant: one Share Copy file, sized to one of three social-native formats -- Landscape / Horizontal 1080 x 566 px, Portrait / Vertical 1080 x 1350 px, or Square 1080 x 1080 px -- selected to match the orientation of the Original (wider than tall, taller than wide, or approximately square); cropped and framed via Cloudinary's AI-driven cropping engine (automatic gravity), with visible in-pixel URL text rendered along the lower-right vertical edge per the R62 §7.6 URL-Text Rendering Contract (rotated 90°; OCR-survivable font, weight, tracking, stroke, and cap-height; placement and costly-signal rationale in R67 §5.9 and Appendix I), resolving to the public image page via image-id slug (e.g., `epima.ge/<image-id>`, which 301-redirects to `epimage.com/<image-id>`). The Share Copy is a public-circulation variant delivered through the CDN per R62 §7.4 -- not on-chain-anchored; verification of Share Copy candidates in the wild routes through the in-pixel URL text and, for stripped-text candidates, the off-chain match engine |
| 14 | Issue deed to buyer wallet | Crossmint API | The deed is minted only after the step 11-13 image operations complete. One-of-one Metaplex Core NFT minted directly to the buyer wallet; edition_tier = Unique; deed_state = sealed (the image is in platform-mediated custody per R62 §3.5.1; the holder has not extracted the Master); royalty_pct = 10 (flat MVP default, applied to all future resale sale prices via the Metaplex Core royalty plugin per R62 §3.5.1; creator-configurable per-deed deferred to MMP alongside resale UI activation post-MVP); royalty_recipients = {creator: 100%}; binds to the content hash; incorporates the image-id record established at listing (Card 2, §2.2). The single mint transaction commits the deed metadata: the Arweave URI (where the encrypted Master resides), the doubly-nested `enc_final` from step 11 (per R62 §2.3 Registry deed-bound decryption-key architecture; the deed carries its own unlock mechanism for the license-survival path), the Master content hash `{M+00}` computed in step 11 (variant-hash schema per R62 §7.4 and R65 §1.5; public-circulation variants per R62 §7.4 are not on-chain-anchored), `deed_state = sealed` as a mutable on-chain field per R62 §3.5.1 (the audit-trail anchor for state transitions that survives platform shutdown), `royalty_pct = 10` and `royalty_recipients = {creator: 100%}` as on-chain royalty-plugin fields per R62 §3.5.1 (enforced by the Metaplex Core royalty plugin on every secondary transfer), and `license_acceptance_signing_event_id` pointing to the buyer's per-image License Acceptance ESIGN record (the license terms themselves live in the signed CMA + License Acceptance ESIGN contracts per R62 §3.4, not on-chain; the on-chain pointer is sufficient because the ESIGN records are independently retained by the signing platform and by the buyer). The platform-KEK operational wrap of `DEK_image` is held in the `images` row in SQLite, not on-chain. The Solana network fee for the mint is borne by Elanoid within its 10% share |
| 15 | Backfill image record | Backend | `images.status = sold`; post-mint hook sets `images.visibility = 'private'` (default privacy posture per §2.6) and stamps `images.privacy_updated_at` |
| 16 | In-platform purchase confirmation | Web App | Confirmation screen displays receipt, License Acceptance, deed details, and link to Collection; Stripe sends its own payment receipt automatically; no platform-sent email |
| 17 | Share Copy available in Collection; image-page rendering swaps to Share Copy | Web App | Personalization and issuance complete |

**Returning-buyer flow (MJA already on file):**

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Click "Buy" on image page | Web App | If Magic SDK session is active, skip to step 3; if signed out, step 2 fires |
| 2 | OAuth re-authenticate if signed out | Magic SDK | Same embedded wallet recovered deterministically from OAuth identity; no new wallet provisioned |
| 3 | Per-image License Acceptance click-wrap | Web App + Backend | Single document; new signing_event_id, new image_hash; MJA skipped (already on file in signatures table) |
| 4+ | Merge with first-purchase flow from step 6 (Enter card via Stripe Embedded Checkout) onwards | -- | First-purchase step 5 (silent wallet provisioning) is skipped (wallet already exists from prior purchase); first-purchase step 8 is skipped (Stripe customer handle already on file). Card details are entered fresh in Stripe Embedded Checkout on every purchase; saved-card on returning purchases is deferred to MMP |

### 2.5 Buyer Collection and Deed-Holder Viewing

The Collection is the buyer's private surface listing every deed-bound image the buyer owns. Each thumbnail offers per-item Share (image-page shareable link) and Download (the Owner Share Copy at the 1080px social-native format, with in-pixel URL text and the buyer's monogram, delivered as JPEG). The underlying Original stays in server-side encrypted-at-rest custody and is never directly downloadable; only the Owner Share Copy derivative is. Deed-holder access is authenticated and ownership-gated.

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Sign in via Google / Apple OAuth | Magic SDK | Skipped if session is active; same embedded wallet recovered deterministically; verified buyer only |
| 2 | Navigate to Collection | Web App | Grid of owned items (thumbnails with title, creator name, acquisition date); per-item Share and Download (Owner Share Copy at the Original's dimensions, JPEG / PNG) surfaces. The Share affordance is the privacy-flip trigger per §2.6: while `images.visibility = 'private'` (the default at mint), the first click opens a confirmation modal warning the flip is irreversible for the current owner's tenure; on confirm, the backend flips visibility to `'public'`, purges the public-page CDN cache, and surfaces the shareable link. Once public, subsequent Share clicks copy the link directly without re-confirmation |
| 3 | Open deed-holder image-page view | Web App + Backend | Ownership-gated: backend verifies deed.owner matches buyer wallet and deed_state is sealed via the Crossmint NFT lookup API (no direct Solana RPC at MVP; Crossmint internalizes all on-chain reads); cached Share Copy (built from the Original during the purchase flow, §2.4 step 13) served via standard browser rendering with basic anti-save (right-click disabled, user-select:none, drag suppression). The platform never holds the buyer's private key; the on-chain `enc_final` is reserved for the license-survival path (post-platform-shutdown self-decryption from Arweave per R62 §7.5, after the trustee publishes `platform_DEK`) and is not consulted on routine deed-holder views |

Without the deed (held in the buyer's wallet), any downloaded file is a copy without enforceable ownership. Share Copies are theft, not ownership.

### 2.6 Owner Privacy and Share Flow

Every minted deed lands in a private posture by default. The owner controls the public surface independently of artifact download: clicking Share on a Collection card is the only action that promotes the image to the public state, and the promotion is one-way for the owner's tenure (resale resets to private; deferred to MMP). Downloading the Share Copy or Share Copy never flips visibility -> the owner can hand the artifact around off-platform without lighting up the public page.

The state and its transitions are formalized in §3.8 (Privacy state machine on `images`). This section describes the user-facing trigger.

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Owner opens Collection | Web App | Authenticated; same surface as §2.5. Each card carries a Share affordance |
| 2 | Click Share on a private card | Web App | Confirmation modal: "Sharing makes this image publicly viewable on epimage.com. This cannot be undone. Continue?" Cancel returns to Collection with no state change |
| 3 | Confirm Share | Web App + Backend | `POST /v1/images/:imageId/make-public` (§3.7); backend verifies the authenticated user is the current owner of the deed via `purchases` join, then sets `images.visibility = 'public'` and stamps `images.privacy_updated_at`. Idempotent; if already public the call short-circuits 204 |
| 4 | CDN cache purge | Backend | Cloudinary asset URLs for the public page do not change, but the SSR HTML response for `GET /:imageId` (the OG / Twitter Card surface) is purged so link-preview crawlers re-fetch the public content. The purge target is keyed on `image_id` |
| 5 | Shareable link surfaced | Web App | The Collection card transitions to the public state in the UI; the shareable link (`epimage.com/<image-id>`) is copied to clipboard and shown in a toast. Subsequent Share clicks on the same card skip the modal and copy the link directly |
| 6 | Public surface live | Web App | Visitors to `epimage.com/<image-id>` now see the post-sale Share Copy surface (Share Copy with monogram, creator credit, deed details) instead of the private stub. OG / Twitter Card metadata re-renders accordingly |

**Private surface rendering.** Anonymous visitors to `epimage.com/<image-id>` when (`images.visibility = 'private'` and a `purchases` row exists for the image) see a Gallery page identical in chrome to the live image page (header, footer, branding) but with a single centered `card` component: a lock icon and the text `image <image-id> is private` with the 5-char base-36 slug inlined into the message (e.g., `image abc1d is private`). No other affordances on the card (no creator credit, no owner attribution, no Buy button, no Report button, no variant render). The same placeholder message format applies to any thumbnail-card surface rendering a private image. The card occupies the same aspect-ratio container the Listing preview / Share Copy would occupy so the layout doesn't shift. The page is served with `<meta name="robots" content="noindex,nofollow">` so the private state is not indexed by search engines, and the OG / Twitter Card metadata renders generic Gallery branding rather than image-specific previews.

**Owner viewing the public URL.** When the authenticated current owner visits `epimage.com/<image-id>` for their own image while it is `private`, the renderer bypasses the gate: the owner sees the full Share Copy surface with a banner noting "This image is private. Click Share to make it publicly viewable." This avoids the confusing experience of the owner hitting the stub on their own image. Non-owner authenticated users (including the creator) see the same private stub as anonymous visitors.

**Decoupling from artifact download.** Downloading the Share Copy from the Collection card does not flip visibility. The in-pixel URL text on the Share Copy (`epima.ge/<image-id>`) is constant across visibility transitions: while private it resolves to the stub, after Share it resolves to the public Share Copy surface. The owner may circulate the Share Copy off-platform without ever flipping visibility; the in-pixel URL is then a dead-end pointer to the stub, which is the intended owner-controlled trade.

**Idempotency and irreversibility.** `POST /v1/images/:imageId/make-public` is idempotent: repeated calls return 204 once `images.visibility = 'public'`. The reverse direction (`public` -> `private`) is not exposed by any API surface; the only way `visibility` returns to `'private'` is the post-transfer hook on resale (post-MVP), which is a system action, not an owner action. This irreversibility is explicit in the confirmation modal copy at step 2 and is the load-bearing user-trust contract for the feature.

### 2.7 Public Image Page and Shareable Link

The public image page is the buyer's first encounter surface, reached via creator-shared social link or via the in-pixel URL text on Share Copy variants in social-media circulation. The website URL format is permanent and human-readable: `epimage.com/<image-id>` where `<image-id>` is the 5-char base-36 lowercase universal handle assigned at ingestion (§2.2 step 8). The in-pixel URL text uses the shorter `epima.ge/<image-id>` form (the `.ge` TLD reduces total character count from 17 to 14 at the longest 5-char ID, fitting cleanly along the lower-right vertical edge per R62 §7.6 URL-Text Rendering Contract); `epima.ge` is a separately registered domain that 301-redirects every path to `epimage.com/<path>` via domain-registrar URL forwarding (no separate hosting infrastructure required). The page persists as long as the deed exists.

Page composition (variant selection by viewer, render zones, framing chrome, conversion bar, "View deed" link) follows R62 §4.3 Artifact Display and Metadata; private-mode rendering (the blank "image is private" stub shown to anonymous and non-owner visitors when `images.visibility = 'private'`, with `<meta name="robots" content="noindex,nofollow">` and generic OG / Twitter Card metadata) follows R62 §4.7 Privacy Architecture. The authenticated current owner is bypass-routed to the Share Copy surface regardless of visibility, with a "Click Share to make public" banner when `images.visibility = 'private'`.

Implemented as an Express route on `GET /:imageId` that performs one indexed SQLite lookup (`images.visibility`, listing fields `title`, `description`, creator display name, Cloudinary Listing-preview URL, and the owner's wallet via `deeds`) and templates the visibility-appropriate OG / Twitter Card tags into the Vite-built `index.html` shell before responding; the React SPA then hydrates and takes over client-side routing. No client-side metadata library (`react-helmet-async`, React 19 metadata hoisting) is used: link-preview crawlers (`Twitterbot`, `facebookexternalhit`, `Slackbot-LinkExpanding`, `LinkedInBot`, iMessage / Discord / WhatsApp link unfurlers) do not execute JavaScript, so only what is present in the initial HTML response is visible to them; client-side injection would arrive too late. Tab-title updates during SPA navigation (a cosmetic concern only, since most Gallery visits land directly on the image page from a social link and don't navigate further) are handled by a small `useEffect` in the image-page component setting `document.title`; no head-management library is required.

| Step | Action | System | Notes |
|---|---|---|---|
| 1 | Visit image page via shared link | Web App | Anonymous access; no auth required to view |
| 2 | Click Report button (optional) | Web App + Backend | Public report ticket; CAPTCHA + IP rate limit; tickets routed to Elanoid for manual handling |

The Buy click on this surface is the entry point to the §2.4 purchase flow and is documented there.

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Subsystems

R71's subsystems are the **deployable services** implementing R62's three conceptual functions (Certification, Commerce, Registry per R62 §1) on a single-process Node + SQLite stack. The mapping is:

| R62 Function (conceptual) | Tier | R71 Subsystems (deployable) |
|---|---|---|
| **Certification** (identity verification, content authentication, ESIGN clickwrap, trust-maintenance) | Gateway | API Service (auth + ESIGN signature persistence), Ingestion Service (founder review UI + Tier 0/1 gates), Database (`users`, `creators`, `owners`, `signatures` tables) |
| **Commerce** (transaction surface, variant production, operational custody, protected render, CDN delivery, all watermarking, fulfillment, analytics) | Gateway | API Service (Stripe orchestration, `runImageOps`), Gallery Service (listing CRUD, render routing, glass-box composition), Original Custody Service (encrypted Original on local FS), Variant Build Service (Listing preview, Thumbnail, Share Copy via Cloudinary), Access-Control Renderer, Database (`images`, `purchases`) |
| **Registry** (deed, Arweave-bound Master Image, image-ID, Magic-provisioned wallet primitive) | Permanent / Decentralized | Arweave Upload Service (one-shot Master upload via ArDrive Turbo), Crossmint client (deed mint to Magic-provisioned Solana wallet), image-ID generator (Card 2; 5-char base-36 handle per R62 §2.3), Database (`deeds` table mirrors on-chain state) |

The Certification / Commerce split is implementation-collapsed onto a single API Service process at MVP scale; the function boundaries remain visible in route prefixes, table ownership, and per-function code modules so the boundary is recoverable for the MMP+ scale-out. Registry's external services (Arweave, Solana via Crossmint, Magic) are the only Web3 dependencies; everything else is Web2 by construction.

| Layer | Subsystem | Responsibility |
|---|---|---|
| Frontend | React Web App | Gallery sign-in surface, creator dashboard + upload flow, image-page rendering (Listing preview / Share Copy), inline buyer purchase and onboarding flow, buyer Collection |
| Frontend | Access-Control Renderer | Standard browser image rendering with basic anti-save (right-click disabled, user-select:none, drag suppression); public render surface and deed-holder render surface |
| Backend | API Service | Business logic, ingestion gate orchestration, payment dispatch, deed-state mutation (Node.js + Express) |
| Backend | Gallery Service | Listing CRUD, deed-holder / public render routing, glass-box composition (per R62 §7.5), takedown dispatch |
| Backend | Ingestion Service | PhotoDNA hash-match + Hive adult-content classifier; all fully automated |
| Backend | Original Custody Service | Encryption-at-rest of the Original via AES-256-GCM with `DEK_image` per file (env-secret-held platform KEK wraps `DEK_image`); persistence to the application server's local filesystem with image-id as filename; controlled decryption for the variant-build service only |
| Backend | Variant Build Service | Composition of Listing preview and Thumbnail at ingestion (§2.2 step 9); on-Arweave Master, and Share Copy at purchase (§2.4 steps 11-13); Listing preview composed with creator-credit and "PREVIEW" watermark overlays via Cloudinary; Thumbnail composed aspect-preserving and unwatermarked at 500 px long-edge |
| Backend | Arweave Upload Service | One-shot Arweave upload at Card 5 of the on-Arweave Master (encrypted with the same `DEK_image` used for the Original) via the ArDrive Turbo bundler (paid managed provider; FIAT top-up); deed metadata records Arweave URI and the doubly-nested `enc_final = encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)` per R62 §2.3 Registry. On resale (deferred to MMP; not active at MVP), only the inner wallet layer of `enc_final` rotates to the new owner's pubkey via the Metaplex Core UpdateDelegate plugin; the Arweave bytes, the platform-KEK operational wrap of `DEK_image`, and `DEK_image` itself are all unchanged |
| Backend | Database | SQLite (single-file local DB): users, creator_allowlist, creators, owners, images, purchases, deeds, signatures |

### 3.2 Libraries

| Layer | Library | Purpose |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind CSS | UI framework, build, styling |
| Frontend | DaisyUI v5.5 (`lofi` theme) | Tailwind CSS plugin providing pre-styled semantic component classes (`btn`, `card`, `modal`, `form-control`, etc.) and a CSS-variable-driven theme system; the `lofi` theme is a high-contrast monochrome register matching Gallery's gallery-print aesthetic. Installed as a Tailwind plugin (`@plugin "daisyui"`); applied app-wide via `data-theme="lofi"` on `<html>` |
| Frontend | TanStack Query | Server-state cache and fetching |
| Frontend | magic-sdk | Client-side OAuth flow, embedded wallet handle, and message signing (signMessage) for deed-holder decryption challenges |
| Frontend | stripe.js + Stripe Embedded Checkout | PCI-safe card capture |
| Frontend | Cloudinary URL SDK | Image URL transformation, signed URLs |
| Frontend | exifr | JPEG marker parsing for the §2.2 step 3 client-side ingestion gate. Single `exifr.parse(file, { sof: true, dqt: true, ... others false })` pass returns (a) `ImageWidth` and `ImageHeight` from the JPEG SOF marker -- reliable for every valid JPEG since SOF is mandatory in the format and is independent of EXIF presence -- feeding the long-edge floor, short-edge floor, megapixel ceiling, and aspect-ratio checks; and (b) the luminance quantization table from the DQT marker, feeding the libjpeg-equivalent quality inversion against the Q90+ floor. Single library covers four of the six gate checks; the format check (JPEG SOI bytes) is a 2-byte native read outside exifr, and the per-edge / total-pixel / aspect / quality computations are arithmetic on exifr's outputs in a small in-house utility. Lightweight (~20 KB gzipped) |
| Frontend | plausible-tracker (or script tag) | Pageview tracking + custom funnel events (signup, Buy click, purchase complete, Report click) |
| Backend | Node.js 20 + Express | API runtime and framework |
| Backend | Prisma | ORM for SQLite (Prisma supports SQLite as a first-class provider; clean migration path to Postgres at MMP) |
| Backend | Magic admin SDK | DID-token verification on authenticated routes |
| Backend | Stripe Node SDK | Server-side Stripe and webhook handling |
| Backend | Crossmint Minting API client | Deed mint + metadata dispatch |
| Backend | @ardrive/turbo-sdk | ArDrive Turbo bundler client (paid managed Arweave provider; FIAT credit-card top-up; production-grade upload reliability and indexing finality) for the permanent encrypted Master upload |
| Backend | Cloudinary Node SDK | Image processing pipeline, AI-driven cropping engine (automatic gravity), signed URL minting |
| Backend | PhotoDNA Cloud Service REST client | CSAM hash-match at ingestion |
| Backend | Hive Moderation REST client | Adult-content classifier (G / Suggestive / Adult / Prohibited) |
| Backend | Pino | Structured JSON logger; writes to stdout for Render log aggregation; correlation IDs across the request lifecycle. Also the sink for the Prisma mutation-logging middleware (see §3.6) -- every DB write surfaces as a structured `db.mutation` log line, providing the audit trail without a dedicated audit table |
| Backend | @sentry/node | Exception capture, release tracking, source-map-mapped stack traces (free tier at MVP) |

### 3.3 External Services

| Service | Provider | Purpose |
|---|---|---|
| Stripe (standard at MVP launch; Stripe Connect Express added immediate post-launch) | Stripe Inc | Fiat payment + chargeback at launch; payment-rail OFAC and SDN screening at the buyer side; creator KYC + automated payouts every 4 weeks from launch + 1099-K via Connect post-launch |
| Crossmint Minting API | Crossmint | One-of-one NFT deed mint; deed metadata carries the Arweave URI and the doubly-nested `enc_final` per R62 §2.3 Registry deed-bound decryption-key architecture; collection management |
| Magic | Magic Labs | Google / Apple OAuth + embedded Solana wallet provisioning (OAuth at signup; wallet provisioned post-terms-acceptance). The buyer's wallet key is the unwrap key for the license-survival self-decryption path on Arweave; routine platform delivery does not consult the wallet key |
| Arweave (via ArDrive Turbo bundler) | Arweave network + ArDrive | Single-upload permanent storage of the on-Arweave Master (encrypted with `DEK_image`) via the ArDrive Turbo bundler -- a paid managed Arweave provider with FIAT credit-card top-up (no AR token treasury required), production-grade upload reliability, and fast indexing finality; license-survival receipt only. The doubly-nested `enc_final = encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)` lives in deed metadata, not on Arweave |
| Cloudinary | Cloudinary | Public render image transformation, signed URLs, CDN delivery. Cloudinary is the canonical store for the public-circulation variants (Listing preview, Thumbnail, Share Copy) -> not platform-side cached per R62 §7.4; the Share Copy is built via Cloudinary and the byte stream is persisted to local-FS server-side custody (cached per (deed, owner) pair). Cloudinary asset naming and the downloaded-file filename convention follow R62 §2.3 / §7.4; CDN assets are delivered through the domain-fronted virtual path (application rewrite rule, background fetch) per R62 §7.3. Gallery runs on the Cloudinary Plus tier (entry paid plan), required for the 20 MB image file-size limit and 40 MP transformation ceiling per §1.3; the Plus credit allocation far exceeds MVP transformation, storage, and bandwidth volume. The variant pipeline re-encodes every served image through Cloudinary's image library, which by construction strips embedded payloads from the underlying file -> the structural malware mitigation at MVP, since automated AV signature scanning is deferred to MMP |
| Plausible | Plausible Insights | Privacy-friendly analytics (no cookies; daily-rotating hashed identifiers; not personal data under GDPR / ePrivacy; no consent banner required); custom funnel events |

**Vendor contracts.** The table above lists role and purpose; the paragraphs below pin what the platform code actually sends and receives per vendor. These contracts are what bind the §3.7 endpoints and the §3.9 background jobs to specific external behavior.

**Stripe.** The platform calls `stripe.checkout.sessions.create` at `POST /v1/purchases` (§3.7 row 15) with `mode='payment'`, `payment_method_types=['card']`, `line_items` configured to the listing price, `customer` set to the buyer's `stripe_customer_id` (created on first purchase), and `metadata.purchase_id` carrying the Gallery `purchases.id`. The platform subscribes to four webhook events at `POST /v1/webhooks/stripe`:

| Event | Trigger | DB write |
|---|---|---|
| `checkout.session.completed` | Buyer completes Stripe Embedded Checkout | Idempotent: confirms session-to-purchase binding; sets `purchases.stripe_checkout_session_id` if not already set |
| `payment_intent.succeeded` | Card captured | Sets `purchases.status = paid`, records `amount_gross_cents`, computes 90 / 10 net amounts against the Stripe-reported processing fee and persists them as `amount_creator_net_cents` and `amount_platform_net_cents` on the same row; spawns `runImageOps` (§3.9) |
| `payment_intent.payment_failed` | Card declined, 3DS failure, or fraud reject | Sets `purchases.status = failed`, `failure_reason = STRIPE_PAYMENT_FAILED:<decline_code>` |
| `charge.refunded` | Auto-refund triggered by §4.3 failure path | Sets `purchases.status = refunded`; the row's net amounts are canceled by the status transition (creator-side aggregation excludes refunded rows) |

**Stripe webhook verification.** Signature header: `Stripe-Signature`. Algorithm: HMAC-SHA256 of `t=<timestamp>.<rawBody>` keyed by the endpoint signing secret; verification is performed via `stripe.webhooks.constructEvent(rawBody, signature, secret)` which throws on signature mismatch or timestamp drift exceeding 5 minutes. Secret source: env `STRIPE_WEBHOOK_SECRET`. Body parsing: the `POST /v1/webhooks/stripe` route MUST use `express.raw({ type: 'application/json' })` and NOT `express.json()` -> HMAC verification operates on the exact byte stream Stripe signed, and JSON re-serialization breaks the signature. Idempotency: each handler uses a conditional `UPDATE purchases SET status = <new>, ... WHERE id = ? AND status = <expected_prior>` against `purchases`; the row's existing state is the dedup token. SQLite row-level locking serializes concurrent duplicate webhooks; the handler proceeds only when `updateCount === 1` (first delivery), silently exits otherwise. No separate idempotency table at MVP. Response semantics: return `200` on accept (including duplicates); return `400` only on signature failure. Internal handler errors are caught, logged via Pino with `requestId`, and the response is still `200` to avoid retry storms.

**Crossmint.** The platform calls the Crossmint Minting API at the end of `runImageOps` (§3.9), after the Master is on Arweave and the Share Copy byte stream is cached. Mint request body:

```json
{
  "recipient": "solana:<buyer_wallet_address>",
  "metadata": {
    "name": "<listing.title>",
    "image": "<cloudinary_listing_preview_url>",
    "attributes": [
      { "trait_type": "creator", "value": "<creator.display_name>" },
      { "trait_type": "image_id", "value": "<image_id>" },
      { "trait_type": "edition", "value": "1 of 1" }
    ],
    "properties": {
      "arweave_master_uri": "<arweave_uri>",
      "enc_final": "<base64_nested_ciphertext_encrypt_DEK_image_buyer_wallet_then_platform_DEK>",
      "deed_state": "sealed",
      "royalty_pct": 10,
      "royalty_recipients": [{"address": "<creator_wallet_address>", "share": 100}],
      "variant_hashes": {
        "M+00": { "sha256": "<images.sha256>", "anchored_at": "<mint_tx_block_time>" }
      },
      "license_acceptance_signing_event_id": "<purchases.signing_event_id_license>"
    }
  }
}
```

Returns: Crossmint mint job id, eventual `mint_address` (Solana NFT address), and `transaction_signature`. Subscribed callbacks at `POST /v1/webhooks/crossmint`:

| Event | DB write |
|---|---|
| `mint.succeeded` | Writes `deeds` row with `image_id`, `mint_address`, `variant_hashes`, `deed_state='sealed'` (mirror of the on-chain `deed_state` field per R62 §3.5.1; Solana is authoritative), `owner_wallet_address`, `owner_id` (the Arweave URI is on `images.arweave_uri` from §2.4 step 12, not duplicated on the deed row; the doubly-nested `enc_final` is committed on-chain at §2.4 step 14 and not mirrored to SQLite -- license-survival reads from Solana, not from the local mirror); sets `purchases.status = confirmed`, `purchases.deed_mint_tx_signature`; sets `images.status = sold` |
| `mint.failed` | Sets `purchases.status = failed`, `failure_reason = MINT_FAILED:<error_code>`; inline-calls `runStripeRefund` (§3.9) |

Ownership-gating lookups (§3.7 row 20) call Crossmint's NFT lookup endpoint to confirm `deed.owner_wallet_address` matches the current on-chain owner without a direct Solana RPC.

**Crossmint webhook verification.** Signature header: `x-crossmint-signature` (per current Crossmint webhook docs -> implementer should confirm the exact header name and any SDK-provided verification helper against the Crossmint dashboard documentation at build time). Algorithm: HMAC-SHA256 of `rawBody` keyed by the webhook signing secret. Secret source: env `CROSSMINT_WEBHOOK_SECRET`. Verification: either a Crossmint SDK helper if one is exposed at implementation time, otherwise a manual `crypto.timingSafeEqual` HMAC compare in Node. Body parsing: same as Stripe -> the `POST /v1/webhooks/crossmint` route MUST use `express.raw({ type: 'application/json' })` to preserve the byte stream Crossmint signed. Idempotency: same conditional-UPDATE pattern as Stripe -> the `mint.succeeded` handler attempts `UPDATE purchases SET status = 'confirmed', ... WHERE id = ? AND status = 'minting'`; `mint.failed` is similarly gated. `deeds` row insertion at `mint.succeeded` is naturally idempotent because `deeds.image_id` is a primary key (a second insert fails harmlessly). No separate idempotency table at MVP. Response semantics: return `200` on accept including for duplicates; return `400` only on signature failure; internal handler errors are caught, logged, response still `200`.

**Cloudinary.** All variants are produced by single transformation requests via the Cloudinary Node SDK -> Listing preview and Thumbnail at upload time (§2.2 step 9), Share Copy during `runImageOps` (§2.4 step 13). Transformation chains follow the §3.5 precedence: resize and crop first, overlays second, quality and format last as the final delivery.

| Variant | When built | Cloudinary transformation chain |
|---|---|---|
| Listing preview | §2.2 step 9 | `c_limit,w_1080,h_1080` -> creator-credit text layer overlay -> large horizontal "PREVIEW" text layer (`l_text:<font>_<pt>_normal:PREVIEW,co_white,o_30,g_south,y_40`; pt sized so the text spans roughly 60% of the image's width) -> `q_auto:good,f_jpg` |
| Thumbnail | §2.2 step 9 | `c_limit,w_500` -> `q_70,f_jpg` |
| Share Copy | §2.4 step 13 | `c_fill,g_auto,w_1080,h_<566\|1080\|1350>` -> monogram layer -> URL-text layer per R62 §7.6 -> `q_85,f_jpg` |

The Cloudinary `public_id` of each variant is `<image_id>-<variant_code>` per R62 §7.3 (deterministic; no DB column required, hence `images` carries no Cloudinary handle). Upload uses `cloudinary.uploader.upload` with `public_id` set explicitly; the `eager` parameter pre-builds the transformations so the first render is cached.

**Magic.** Client side: `magic.auth.loginWithRedirect({ provider: 'google' | 'apple' })`, then `magic.user.getInfo()` returns the `issuer` (DID) and `publicAddress` (Solana wallet). The DID token rides every authenticated request in the `Authorization: Bearer <token>` header. Backend verification: `magic.token.validate(didToken)` followed by `magic.token.getIssuer(didToken)` resolves to `users.magic_did` for row lookup. Wallet provisioning is silent and post-terms-acceptance: the wallet exists on Magic's side at first OAuth completion, persisted to `users.wallet_address` only after the CMA (creator) or MJA (buyer) signature is captured.

**Arweave via ArDrive Turbo.** Upload at §2.4 step 12 via `@ardrive/turbo-sdk`: `turbo.uploadFile({ fileStreamFactory, fileSizeFactory })`. The bundler returns a transaction id; the URI `https://arweave.net/<tx_id>` is persisted to `images.arweave_uri` (image-bytes-bound; byte-immutable for the lifetime of the deed per R62 §7.4) and carried into the Crossmint mint payload. Top-up is FIAT credit card via the ArDrive dashboard; the platform holds no AR tokens.

**Plausible.** Custom events fire client-side via `plausible('event_name', { props: { creator_id, image_id, utm_source, utm_medium, utm_campaign } })`. Event names: `image_page_visit`, `sign_in_click`, `buy_click`, `oauth_complete`, `purchase_complete`, `report_click`. No backend integration: Plausible reads its page-view stream from the script tag and ingests custom events directly from the client.

### 3.4 UI Pages

The MVP frontend renders four pages. Modals (checkout, report) and the purchase-confirmation view are folded as states of the Image page rather than separate routes, matching R62 §4.3 which treats the image page as one surface with multiple render conditions distinguished by viewer classification (anonymous / non-owner / deed-holder) and visibility state (public / private, pre-sale / post-sale).

| # | Page | URL | Viewer / Access | States |
|---|---|---|---|---|
| 1 | Sign-in | /signin | Anonymous | **Default**: Google / Apple OAuth buttons; single CTA; routes by user type post-auth (creator -> Creator page; buyer -> Image page if mid-flow, else last-visited) |
| 2 | Creator | /creator | Authenticated creator (founder-vetted; §2.1) | **Listings grid**: thumbnails of own listings with status (live, sold) and per-item Edit / Delete (deferred to MMP)<br>**Upload form (inline)**: file picker, local quality checks UI, ingestion-gate progress (PhotoDNA hash-match, Hive adult-content classifier), per-image Image Signing Affirmation ESIGN click, Sole Copy Agreement click-wrap, listing metadata (title, description, creation date), fixed-price input ($20 - $2,000) |
| 3 | Image | /[image-id] | Anonymous, authenticated buyer (non-owner), authenticated buyer (deed holder = owner) | **Default-public (public render)**: Listing preview pre-purchase; Share Copy variant post-personalization; price; creator credit; Buy CTA; "Report this image" mailto link in footer<br>**Default-private stub (private render to non-owner visitors per §2.6)**: blank card with lock icon and `image <image-id> is private` text (5-char base-36 slug inlined); no creator credit, no Buy CTA, no Report (`<meta name="robots" content="noindex,nofollow">` and generic OG / Twitter Card metadata)<br>**Default-owner (deed-holder render)**: Share Copy variant; deed metadata (mint date, deed address, edition number); Collection link; Share affordance (§2.6 -- privacy-flip with confirmation modal when image is `private`, copies shareable link when `public`); "Click Share to make public" banner when `images.visibility = 'private'`; "Report this image" mailto link in footer<br>**Buy state**: checkout modal overlays the page; Stripe Embedded Checkout card form; bundled MJA + License Acceptance click-wrap (first purchase) or License Acceptance only (returning buyer); Sign click; Cancel returns to Default-public<br>**Confirmation state**: post-Sign render replaces buy modal; receipt summary, License Acceptance summary, deed details (deed address, Solana mint signature), Collection link; Stripe sends payment receipt by email separately |
| 4 | Buyer Collection | /collection | Authenticated buyer | **Default**: grid of owned images (thumbnail, title, creator, acquisition date); per-item link to Image page Default-owner state; per-item Master Download deferred to MMP (would transition the image from sealed to opened per R62 §3.5.1, recorded as `deed_state`) |

**Pages deferred to post-MVP:** Public Creator Page (creator-handle landing surface aggregating all listings for unauthenticated discovery); Account / Settings page; Per-buyer monogram-decision UI on Image page Default-owner state.

**Routing notes.** The URL column above lists every MVP route; path syntax `[image-id]` maps to React Router's `:imageId` parameter convention. The Magic OAuth callback route (`/auth/callback`) is handled by the Magic SDK's provider component and is not a separate page in this table. Auth and role guards follow the Viewer / Access column: routes restricted to "Authenticated creator" require an existing `creators` row (the same condition the §3.7 creator endpoints check); routes restricted to "Authenticated buyer" require an authenticated session; "Anonymous" cells need no guard. Modal states (checkout, report, confirmation) are component states on the Image page rather than separate routes. The site-wide footer carries a "Report this image" `mailto:abuse@epimage.com?subject=Report%20<image-id>` link on every page so reporters can use their own mail client to reach the founder; no in-app submission endpoint exists at MVP. Server-side rendering applies only to `/[image-id]` per §2.7; all other routes are client-rendered.

### 3.5 Share Copy Build Pipeline

The Share Copy variant is composed during the purchase-completion sequence (§2.4 step 13) from the decrypted Original, not lazily on first view. It is built before the deed mint: the deed is issued only once the image operations succeed (§2.4 step 14), so a deed is never issued for an incomplete image set and a build failure cancels cleanly before any deed exists. On a Cloudinary call failure the build retries up to 3 times; if all retries fail, the Stripe charge is auto-refunded, `purchases.status` is set to `refunded` (excluding the row from creator-earnings aggregation), and the founder alerted (§4.3) -> no deed is minted. The Master `sha256` is computed at its build step and committed into the deed metadata `{M+00}` by the single mint transaction (variant-hash schema per R62 §7.4 and R65 §1.5). The Share Copy is a public-circulation variant delivered through the Cloudinary CDN per R62 §7.4 -> not on-chain-anchored and not platform-side cached; verification of a Share Copy in the wild routes through the in-pixel URL text and the off-chain match engine. Because the build and the mint precede the confirmation screen, the buyer sees a brief processing state after the monogram step.

The Share Copy is produced by a single Cloudinary transformation request: cropped to one of the three social-native formats (1080 x 566, 1080 x 1080, or 1080 x 1350) via the AI-driven cropping engine, carrying the in-pixel URL-text overlay per the R62 §7.6 rendering contract and the per-owner monogram overlay (§2.4 step 9), and encoded as JPEG at quality 85 -> a social-display setting, since social platforms recompress images on upload and a higher setting would be discarded. Within the request, Cloudinary applies its fixed internal precedence: base resize and crop first, the overlays composited second, and the quality and format encode applied last as the single final output. Quality and format are set only on the final delivery, never on an intermediate chained component, so the variant is encoded exactly once; the rotated, edge-positioned URL text is expressed as a chained layer-apply block.

### 3.6 Data Model

Naming follows R62 conventions: `image_id` is the 5-char base-36 lowercase universal handle from R62 §2.3; `mint_address` is the Solana base58 NFT address; `signing_event_id` is the UUID of an ESIGN click event. `signatures` is keyed by `user_id` + `document_type` and serves as the canonical record for every legal event the user executes, including the CMA and MJA role-grant events. Cloudinary `public_id` for each variant is deterministic from `image_id` + variant code per R62 §7.3, so no handle column lives on `images`. All amounts are integer cents. All timestamps are ISO 8601 UTC.

**`users`** -> identity layer; one row per Magic-authenticated principal, touched by every authenticated request. No role-specific columns.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID PRIMARY KEY | |
| `magic_did` | TEXT UNIQUE | Magic SDK DID; OAuth identity binding |
| `email` | TEXT | From OAuth claim; not used for auth |
| `oauth_provider` | TEXT | `google` \| `apple` |
| `wallet_address` | TEXT UNIQUE | Solana base58 pubkey, Magic-provisioned |
| `created_at`, `updated_at` | TIMESTAMP | |

**`creator_allowlist`** -> founder-curated gate for creator onboarding; populated manually by the founder per §2.1 and consulted as a hard precondition by `POST /v1/creator/sign-cma`. Independent of `users`: rows exist before the prospective creator has authenticated. Email is the join key against `users.email` (the OAuth-claim email), checked at sign-cma time. Vetting evidence (subscriber count, channel handle, rationale) is the founder's out-of-band record; the table itself persists only the allow decision.

| Column | Type | Notes |
|---|---|---|
| `email` | TEXT PRIMARY KEY | Founder-vetted creator's primary email; matched against `users.email` at sign-cma |
| `created_at` | TIMESTAMP | When the founder added the row |

**`creators`** -> profile data for the `CREATOR` role; existence of this row is the role grant. The CMA signature event is on the `signatures` ledger keyed by `user_id` and `document_type='CMA'`. The allowlist hit at sign-cma time is the vetting record; no per-row verified flag is needed on this table.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID PRIMARY KEY FK | -> `users.user_id`; existence of this row is the `CREATOR` role grant |
| `display_name` | TEXT | Public artist credit on image pages |
| `legal_name` | TEXT | CMA counterparty; embedded in the rendered CMA text at signing |
| `legal_address` | JSON | Service of process; standard contract practice for the CMA |
| `entity_type` | TEXT | `individual` \| `llc` \| `corp`; counterparty type and 1099 classification context |
| `youtube_channel_handle` | TEXT | YouTube OAuth verification deferred to MMP |
| `stripe_connect_account_id` | TEXT | Stripe Connect Account object handle (the receiving side; distinct from `owners.stripe_customer_id` on the paying side). Nullable at MVP; populated when the creator completes Connect Express onboarding per the immediate post-launch buildout (§2.1). Tax ID, bank account, and 1099 issuance live on the Stripe side and are not duplicated here |
| `created_at`, `updated_at` | TIMESTAMP | |

**`owners`** -> profile data for the `OWNER` role; existence of this row is the role grant. Created at MJA signature (§2.4 step 4). The MJA signature event is on the `signatures` ledger keyed by `user_id` and `document_type='MJA'`. Identity for the MJA is anchored on the Magic OAuth principal (`users.magic_did`) plus the `signatures` row; further billing identity lives in Stripe (Customer object) and is not duplicated on this table.

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID PRIMARY KEY FK | -> `users.user_id`; existence of this row is the `OWNER` role grant |
| `stripe_customer_id` | TEXT | Stripe customer object handle; payment-method continuity across purchases |
| `created_at`, `updated_at` | TIMESTAMP | |

**`images`** -> one row per uploaded image; the `image_id` is the primary key and the universal handle.

| Column | Type | Notes |
|---|---|---|
| `image_id` | TEXT(5) PRIMARY KEY | R62 §2.3 base-36 handle |
| `creator_id` | UUID FK | -> `creators.user_id` |
| `title`, `description` | TEXT | Listing copy |
| `creation_date` | DATE | Creator-supplied; image creation, not upload date |
| `listed_price` | INTEGER | $20 to $2000 range (2000 to 200000 cents) |
| `status` | TEXT | `pending_review` \| `draft` \| `live` \| `sold` \| `taken_down`; forward-compat: `rights_disputed`. New uploads land at `pending_review` until the founder approves (§2.2 step 5); transitions to `draft` on approval, then to `live` on §2.2 step 9 publish |
| `takedown_reason` | TEXT | Nullable; populated by founder via admin tool when transitioning to `taken_down`, capturing the rationale (DMCA, RoP, ToS violation, etc.) |
| `dek_wrapped` | BLOB | `DEK_image` wrapped to platform KEK (env-secret); R65 §3.14 |
| `arweave_uri` | TEXT | Encrypted Master URI on Arweave; nullable pre-sale, populated at §2.4 step 12 of the first sale, byte-immutable for the lifetime of the deed per R62 §7.4 |
| `sha256` | TEXT | sha256 of the canonical Master pixels; nullable pre-sale, populated at §2.4 step 11 of the first sale, byte-immutable for the lifetime of the deed per R62 §7.4. The on-chain anchor recorded as `M+00` in `deeds.variant_hashes` |
| `width_px`, `height_px` | INTEGER | Canonical image dimensions; captured at ingestion against the §1.3 window. Master pixels are derived from the Original at first sale and share dimensions per R62 §3.5 |
| `visibility` | TEXT | `public` \| `private`; default `public` at row creation (pre-sale listing must be discoverable). Post-mint hook flips to `private` at §2.4 step 15. Owner Share (§2.6) flips back to `public`. Post-transfer hook resets to `private` on resale (post-MVP). Public-page renderer (§2.7) gates on this column |
| `privacy_updated_at` | TIMESTAMP | Nullable; updated on every visibility transition (mint flip, owner Share, resale reset). Powers Share-lag analytics and the "Click Share to make public" banner timing |
| `signing_event_id_authorship` | UUID FK | -> `signatures.id`; the per-image Image Signing + Sole Copy combined affirmation per §2.2 step 7 |
| `published_at` | TIMESTAMP | |
| `created_at`, `updated_at` | TIMESTAMP | |

**`purchases`** -> one row per buy attempt; lifecycle spans Stripe checkout through deed mint, per the §3.8 purchase state machine.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `image_id` | TEXT(5) FK | -> `images.image_id` |
| `owner_id` | UUID FK | -> `owners.user_id` |
| `seller_user_id` | UUID FK | -> `users.user_id`; the recipient of the 90% net. At MVP always equals `creators.user_id` of the image's creator |
| `stripe_payment_intent_id` | TEXT | |
| `stripe_checkout_session_id` | TEXT | |
| `amount_gross_cents` | INTEGER | Buyer-paid total |
| `amount_creator_net_cents` | INTEGER | 90% net of Stripe fee per §2.4 step 10 |
| `amount_platform_net_cents` | INTEGER | 10% net of Stripe fee |
| `status` | TEXT | Per §3.8 purchase state machine |
| `failure_reason` | TEXT | Nullable; structured code on failure |
| `monogram_text` | TEXT | After §2.4 step 9 |
| `deed_mint_tx_signature` | TEXT | Solana transaction signature (per-purchase: mint signature at first sale, transfer signature at MMP resale) |
| `signing_event_id_mja` | UUID FK | Nullable; first-purchase only |
| `signing_event_id_license` | UUID FK | Every purchase |
| `created_at`, `completed_at` | TIMESTAMP | |

**`deeds`** -> on-chain ownership mirror; the Solana ledger is authoritative, this row exists for fast UI render and ownership-gating lookups without per-request RPC.

| Column | Type | Notes |
|---|---|---|
| `image_id` | TEXT(5) PRIMARY KEY FK | -> `images.image_id`; 1:1 with `images` once minted |
| `mint_address` | TEXT UNIQUE | Solana base58 NFT address; on-chain lookup key |
| `owner_wallet_address` | TEXT | Mirror of on-chain owner; equals buyer wallet at MVP (no resale; deferred to MMP) |
| `owner_id` | UUID FK | -> `owners.user_id`; on resale-time transfer this FK rebinds to the new owner's row (deferred to MMP) |
| `deed_state` | TEXT | `sealed` at MVP; column exists for forward-compat (`opened`, `rights_disputed`, `void`, `burned`) |
| `variant_hashes` | JSON | `{"M+00": {"sha256": <hex>, "anchored_at": <iso>}, "E+01": {"sha256": <hex>, "anchored_at": <iso>}}` per R62 §7.4. `anchored_at` is the timestamp of the Solana transaction that wrote the entry; at MVP both entries land in the single mint transaction so both equal `deeds.minted_at`. Map is append-only; post-MVP additions (M+N on Master download, E+N' on resale re-personalization) carry their own anchor timestamps |
| `minted_at` | TIMESTAMP | |
| `created_at`, `updated_at` | TIMESTAMP | |

**`image_reviews`** -> founder review decision log per §2.2 step 5; one row per review event. The unchecked checkbox is the rejection reason -> the JSON `checks` payload is the audit-grade record without a free-text reason field. Approve transitions `images.status` from `pending_review` to `draft`; Tier 1 reject deletes the staging upload and sets `images.status = taken_down` with `takedown_reason = 'tier1_violation'`; Tier 0 reject locks the creator account, preserves the staging hash for §2258A reporting, and sets `images.status = taken_down` with `takedown_reason = 'tier0_violation_ncmec_reported'`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PRIMARY KEY | |
| `image_id` | TEXT(5) FK | -> `images.image_id`; not unique because forward-compat allows multiple reviews if an image is re-submitted |
| `reviewer_id` | UUID FK | -> `users.user_id`; founder at MVP, schema permits future delegates |
| `decision` | TEXT | `approved` \| `rejected_tier1` \| `rejected_tier0` |
| `checks` | JSON | `{"tier0_clean": true \| false, "tier1_clean": true \| false}`; the per-checkbox state at submission |
| `ncmec_report_filed_at` | TIMESTAMP | Nullable; populated when the Tier 0 NCMEC CyberTipline subflow completes (64-day statutory ceiling, 24-hour operational target) |
| `decided_at` | TIMESTAMP | When founder submitted the decision |

**`signatures`** -> one row per ESIGN click event; covers CMA, MJA, per-image License Acceptance, expanded Image Signing + Sole Copy combined affirmation.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PRIMARY KEY | The `signing_event_id` referenced from `images` and `purchases` |
| `user_id` | UUID FK | -> `users.user_id` |
| `document_type` | TEXT | `CMA` \| `MJA` \| `LICENSE_ACCEPTANCE` \| `IMAGE_SIGNING_AFFIRMATION` |
| `document_version_hash` | TEXT | sha256 of the displayed document text |
| `document_version_label` | TEXT | Human-readable version (e.g., `MJA-v1.0`) |
| `image_id` | TEXT(5) FK | Nullable; set for `LICENSE_ACCEPTANCE` and `IMAGE_SIGNING_AFFIRMATION` |
| `clicked_at` | TIMESTAMP | |
| `ip_address` | TEXT | |
| `session_token_hash` | TEXT | |

**Indices.** `users.magic_did`, `users.wallet_address`, `owners.stripe_customer_id`, `deeds.mint_address`, `images(creator_id, status)`, `images(status, published_at desc)` for the live-page browsing surface, `images(status) WHERE status = 'pending_review'` for the founder review queue, `purchases.stripe_payment_intent_id`, `purchases(owner_id, created_at desc)`, `purchases(seller_user_id, status, created_at desc)` for the creator earnings aggregation, `deeds.owner_wallet_address`, `deeds(owner_id, minted_at desc)` for the Collection page, `signatures(user_id, document_type)`, `image_reviews(image_id)`.

**Mutation logging.** All DB writes are intercepted by a single Prisma middleware (`$extends.query.$allOperations`) that captures the operation, model, entity id, actor user id, and a compacted before / after payload, and emits one structured `db.mutation` line via Pino (§3.2) to stdout for each mutation. The host (Render) captures stdout into its log aggregation surface, where mutations are searchable by entity id, actor, or model. This replaces a dedicated audit table: there is no application-side `audit_logs.create()` scattered across handlers, and the audit trail can't be forgotten unless someone bypasses Prisma (which the codebase does not). Read operations are not logged. The middleware is implemented once in the Prisma client initializer and is the canonical mutation-audit surface for MVP.

### 3.7 API Surface

The backend exposes a single versioned JSON API under `/v1` plus the public-page Express route `GET /:imageId` (§2.7). Non-public routes require a Magic-issued DID token in the `Authorization: Bearer <token>` header; the Magic admin SDK (§3.2) verifies the token and resolves it to a `users` row on each request. Routes are grouped by §2 workflow. Webhook receivers verify their respective provider signatures.

| # | Method + Path | Auth | Serves | Body / Returns |
|---|---|---|---|---|
| 1 | `POST /v1/auth/session` | Magic DID | §2.1 step 1, §2.4 step 3 | Magic DID token in body; creates or fetches `users` row by `magic_did`; returns user profile |
| 2 | `DELETE /v1/auth/session` | Magic DID | Sign-out | Clears server-side session state |
| 3 | `GET /v1/me` | Magic DID | Header on every authenticated page | Current `users` profile: role flags, wallet, billing composite |
| 4 | `POST /v1/creator/sign-cma` | Magic DID | §2.1 step 2 | Body: `document_version_label`, plus creator profile fields (`legal_name`, `legal_address`, `entity_type`, `display_name`, `youtube_channel_handle`). **Precondition**: authenticated user's OAuth-verified email must match a `creator_allowlist` row; otherwise rejected with structured 403. On success, in one transaction creates a `signatures` row (`document_type=CMA`, `user_id=<authenticated user>`, `document_version_hash` over the personalized CMA text rendered with the legal identity fields) and a `creators` row carrying the full profile. Existence of the `creators` row is the role grant; the legal basis is recoverable from `signatures` by user_id and document_type; the vetting basis is recoverable from `creator_allowlist` by email |
| 5 | `PATCH /v1/creator/profile` | Creator | §2.1 step 3 | Body: `display_name`, `youtube_channel_handle` |
| 6 | `POST /v1/creator/uploads` | Creator | §2.2 steps 3-4, 7-8 | Multipart JPEG; runs local quality checks (§1.3 window check) on accept; assigns staging handle; creates `images` row with `status='pending_review'`; enqueues to founder review queue (§2.2 step 5); returns the staging handle. The Creator ESIGN affirmation (step 6 of §2.2), image-id assignment, encryption, and variant builds (steps 7-8 of §2.2) only execute after the founder approves via `POST /v1/admin/reviews/:imageId`. On §1.3 reject the response returns the specific failing-parameter code |
| 6a | `GET /v1/admin/reviews` | Founder | Founder review dashboard | Returns pending-review queue: list of `images` rows where `status='pending_review'`, with creator handle, staging preview URL, upload timestamp, and queue age |
| 6b | `POST /v1/admin/reviews/:imageId` | Founder | §2.2 step 5 submit | Body: `{tier0_clean: boolean, tier1_clean: boolean}`. Writes the `image_reviews` row with the per-checkbox state. Both true -> `images.status = 'draft'`, creator emailed with the resume-listing link. Tier 1 false -> `images.status = 'taken_down'`, `images.takedown_reason = 'tier1_violation'`, staging upload deleted, creator emailed with the parametric Tier 1 rejection. Tier 0 false -> `images.status = 'taken_down'`, `images.takedown_reason = 'tier0_violation_ncmec_reported'`, staging image hash + metadata preserved (90-day minimum), creator account `users.status` flipped to `suspended`, NCMEC CyberTipline checklist UI opened to the founder. The unchecked box IS the rejection reason; no free-text required |
| 7 | `POST /v1/creator/uploads/:imageId/sign-affirmation` | Creator | §2.2 step 6 | Body: `document_version_label`; creates `signatures` row (document_type=IMAGE_SIGNING_AFFIRMATION with expanded Tier 2 warranty text); stamps `images.signing_event_id_authorship`. Precondition: `images.status='draft'` (founder-approved). At this step the backend executes §2.2 steps 7-8 inline (image-id assignment, DEK_image generation, Original encryption at rest, Listing preview and Thumbnail generation via Cloudinary) |
| 8 | `POST /v1/creator/images/:imageId/publish` | Creator | §2.2 step 9 | Body: `title`, `description`, `creation_date`, `listed_price`; sets `images.status = live` |
| 9 | `GET /v1/creator/images` | Creator | §3.4 Creator page grid | Own images with status and sold-count |
| 10 | `GET /v1/creator/earnings` | Creator | Creator dashboard balance | Returns aggregate from `purchases` where `seller_user_id = <authenticated user>`: sum of `amount_creator_net_cents` for rows with `status='confirmed'`, minus sum for `status='refunded'`; post-Connect, payout history is read from Stripe's `transfers.list` API and subtracted to derive the available balance |
| 11 | `GET /:imageId` | Anonymous | §2.7 step 1 | Server-rendered HTML shell with visibility-branched OG / Twitter Card metadata per §2.7; React SPA hydrates and takes over client-side routing |
| 12 | `GET /v1/images/:imageId` | Anonymous | Image-page client hydration | Listing JSON: title, description, creator credit, price, viewer-appropriate variant URL (Listing pre-sale, Share Copy post-sale), report-enabled flag |
| 14 | `POST /v1/buyer/sign-mja` | Magic DID | §2.4 step 4 (first purchase only) | Body: `document_version_label`; in one transaction creates a `signatures` row (`document_type=MJA`, `user_id=<authenticated user>`) and an `owners` row (Stripe customer handle populated at §2.4 step 8). Existence of the `owners` row is the role grant; the legal basis is recoverable from `signatures` by user_id and document_type |
| 15 | `POST /v1/purchases` | Buyer | §2.4 step 6 init | Body: `image_id`; creates `purchases` row (`status=started`), creates Stripe Checkout Session, returns Stripe client_secret |
| 16 | `POST /v1/purchases/:id/sign-license` | Buyer | §2.4 step 4 | Body: `document_version_label`; creates `signatures` row stamped to `purchases.signing_event_id_license` |
| 17 | `POST /v1/purchases/:id/monogram` | Buyer | §2.4 step 9 | Body: `monogram_text`; persisted for Share Copy build at step 13 |
| 18 | `GET /v1/purchases/:id` | Buyer | Post-checkout polling (§2.4 steps 11-16) | Purchase JSON with status; client polls until `status=confirmed` or `failed` |
| 19 | `GET /v1/collection` | Buyer | §2.5 step 2 | Buyer's owned deeds with Share Copy URLs and acquisition metadata |
| 20 | `GET /v1/deeds/:mintAddress/social-copy-download` | Owner (Crossmint-verified) | §2.5 download CTA | Verifies `deed.owner_wallet_address` via Crossmint NFT lookup before issuing a signed short-lived URL to the cached Share Copy byte stream |
| 20a | `POST /v1/images/:imageId/make-public` | Owner | §2.6 step 3 | Privacy-flip trigger. Backend verifies the authenticated user is the current owner via `purchases` join (matching `images.imageId` to a `purchases` row with `status='confirmed'` and `owner_id=<authenticated user>`), then sets `images.visibility='public'` and stamps `images.privacy_updated_at`. Purges the public-page CDN cache for `image_id`. Idempotent: if already public, returns 204 without re-stamping. Rejects with `E_IMAGE_NOT_OWNED` (403) if the caller is not the owner. No reverse direction is exposed -- the only way back to `private` is the system-driven post-transfer hook on resale (post-MVP) |
| 21 | `POST /v1/webhooks/stripe` | Stripe signature | §2.4 step 7 and failure recovery | Events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`; triggers the §2.4 steps 10-15 async image-ops sequence per §3.9 |
| 22 | `POST /v1/webhooks/crossmint` | Crossmint signature | §2.4 step 14 callback | Events: `mint.succeeded`, `mint.failed`; finalizes `purchases.status` and writes the `deeds` row |
| 23 | `GET /v1/health` | Anonymous | Ops | Liveness + dependency probes (DB, Stripe, Crossmint, Cloudinary, Arweave) |
| 24 | `GET /v1/version` | Anonymous | Ops | Build SHA, deploy timestamp |

**Error conventions.** All non-2xx responses return `{ error: { code, message, details? } }` where `code` is a stable string. The §2.2 step 3 ingestion-gate rejects surface the specific failing parameter (e.g., `INGESTION_WINDOW_FLOOR_LONG_EDGE`, `INGESTION_WINDOW_CEILING_MEGAPIXELS`, `INGESTION_FORMAT_NOT_JPEG`, `INGESTION_QUALITY_BELOW_Q90`, `INGESTION_ASPECT_OUT_OF_BAND`); founder-review rejections surface `REVIEW_TIER1_VIOLATION` or `REVIEW_TIER0_VIOLATION` (the unchecked-box decision codes); purchase-flow errors include `MJA_REQUIRED`, `LICENSE_REQUIRED`, `STRIPE_PAYMENT_FAILED`, `VARIANT_BUILD_FAILED`, `MINT_FAILED`; ownership-gated endpoints (Share Copy download, privacy-flip) reject non-owners with `E_IMAGE_NOT_OWNED`; auth errors include `MAGIC_DID_INVALID`, `ROLE_REQUIRED`.

### 3.8 State Machines

Three state machines govern MVP entity lifecycles. The `images` and `purchases` rows are mutated in place; the canonical record of state transitions is the row's status column plus its event-bearing timestamps (`published_at`, `deeds.minted_at`, `images.privacy_updated_at`) and the `takedown_reason` column on `images`. The image-lifecycle and privacy state machines run on the same `images` row but are orthogonal: `status` tracks the listing's commercial phase, `visibility` tracks the owner's public-surface choice post-sale. Forward-compatibility transitions (resale, takedown adjudication, Master download) are noted but not active at MVP; activation is deferred to MMP.

**Image lifecycle.** Each `images` row begins at creator upload acceptance and ends either by sale or by founder takedown.

| State | Set by | Description |
|---|---|---|
| `pending_review` | `POST /v1/creator/uploads` accepts the upload | Image in staging awaiting founder review (§2.2 step 5); creator ESIGN affirmation not yet collected; no image-id assigned; no encryption-at-rest yet |
| `draft` | `POST /v1/admin/reviews/:imageId` approves with both checkboxes checked | Founder-approved; following the creator's ESIGN affirmation (§2.2 step 6), backend assigns image-id, encrypts Original, builds Listing preview and Thumbnail; not yet on the public surface |
| `live` | `POST /v1/creator/images/:imageId/publish` | Public image page is up; Listing preview rendered; purchasable |
| `sold` | Crossmint `mint.succeeded` for a purchase against this listing | Image sold; deed minted; image page swaps from Listing preview to Share Copy variant |
| `taken_down` | Founder action via review submit (Tier 0 or Tier 1 violation) or post-mint admin tool in response to a report received via the mailto link | Public page returns 451; Listing preview suppressed; for Tier 0 violations the creator account is also suspended and the §2258A NCMEC CyberTipline subflow opens |
| `rights_disputed` (forward-compat) | DMCA, Take It Down Act, or RoP notice | Reserved; not active at MVP, since founder uses `taken_down` as a catch-all manual route |

| From | To | Trigger | Side effects |
|---|---|---|---|
| `pending_review` | `draft` | Founder approves via two-checkbox UI (§2.2 step 5) | Creates `image_reviews` row with `checks={tier0_clean:true, tier1_clean:true}`; creator emailed with resume-listing link |
| `pending_review` | `taken_down` | Founder leaves Tier 1 box unchecked at review submit | `takedown_reason='tier1_violation'`; staging upload deleted; creator emailed with parametric Tier 1 rejection |
| `pending_review` | `taken_down` | Founder leaves Tier 0 box unchecked at review submit | `takedown_reason='tier0_violation_ncmec_reported'`; staging image hash + metadata preserved 90-day minimum; creator account suspended; NCMEC CyberTipline checklist opens; §2258A report filed within 24-hour operational target |
| `draft` | `live` | Creator publishes via §2.2 step 9 | Sets `published_at` |
| `live` | `sold` | `mint.succeeded` for a purchase against this listing | The sale timestamp is recoverable from `deeds.minted_at` |
| `live` | `taken_down` | Founder records adverse finding via admin tool | `images.takedown_reason` populated with the rationale |
| `sold` | `taken_down` | Same as above, post-sale | Deed remains valid on-chain; public page suppressed |

**Purchase lifecycle.** Each `purchases` row begins at checkout init and ends in one of three terminal states: `confirmed`, `failed`, or `refunded`.

| State | Set by | Description |
|---|---|---|
| `started` | `POST /v1/purchases` creates the row | Stripe Checkout Session created; buyer at card-entry surface |
| `paid` | `payment_intent.succeeded` webhook | Card captured; 90 / 10 net amounts persisted to `purchases`; `runImageOps` spawned |
| `building` | `runImageOps` begins (§3.9) | Master encrypt, Arweave upload, Share Copy build, Share Copy build in progress |
| `minting` | `runImageOps` dispatches the Crossmint mint | Awaiting `mint.succeeded` or `mint.failed` callback |
| `confirmed` | `mint.succeeded` webhook | Terminal success; `deeds` row written; `images.status = sold` |
| `failed` | Any failure path | Terminal failure; `failure_reason` populated; `runStripeRefund` inline-called if past `paid` |
| `refunded` | `charge.refunded` webhook | Stripe charge fully refunded; row excluded from creator-earnings aggregation |

| From | To | Trigger | Side effects |
|---|---|---|---|
| `started` | `paid` | `payment_intent.succeeded` | 90 / 10 net amounts persisted; `runImageOps` spawned |
| `started` | `failed` | `payment_intent.payment_failed` | `failure_reason = STRIPE_PAYMENT_FAILED:<decline_code>`; no refund (no charge ever captured) |
| `paid` | `building` | `runImageOps` begins execution | None |
| `building` | `minting` | Master uploaded, Share Copy built | `images.arweave_uri` and `images.sha256` persisted; the Share Copy sha256 is held in memory and committed on-chain via `deeds.variant_hashes["E+01"]` at the mint transaction |
| `building` | `failed` | Cloudinary or Arweave retries exhausted | `failure_reason = VARIANT_BUILD_FAILED:<step>` or `ARWEAVE_UPLOAD_FAILED`; `runStripeRefund` inline-called |
| `minting` | `confirmed` | `mint.succeeded` | `deeds` row written; `images.status = sold` |
| `minting` | `failed` | `mint.failed` | `failure_reason = MINT_FAILED:<error_code>`; `runStripeRefund` inline-called |
| `failed` | `refunded` | `charge.refunded` | Row excluded from creator-earnings aggregation |

Forward-compat: at MMP the `confirmed` state extends with `sealed` and `opened` substates aligned to R62 §3.5.1 image-custody semantics (the `deed_state` field records whether the image is in platform-mediated custody or has been extracted by the holder). At MVP every `confirmed` purchase corresponds to a `sealed` image (the image is in platform custody; deed-holder Master download is deferred to MMP).

**Privacy lifecycle.** A second state machine on the same `images` row governs the public surface independently of `status`. The state is `images.visibility`, the timestamp is `images.privacy_updated_at`. Initial value is `public` at row creation (creator listings must be discoverable for buying); the machine becomes interesting only post-mint, when the post-mint hook flips it to `private` and the owner's Share is the only owner-driven path back to `public`.

| State | Set by | Description |
|---|---|---|
| `public` | Row creation (default) | Pre-sale listing or post-Share post-sale surface; renderer (§2.7) serves listing or Share Copy content |
| `private` | Post-mint hook (§2.4 step 15); post-transfer hook on resale (post-MVP) | Owner has not Shared; renderer serves the blank "image is private" Gallery stub to non-owner visitors |

| From | To | Trigger | Side effects |
|---|---|---|---|
| (none) | `public` | `POST /v1/creator/images/:imageId/publish` | Initial state on row creation |
| `public` | `private` | Post-mint hook fires after Crossmint `mint.succeeded` (§2.4 step 15) | Stamps `privacy_updated_at`; renderer flips to stub for non-owner visitors |
| `private` | `public` | Owner calls `POST /v1/images/:imageId/make-public` (§2.6) | Stamps `privacy_updated_at`; CDN cache purged for `image_id` |
| `public` | `private` (post-MVP) | Post-transfer hook fires on resale | Stamps `privacy_updated_at`; new owner makes their own one-way choice |
| `private` | `private` (post-MVP) | Post-transfer hook fires on resale when prior owner never Shared | Stamps `privacy_updated_at` to mark owner identity change |

Invariants: (i) `mint`-driven `public` -> `private` fires exactly once per `image_id` (one-of-one); (ii) `share`-driven `private` -> `public` is owner-authenticated, idempotent, and rejected from `public`; (iii) `transfer`-driven transitions always land in `private` regardless of source state; (iv) `privacy_updated_at` writes on every transition, including the no-op-value transfer (the owner identity changed, which is the analytics-relevant event). No API surface exposes the reverse direction (`public` -> `private`) to owners -> only the system-driven post-transfer hook resets it.

### 3.9 Async Operations

Two long-running operations run outside the request lifecycle because they exceed the Stripe webhook timeout (30 seconds) or are triggered from a callback that needs to return immediately. At MVP volume (~100 sales / month per §4.1; peak ~3 sales / day) the implementation primitive is **in-process async functions spawned by the relevant webhook handler after responding `200`** -> no SQLite jobs table, no polling worker, no external broker. The durable workflow state is on `purchases.status` (§3.8), so a crash mid-operation leaves a row stuck in `building` or `minting` that can be recovered at process startup. Retry policy lives inside the function (a `withRetry(fn, attempts, backoff)` helper wraps each external call).

| Operation | Triggered by | Steps | Retry policy (per external call) | On terminal failure |
|---|---|---|---|---|
| `runImageOps(purchaseId)` | `payment_intent.succeeded` handler responds `200`, then spawns this | (1) Decrypt Original via env-secret KEK unwrap of `DEK_image`. (2) Compute the Master sha256 of the canonical Master pixels and persist to `images.sha256`. (3) Encrypt the Master working copy with the same `DEK_image`; construct the doubly-nested deed-metadata ciphertext per R62 §2.3 Registry: inner = `encrypt(DEK_image, buyer_wallet_pubkey)`, outer = `encrypt(inner, platform_DEK)` -> `enc_final`. (4) Upload the encrypted Master to Arweave via ArDrive Turbo (§3.3); persist URI to `images.arweave_uri`. (5) Build the Share Copy through Cloudinary (§3.3); the Share Copy is a public-circulation variant delivered through the Cloudinary CDN per R62 §7.4 and is not on-chain-anchored, so no sha256 is recorded for it. (6) Dispatch the Crossmint mint with the arweave_uri, `enc_final`, and variant_hashes (`{"M+00": {"sha256": <images.sha256>, "anchored_at": <mint_tx_block_time>}}`) payload; on `mint.succeeded` the deeds row is written with `variant_hashes` mirroring the on-chain record. State transitions: `paid` -> `building` -> `minting` | Up to 3 attempts per failing external call with exponential backoff (1s, 4s, 16s); Cloudinary retries are step-local; the ArDrive Turbo SDK retries Arweave uploads internally before surfacing | Set `purchases.status = failed` with `failure_reason = VARIANT_BUILD_FAILED:<step>` or `ARWEAVE_UPLOAD_FAILED`; inline-call `runStripeRefund(purchaseId)` |
| `runStripeRefund(purchaseId)` | `runImageOps` terminal failure (inline call) OR `mint.failed` webhook handler (after responding `200`) | (1) Call `stripe.refunds.create({ payment_intent: <id>, reason: 'requested_by_customer' })` with idempotency key set to `purchases.id`. (2) Await `charge.refunded` webhook (handled separately by §3.3). (3) Founder alert via Sentry (§3.2) | Up to 5 attempts with 30s backoff inside the function | Append refund-failure suffix to `purchases.failure_reason`; founder paged via Sentry escalation; manual reconciliation required |

The Crossmint mint completion (`mint.succeeded` and `mint.failed`) is callback-driven via the webhook at `POST /v1/webhooks/crossmint` (§3.7 row 22); `runImageOps` ends at step 6 with the mint dispatched, and the webhook handler owns the `minting` -> `confirmed` or `minting` -> `failed` transition and the `deeds` row write.

**Crash recovery.** On process startup, the application runs a single recovery query: `SELECT id FROM purchases WHERE status IN ('paid', 'building', 'minting') AND updated_at < now() - interval '5 min'`. Each matching row is re-spawned through `runImageOps`. The work is idempotent because each step checks the row's current state (e.g., if `images.arweave_uri` is already populated, skip the upload) and external operations are idempotent against the relevant external id (Crossmint mint dispatch is idempotent against `purchases.id` carried in the request metadata).

**MMP migration.** At MMP scale (~1,000 sales / day) the in-process model migrates to a real queue (BullMQ on Redis or equivalent). The migration is mechanical: the `runImageOps` and `runStripeRefund` function bodies stay; their callers change from `runImageOps(purchaseId).catch(handler)` to `imageOpsQueue.add({ purchaseId })`. The workflow state on `purchases.status` and the recovery query remain unchanged.

---

## 4. SUCCESS METRICS

### 4.1 Quantitative Thresholds

| Metric | Threshold (30-day measurement) | Measurement Method |
|---|---|---|
| Image sales (30-day measurement) | Floor 50; target 100 (10 active creators × 10 sales / month) | Count of completed image sales in the 30-day measurement window |
| Unique paying buyers (30-day measurement) | Floor 50; target 100 (equal to image sales count; average 1 image sale per buyer) | Count of distinct buyer wallets with at least one purchase in the measurement window |
| Repeat-purchase signal | Non-zero | Count of buyers with two or more purchases in the measurement window |
| Link-click-to-purchase conversion | At least 3% of unique link clicks complete a purchase | UTM-tagged per-creator-per-post shareable links instrument funnel points captured as Plausible custom events: image-page visit, Sign In click, Buy click, OAuth completion, purchase complete, plus backend `payment_intent.succeeded`. Compound click-to-purchase ratio is the headline metric; click-to-signup, signup-to-Buy, Buy-to-purchase tracked as decomposition |
| Listing-to-sale conversion | At least 40% of live listings convert to an image sale within the 30-day measurement window | Count of image sales divided by count of live listings at measurement-window end |
| Payment success rate | At least 98% of Stripe payment intents settle without unrecovered failure | Stripe dashboard `payment_intent.succeeded` divided by `payment_intent.created` |
| Deed-holder viewing reliability | At least 99% of deed-holder access attempts on owned deeds render within 5 seconds | Backend instrumentation on the renderer endpoint |
| Deed-state correctness | Zero deeds in an incorrect state (sealed / rights-disputed / void / burned mismatch) | Manual audit at measurement-window end against Solana on-chain state |
| Net Promoter Score | Creator NPS ≥ 40; Buyer NPS ≥ 30 | Post-measurement-window survey to every creator and a sampled cross-section of buyers |
| Payout cadence | Creator payouts execute every 4 weeks from the launch date with no missed cycle | Stripe Connect payout timestamps |

### 4.2 Qualitative Signals

| Signal | What It Tells Us |
|---|---|
| Unprompted creator referrals of other creators | The value proposition is legible enough to recommend without scripting |
| Buyer return purchase from a different creator on the platform | The platform identity, not just the creator identity, has buy-side pull |
| Buyer requests to display the deed on a public surface beyond the image page | The artifact has gained ornamental and signaling value |
| Press or social mentions referencing "epimage.com" by name | Brand surface is forming |
| Founder-recorded objection categories from declined creators | Sharpens the ongoing recruiting filter |

### 4.3 Failure Triggers (MVP Halt Conditions)

| Trigger | Action |
|---|---|
| Confirmed CSAM mint that escaped PhotoDNA | Immediate platform pause; §2258A report; law-enforcement coordination; full incident review |
| Unauthorized Master Image leak attributable to platform infrastructure | Immediate platform pause; forensic review of encryption pipeline; deed-state mutation for affected deeds |
| Three or more unrecovered Stripe payments within a 7-day window | Pause new purchases; engage Stripe support; resume on resolution |
| Variant build failure after payment but before mint (§2.4 steps 11-13) | Retry the failing Cloudinary call up to 3 times; on full failure, auto-refund the Stripe charge, set `purchases.status = refunded` (row drops out of creator-earnings aggregation), alert founder; no deed is minted |
| Solana mainnet outage exceeding 24 hours | Pause new purchases; communicate with cohort; resume on network recovery |
| Magic SDK key compromise affecting any wallet in the cohort | Immediate platform pause; key rotation across the cohort; deed-state mutation for affected deeds |

---

## 5. INFRASTRUCTURE & ON-CHAIN PRIMITIVES

### 5.1 On-Chain Primitives (Solana)

| Primitive | Source | Purpose |
|---|---|---|
| Deed NFT | Metaplex Core NFT (standard program by Metaplex Foundation) | One-of-one mint; metadata; consumed via Crossmint API at MVP |
| Deed-State Mutations | Metaplex Core plugins (FreezeDelegate, UpdateDelegate, BurnDelegate) | sealed / rights-disputed / void / burned transitions via standard plugin instructions; founder key as the relevant authority (multi-sig deferred to post-MVP) |
| Multi-Recipient Royalties | Metaplex Core royalty plugin (reserved) | Configured but inactive at MVP (no secondary market); activates post-MVP with resale |

No custom Anchor programs are deployed at MVP. All on-chain capability comes from Metaplex Core's standard program; Gallery's custom logic lives in the off-chain backend (deed-state cache in SQLite, founder-signed plugin dispatch via Crossmint).

### 5.2 Infrastructure

| Component | Provider |
|---|---|
| Hosting | Render (managed Node.js service + persistent disk; git-push deploy from GitHub; automatic TLS via Let's Encrypt; automatic daily disk snapshots; dashboard-managed env vars) |
| Image CDN | Cloudinary |
| Original Storage | Application server local filesystem + env-secret-held KEK (encryption-at-rest of Original via AES-256-GCM with per-image `DEK_image`; image-id as filename; canonical workhorse for variant builds; offsite backup via cron rsync) |
| Permanent Storage | Arweave via ArDrive Turbo bundler (paid managed provider; FIAT credit-card top-up; production-grade upload reliability; on-Arweave Master only; license-survival receipt) |
| Database | SQLite (single-file local database at `/var/data/gallery.db` on the Render persistent disk; co-located with the application server) |
| Monitoring | Render built-in logs + service metrics, Sentry (free tier) for exception capture and release tracking, Pino structured JSON logging from the Node.js process at MVP launch (Cloudflare edge protection, Litestream continuous SQLite backup, and Better Uptime external monitoring deferred to post-launch) |
| Secrets | Render environment variables (dashboard-managed; holds the platform KEK, third-party API keys, DB URL, signer-key material) |
| Source Code | Monorepo with pnpm workspaces (single Git repository on GitHub; workspace packages for frontend, backend, and shared TypeScript types) |

**Application-specific environment variables.** `PLATFORM_KEK` (32-byte hex-encoded server-side KEK that wraps every `DEK_image`; rotation procedure deferred to MMP), `BASE_URL` (canonical site URL, `https://epimage.com` in production; used in OG tags, OAuth callbacks, and the `epima.ge` redirect target), `ORIGINAL_STORE_DIR` (filesystem path for encrypted Original custody, `/var/originals`). All third-party service credentials follow their respective vendor's standard env-var names as referenced in §3.3 (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `MAGIC_SECRET_KEY`, `MAGIC_PUBLISHABLE_KEY`, `CROSSMINT_API_KEY`, `CROSSMINT_WEBHOOK_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `ARDRIVE_TURBO_TOKEN`, `SENTRY_DSN`), plus `DATABASE_URL` for Prisma per Appendix C. `NODE_ENV` and `PORT` follow Node / Render conventions and are not application-defined.

---

## 6. COMPLIANCE POSTURE

### 6.1 Statutory Day-1 Obligations

These obligations apply on the first day a public deed exists and are non-negotiable at MVP scope.

| Obligation | Implementation |
|---|---|
| CSAM screening | Founder manual review (§2.2 step 5) Tier 0 checkbox covers CSAM identification at ingestion; uncheck triggers immediate creator account lock, staging hash + metadata preservation (90-day minimum), and the NCMEC CyberTipline submission flow. The §2258A "actual knowledge" standard is satisfied by founder review as the knowledge-acquisition mechanism |
| §2258A CyberTipline reporting | NCMEC report filed within 24-hour operational target on Tier 0 review uncheck or post-mint CSAM identification (60-day statutory ceiling) |
| Take It Down Act compliance | Founder review Tier 0 checkbox at ingestion covers NCII identification; 48-hour federal NCII takedown procedure with operator on-call coverage covers post-mint complaints |
| State NCII compliance | CA Civ Code §1708.86 and NY §52-b takedown procedures |
| DMCA §512 designated agent | Registered with the U.S. Copyright Office before public launch |
| OFAC sanctions and SDN screening | Stripe payment-rail OFAC and SDN screening at the buyer side (Visa / Mastercard card networks do not issue cards in OFAC-sanctioned regions; Stripe Radar applies SDN list at payment-instrument level); Stripe Connect KYC OFAC and SDN screening at the creator side once Connect Express activates immediate post-launch; founder-direct manual vetting of the 10-creator cohort during the MVP-launch interim period |
| Stripe Connect creator KYC | Identity and OFAC screening performed by Stripe at creator's Connect Express onboarding (immediate post-MVP-launch feature); 1099-K issued by Stripe based on Connect payouts |
| 1099-K reporting | Filed via Stripe Connect 1099 tax reporting product once Connect Express is live (immediate post-launch); during MVP-launch interim period, earnings accrue without payout and no 1099 obligations are triggered |
| ESIGN per-image signature | Click-wrap with logged event metadata at creator upload (expanded authorship + AI non-generation + RoP rights + sole-copy + listing authorization affirmation per §2.2 step 6) and at buyer checkout (License Acceptance) |
| 17 USC §202 and UCC Article 12 framing | Terms of sale separate copyright (creator-retained) from object ownership (buyer-acquired); Delaware governing-law clause designates a UCC Article 12 enacting state |
| GDPR / CCPA cookie disclosure | MVP stack uses essential-only cookies (session, CSRF, Stripe payment session, Magic SDK auth); Plausible analytics is cookie-free and does not require consent under GDPR / ePrivacy; no consent banner required at MVP. Privacy Policy discloses essential-cookies-only posture and Plausible's no-personal-data posture. DSAR requests handled via manual email-to-Elanoid at MVP volume; Enzuzo DSAR portal and CMP banner deferred to MMP if additional tooling adds non-essential cookies |
| Right-of-publicity disclosure regime | Creator contractual warranty under CMA and the expanded per-image Image Signing Affirmation (§2.2 step 6) attests rights to all depicted persons; affirmative model-release intake offered as creator self-service workflow when needed; takedown pathway covers incoming right-of-publicity claims |

The founder review at §2.2 step 5 is the platform's content gate at MVP scope. The closed, founder-vetted cohort of 10 publicly-identified 100K+ YouTuber creators with verified channels makes the manual review operationally tractable (3-4 uploads / day, ~10 seconds per image), and the §2258A obligation triggers on actual knowledge regardless of whether that knowledge is acquired by automated hash match or by human review. The Tier 2 dimensions (AI authenticity, right-of-publicity, sole-copy) are carried by the expanded creator ESIGN affirmation as contractual representations enforceable through CMA breach, account suspension, and royalty forfeiture; pre-mint operational screening for these dimensions is not load-bearing at the 10-creator scope. The variant pipeline re-encodes every served image through Cloudinary's image library, which strips embedded payloads from the underlying file -> the structural malware mitigation at MVP, since automated AV signature scanning is deferred to MMP.

The judgment-based automated gates that Elanoid will run at scale (PhotoDNA CSAM hash matching, Thorn Safer AI-CSAM, a dedicated NCII classifier, Hive parallel adult-content classifier, PimEyes-class right-of-publicity face detection, near-duplicate and semantic-similarity uniqueness detection, deepfake / synthetic-origin classifier, aesthetic scoring) activate at MMP when creator self-signup opens the cohort and manual review no longer scales. Their activation timing is tied to the self-service buildout rather than the MVP launch. Multi-sig deed-state mutation, codified per-regime takedown dispatch UI, and chargeback automation are operational shortcuts deferred to post-MVP: single-key founder signer authorizes deed-state mutations; chargebacks are handled in the Stripe dashboard (pre-mint dispute cancels the mint job; post-mint dispute mutates deed_state to void); takedown tickets are reviewed in-house against the underlying legal regime.

### 6.2 Legal Documents

| Document | Trigger | Function |
|---|---|---|
| Creator Master Agreement (CMA) | Creator signup | Identity, ownership, platform terms warranties; ESIGN-compliant |
| Master Joint Agreement (MJA) | First buyer signup | Platform-buyer relationship terms: ToS, dispute resolution, RUFADAA posture, takedown clause, no-reliance Howey defense, baseline warranty disclaimers |
| Per-Image Buyer License Acceptance | Every purchase | ESIGN signature on the specific license terms attached to this image (field of use, territory, term, commercial-use permission, sublicensing, derivative rights, display permissions); binds to deed at mint |
| Image Signing Affirmation | Every upload | Per-image single-click ESIGN signature combining authorship attestation and platform-mediated mint authorization; the affirmation runs on the creator's source work |
| Sole Copy Agreement | Every upload (after Image Signing Affirmation) | Click-wrap commitment to source-file destruction as buyer-trust commitment; pairs with platform-side Original custody as the uniqueness architecture |
| Terms of Service | Site visit and signup | Arbitration, no-refund policy (MVP sales are final; the only money-back paths are auto-reversal of a failed mint and buyer-initiated card chargebacks), takedown procedure |
| Privacy Policy | Site visit | GDPR / CCPA data handling disclosure including essential-cookies-only posture and Plausible analytics disclosure (cookie-free, no personal data collected) |

---

## 7. CONCLUSIONS

The MVP exercises every load-bearing protocol element under real money flow: encrypted Arweave custody (Registry), Solana mint (Registry), per-owner monogrammed rendering (Commerce), ESIGN at upload and checkout (Certification), Stripe 90 / 10 split persisted on `purchases` at MVP launch (Connect Express transfers post-launch). The three-function architecture from R62 §1 is preserved end-to-end: §3.1 maps the 9 deployable subsystems onto Certification, Commerce, and Registry with the boundaries recoverable at MMP scale-out. Image ingestion is deliberately narrowed to a single JPEG format within a window (§1.3) bounded below by the 11x14 print-quality target and above by the Cloudinary transformation ceiling, which removes the file-size and format ambiguity carried by earlier drafts. The image's sealed / opened state (per R62 §3.5.1, recorded as `deed_state`) is `sealed` for every MVP deed since deed-holder Master download is deferred to MMP. Moderation rests on founder manual review of Tier 0 (CSAM, NCII) and Tier 1 (adult, violence, hate, drugs) through a two-checkbox UI at §2.2 step 5, with Tier 0 uncheck triggering the §2258A NCMEC reporting subflow; Tier 2 dimensions (AI authenticity, right-of-publicity, sole-copy) are carried by the expanded creator ESIGN affirmation at §2.2 step 6 as contractual representations. Automated PhotoDNA, Thorn, and Hive integrations are deferred to MMP when creator self-signup opens the cohort and human review no longer scales. The 30-day measurement produces fundraising-kickoff data; operations continue until MMP launch with live-momentum metrics. Measurement success green-lights the self-service buildout (production classifiers, multi-sig, secondary market, editions, embeddable checkout, mobile app).

---

## APPENDIX A: DEVELOPMENT EFFORT ESTIMATE

### A.1 Methodology

The estimate is a per-feature decomposition of R71's §1.1 in-scope features and §2.x workflows. Per-feature hours reflect an AI-assisted solo-founder development environment (Claude Code in VS Code IDE + GitHub Spec Kit, 0.65-0.7x of baseline AI-assisted hours for AI-amenable work: CRUD, integrations, schema, UI from spec, tests). Hour-allocation conventions: simple UI component or form 4-8 hrs; standard CRUD endpoint 4-8 hrs; documented-SDK API integration 6-12 hrs; custom state-managed logic 8-15 hrs; cryptographic or sensitive flows 15-20 hrs; multi-system orchestration 10-15 hrs.

The 21% contingency reflects solo-execution uncertainty and MVP-grade scope refinement (slightly higher than the production 20% contingency convention). Substrate items (Magic SDK, CI/CD pipeline, database patterns, auth middleware, compliance log retention) reuse to Membership and Studio at zero incremental cost post-launch.

**Note on Stripe Connect Express.** Creator-side Stripe Connect Express onboarding and automated payouts are deferred to the immediate post-launch buildout. Earnings accrue in Elanoid's Stripe balance from launch and the first payout lands at the 4-week mark via Connect Express, so no creator-payment integration dev work falls inside the 369-hour total MVP estimate.

### A.2 Core Development

| Area | Feature | Hours |
|---|---|---:|
| **Frontend** | | |
| | React SPA scaffold (Vite + Tailwind + auth wrapper) | 8 |
| | Auth UI with OAuth + Magic SDK silent wallet provisioning (creator + buyer) | 6 |
| | Creator onboarding flow (3 steps: OAuth + silent wallet -> CMA click-wrap -> ready) and buyer inline onboarding within Buy flow (2 user-facing steps: OAuth + silent wallet -> bundled MJA + License Acceptance click-wrap) | 6 |
| | Upload flow UI (file selection, gate progress, per-image ESIGN, listing metadata, price) | 12 |
| | Deed page with basic anti-save rendering (right-click disabled, user-select:none, drag suppression) | 10 |
| | Buyer Collection view + Owner Share Copy download (JPEG / PNG) | 10 |
| | Shareable link workflow + OG / Twitter Card meta | 5 |
| | Account settings (creator + owner profile, deactivation) | 2 |
| | **Frontend Subtotal** | **59** |
| **Backend** | | |
| | Express API scaffold + middleware | 4 |
| | Magic SDK verification middleware for authenticated routes | 4 |
| | Image upload + founder review workflow (`POST /v1/creator/uploads` -> pending_review queue, state transitions, email notifications on decision) | 8 |
| | Founder review surface (queue dashboard `GET /v1/admin/reviews` + two-checkbox decision UI `POST /v1/admin/reviews/:imageId` + Tier 0 NCMEC subflow with account lock + evidence preservation) | 12 |
| | Listing CRUD service (deed-holder / public render routing, ownership-gated access) | 8 |
| | Stripe Embedded Checkout backend session + webhook handler (payment_intent -> mint) | 14 |
| | Crossmint Minting API integration (Metaplex Core NFT dispatch with auto-refund on failure) | 12 |
| | Original custody service (AES-256-GCM with `DEK_image`, env-secret-held KEK, local-FS persistence with image-id filename, controlled decryption for variant builds) | 7 |
| | On-Arweave Master build at Card 5 (decrypt Original via `DEK_image` platform-KEK unwrap, compute sha256, mint-authority Solana write of variant sha256 to deed metadata, encrypt with same `DEK_image`, construct doubly-nested `enc_final = encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)` and add to deed metadata per R62 §2.3 Registry, upload via @ardrive/turbo-sdk) | 10 |
| | Owner verification (deed read via Crossmint NFT lookup API + state check) | 6 |
| | 90 / 10 split tracked on `purchases` net-amount columns; aggregated from purchases for creator dashboard; accrues in Elanoid Stripe balance | 4 |
| | Image quality gate (resolution, format, color depth, file size, aspect ratio) | 8 |
| | Founder admin dashboard (lightweight: earnings, disputes, kill switches for 10 creators) | 3 |
| | Disputes queue + per-creator kill switch (admin tool) | 3 |
| | Multi-state deed state machine (sealed / rights-disputed / void / burned, single-signer) | 6 |
| | Share Copy server-side composition pipeline (decrypt Original from local FS; Share Copy = AI-crop + in-pixel URL text along lower-right vertical edge + monogram; buyer monogram default-or-override; compute sha256 for the Master only; Share Copy delivered through Cloudinary CDN, not on-chain-anchored per R62 §7.4) | 6 |
| | **Backend Subtotal** | **115** |
| **Blockchain** | | |
| | Owner-verification glue (Crossmint NFT lookup API) | 4 |
| | Deed metadata schema (Arweave URI; doubly-nested `enc_final`; M content hash; deed_state; royalty_pct; royalty_recipients; creator; mint date per §2.4 step 14) | 4 |
| | Metaplex Core NFT mint configuration | 4 |
| | **Blockchain Subtotal** | **12** |
| **Integrations** | | |
| | Stripe Embedded Checkout (no Stripe Tax setup at MVP) | 10 |
| | Magic SDK (silent wallet provisioning, key export) | 8 |
| | Local-FS Original storage + offsite backup cron (directory setup, env-secret KEK provisioning, rsync to offsite bucket) | 2 |
| | Stripe Radar fraud rules | 2 |
| | Arweave (one-shot encrypted on-Arweave Master upload at Card 5; arweave-js integration) | 4 |
| | Plausible analytics (script integration + custom funnel events: signup, Buy click, purchase complete, Report click) | 3 |
| | **Integrations Subtotal** | **29** |
| **Infrastructure** | | |
| | CI/CD pipeline (GitHub Actions -> Vercel + Railway) | 6 |
| | SQLite single-file DB (file-level setup, daily backup to offsite) | 4 |
| | DB schemas (users, creator_allowlist, creators, owners, images, image_reviews, purchases, deeds, signatures) | 9 |
| | Env-based secrets management | 2 |
| | Sentry error monitoring | 3 |
| | Compliance attestation log retention | 2 |
| | **Infrastructure Subtotal** | **26** |
| **Core Total** | | **241** |

The largest single line items are the founder review surface (12 hrs, the two-checkbox UI + Tier 0 NCMEC subflow + account-lock + evidence preservation), Stripe Embedded Checkout backend + webhook handler (14 hrs, the payment + mint trigger orchestration), and Crossmint Minting API integration (12 hrs, the Metaplex Core NFT dispatch path). The cryptographic surface is split across the Original custody service (10 hrs), the on-Arweave Master build at Card 5 (10 hrs), and the Arweave integration (4 hrs) for 24 hrs total. Image upload + founder review workflow (8 hrs) coordinates the asynchronous queue between creator upload and creator ESIGN.

### A.3 Other Categories

| Category | Hours |
|---|---:|
| UI / UX (Figma + founder review) | 18 |
| Testing (smoke + integration + UAT) | 25 |
| Tech Lead (architecture, code review, vendor coordination) | 22 |
| Documentation | 4 |
| **Other Subtotal** | **69** |

UI / UX covers the limited surfaces in R71: upload, image page, collection, account settings, admin (including the founder review queue and two-checkbox decision UI). Testing is automated smoke + integration coverage plus manual UAT for the 10-creator pilot launch. Tech Lead handles solo-founder context plus coordination across Stripe, Magic, Crossmint, and Arweave. Documentation is inline code docs + README only; investor / partner-facing docs are out of scope at MVP.

### A.4 Summary

| Category | Hours |
|---|---:|
| Core Development | 241 |
| Other Categories | 69 |
| **Base Subtotal** | **310** |
| Contingency (21%) | 65 |
| **TOTAL with Contingency** | **375** |

**R71 = 375 hours total** with 21% contingency. For reference, the production-grade MMP estimate (R61 §3.7) is 2,203 base / 2,643 with 20% contingency; R71 is approximately **14% of MMP**, reflecting the MVP's narrow 10-creator launch scope, deferred features (Stripe Connect Express, Vault, Public Creator Page, sophisticated anti-save renderer, embedded XMP / IPTC metadata, full automated classifier pipeline -> PhotoDNA / Thorn / Hive, multi-sig, embeddable checkout button, deed-holder Master download, etc.), and MVP-grade rather than production-grade per-feature rigor. The R71 total is +6 hours over the prior automated-gate baseline (369 hrs): the founder review surface adds 20 hrs of build (queue + two-checkbox UI + Tier 0 NCMEC subflow + image_reviews schema), and removing PhotoDNA + Hive integration recovers ~16 hrs, with the 4-hour net delta absorbing the workflow / state-machine changes. The trade is favorable: the founder-review path removes the 2-6 week PhotoDNA vetting wait from the critical path and eliminates vendor cost at MVP. The on-chain variant-attestation covers Master Image only per R62 §7.4 (public-circulation variants -> Listing preview, Thumbnail, Share Copy -> route through the off-chain match engine and, for the Share Copy, the in-pixel URL text); the invisible watermark and the perceptual-hash layer are out of scope, and the near-duplicate match and semantic-similarity services (R62 §6.2) are post-MVP and not integrated at this stage.

### A.5 Calendar Estimates

| Team Composition | Base | With Contingency |
|---|---:|---:|
| 1 founder solo (Claude Code + Spec Kit, 50 hrs / week) | 6.4 weeks (1.4 months) | 7.7 weeks (1.8 months) |
| 1 tech lead + 2 devs + 1 designer (120 hrs / week effective) | 2.6 weeks (0.6 months) | 3.2 weeks (0.7 months) |
| 1 tech lead + 4 devs + 1 designer + 1 QA (240 hrs / week effective) | 1.3 weeks (0.3 months) | 1.6 weeks (0.4 months) |

Solo founder execution is the most realistic baseline given Elanoid's current cap-table posture. Team-build durations assume senior engineers with prior Solana, Stripe, React, Crossmint, and content-moderation experience. A small team accelerates calendar but does not reduce total hours.

---

## APPENDIX B: VALIDATION CONTEXT AND COHORT

The Gallery MVP is the smallest scope that exercises every load-bearing element of Elanoid's digital ownership protocol under real money flow before Elanoid commits to a multi-quarter self-service production buildout. The goal is **product validation** -> testing two behavioral hypotheses (creators will produce signed limited-edition photo merch when given the deed primitive, and fans will buy those photos as collectibles to support the creators they follow) and producing a data-driven GMV estimate from creator-set pricing as a baseline for MMP-scale projections. PMF and market validation are MMP responsibilities; the MVP's responsibility is to demonstrate the deed thesis works behaviorally under real conditions. Load-bearing elements include server-side Original custody (local-FS encryption-at-rest with `DEK_image` and env-secret KEK), one-of-one Solana NFT mint with on-Arweave Master as license-survival receipt, deed-holder Share Copy variants built from Original with a per-owner monogram at personalization, public-render path via Cloudinary-delivered Share Copy variant, ESIGN per-image signatures, Sole Copy commitment, and Stripe fiat payments with the 90 / 10 split persisted on `purchases`.

### B.1 MVP Goal, Objectives, and Validation Framework

The MVP validates two behavioral hypotheses under real money flow and produces one quantitative estimate:

1. Creators (100K+ subscriber YouTubers) are willing to produce high-quality photos and directly sell them to fans through social media as a new income stream. Validation = creators ship listings at sustainable cadence (target 10 image sales / creator / month at $50 average).
2. Fans of those creators purchase photos as collectible artifacts to support the creators they follow. Validation = buyers complete fiat purchases at listed prices and download or share the artifact.
3. Creator-set pricing produces a defensible GMV estimate for MMP-scale projections. Creators set fixed prices in the $20 - $2,000 range (per B.2); the realized price distribution and aggregate 30-day GMV calibrate downstream financial models (R66 §5, R70 §1.4). Output = realized price distribution and total GMV from the 100-sale cohort.

**Out of MVP scope:** Statistical validation of legal-commitment correctness (Howey defenses, ESIGN per-image signatures, UCC Article 12 controllable-electronic-record transfer, 17 USC §202 copyright / object split) and integration robustness (Crossmint mint, Arweave upload, Stripe payout, Magic SDK key recovery, Solana RPC degradation). Both require scale beyond 100 sales to surface corner cases statistically and are MMP responsibilities. The MVP must still operate without unrecovered failures during the measurement window as basic operational hygiene, but operational hygiene is not a validation goal.

**Privacy-default trade-off.** The §2.6 owner privacy posture (default `private` at mint, one-way Share to `public`) is owner-control-first by design and is the user-trust contract for the feature. The trade-off is that buyer-side viral discovery (passive social acquisition via per-deed shareable URLs and OG / Twitter Card unfurls on buyer-shared links) is opt-in rather than automatic: until an owner clicks Share, the per-deed URL renders the private stub and generic OG metadata, contributing nothing to creator-side acquisition flywheel. For the 30-day $5K GMV / ≥40% conversion targets, founder-direct outreach to the first cohort of buyers asking them to Share for validation surface area is the recommended workaround; the realized Share rate is itself a behavioral signal worth measuring (high Share rate validates collectible-display intent; low Share rate validates private-collection intent, both informative for MMP). The Share-lag analytics (time from mint to first Share, derived from `images.privacy_updated_at`) feeds the MMP discovery-architecture decision in R66.

### B.2 Cohort and Operating Window

| Dimension | Specification |
|---|---|
| Operating entity | Elanoid (Delaware C-Corp); sole legal party |
| Active creator count | 10 founder-recruited creators (founder-direct outreach; onboarding by hand) |
| Creator profile | 100K+ YouTube subscribers; visual or photographic output; English-language primary audience |
| Buyer cohort | buyers acquired via creator-shared social links; 100 active paying buyers (equal to target image sales; average 1 image sale per buyer) |
| Measurement window | 30 days from first creator go-live; produces the fundraising-kickoff data snapshot |
| Continued operation | MVP remains live under same cohort, posture, and compliance stack until MMP launch |
| Target image sales (30-day measurement) | 100 image sales (10 creators × 10 sales / month) |
| Average expected image sale price | $50 |
| Target gross-merchandise volume (30-day measurement) | $5,000 fiat |
| Image sale price range | $20 - $2,000; creator-set fixed price |
| Geographic coverage | United States + EU + Canada + UK + Australia; remaining regions blocked at edge |
| Network | Solana mainnet (devnet smoke tests in pre-launch week) |

The 30-day measurement window starts on first creator go-live and produces the fundraising-kickoff data snapshot. The MVP does not close at the end of the measurement window; operations continue under the same cohort, posture, and compliance stack until MMP launch. The §5 thresholds are evaluated against the 30-day snapshot; sustained operation thereafter supplies retention, repeat-purchase, and live-momentum metrics into the investor data room.


## APPENDIX C: PRISMA SCHEMA

The Prisma schema below is the canonical implementation of the data model in §3.6. Where they differ, §3.6 is authoritative and this file should be updated to match. Conventions: snake_case columns mapped to camelCase Prisma fields via `@map`; UUID primary keys generated at app level via `@default(uuid())`; timestamps via `@default(now())` / `@updatedAt`; status / enum columns implemented as `String` with allowed values documented in comments (SQLite + Prisma does not support native enums); JSON columns use Prisma's `Json` type (stored as TEXT in SQLite); foreign-key `onDelete` defaults to `Restrict` (prevents deletion of referenced rows; no MVP cascade cases). Indices match the §3.6 indices list.

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// Identity layer; one row per Magic DID
model User {
  userId         String   @id @default(uuid()) @map("user_id")
  magicDid       String   @unique @map("magic_did")
  email          String   @unique
  walletAddress  String?  @unique @map("wallet_address")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  creator           Creator?
  owner             Owner?
  signatures        Signature[]
  purchasesAsSeller Purchase[]      @relation("PurchaseSeller")
  reviewerImageReviews ImageReview[] @relation("ReviewerImageReviews")

  @@index([magicDid])
  @@index([walletAddress])
  @@map("users")
}

// Founder-curated gate for creator onboarding; populated manually per §2.1
model CreatorAllowlist {
  email     String   @id
  createdAt DateTime @default(now()) @map("created_at")

  @@map("creator_allowlist")
}

// Profile + legal identity for the CREATOR role; existence is the role grant
model Creator {
  userId                 String   @id @map("user_id")
  displayName            String   @map("display_name")
  legalName              String   @map("legal_name")
  legalAddress           Json     @map("legal_address")
  entityType             String   @map("entity_type")            // individual | llc | corp
  youtubeChannelHandle   String?  @map("youtube_channel_handle")
  stripeConnectAccountId String?  @map("stripe_connect_account_id")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  user   User    @relation(fields: [userId], references: [userId], onDelete: Restrict)
  images Image[]

  @@map("creators")
}

// Profile for the OWNER role; existence is the role grant
model Owner {
  userId           String   @id @map("user_id")
  stripeCustomerId String?  @map("stripe_customer_id")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  user      User       @relation(fields: [userId], references: [userId], onDelete: Restrict)
  purchases Purchase[]
  deeds     Deed[]

  @@index([stripeCustomerId])
  @@map("owners")
}

// One row per uploaded image
model Image {
  imageId             String    @id @map("image_id")                  // 5-char base-36, R62 §2.3
  creatorId           String    @map("creator_id")
  title               String
  description         String?
  creationDate        DateTime  @map("creation_date")
  listedPrice         Int       @map("listed_price")                  // cents, $20-$2000 range
  sha256              String                                          // canonical content hash
  status              String                                          // pending_review | draft | live | sold | taken_down | rights_disputed
  visibility          String    @default("public")                    // public | private; §2.6 / §3.8 privacy state machine
  privacyUpdatedAt    DateTime? @map("privacy_updated_at")            // updated on every visibility transition
  takedownReason      String?   @map("takedown_reason")
  cloudinaryStagingId String?   @map("cloudinary_staging_id")
  arweaveUri          String?   @map("arweave_uri")                   // populated at mint
  signingEventId      String?   @map("signing_event_id")              // refs Signature.signingEventId; nullable while images.status = pending_review (creator ESIGN affirmation not yet collected)
  publishedAt         DateTime? @map("published_at")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")

  creator        Creator        @relation(fields: [creatorId], references: [userId], onDelete: Restrict)
  deed           Deed?
  purchases      Purchase[]
  signatures     Signature[]
  reviews        ImageReview[]

  @@index([creatorId, status])
  @@index([status, publishedAt(sort: Desc)])
  @@index([status])                                                   // founder review queue (status = pending_review)
  @@map("images")
}

// Founder review decision log per §2.2 step 5; one row per review event
model ImageReview {
  id                  String    @id @default(uuid())
  imageId             String    @map("image_id")
  reviewerId          String    @map("reviewer_id")
  decision            String                                          // approved | rejected_tier1 | rejected_tier0
  checks              Json                                            // {"tier0_clean": bool, "tier1_clean": bool}
  ncmecReportFiledAt  DateTime? @map("ncmec_report_filed_at")         // populated when Tier 0 subflow files NCMEC CyberTipline report
  decidedAt           DateTime  @default(now()) @map("decided_at")

  image    Image @relation(fields: [imageId], references: [imageId], onDelete: Restrict)
  reviewer User  @relation("ReviewerImageReviews", fields: [reviewerId], references: [userId], onDelete: Restrict)

  @@index([imageId])
  @@map("image_reviews")
}

// One row per purchase attempt
model Purchase {
  id                     String   @id @default(uuid())
  imageId                String   @map("image_id")
  ownerId                String   @map("owner_id")
  sellerUserId           String   @map("seller_user_id")
  stripePaymentIntentId  String?  @unique @map("stripe_payment_intent_id")
  status                 String                                       // started | paid | confirmed | failed | refunded
  amountGrossCents       Int      @map("amount_gross_cents")
  amountCreatorNetCents  Int?     @map("amount_creator_net_cents")
  amountPlatformNetCents Int?     @map("amount_platform_net_cents")
  monogramText           String?  @map("monogram_text")
  deedMintTxSignature    String?  @map("deed_mint_tx_signature")
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  image  Image @relation(fields: [imageId], references: [imageId], onDelete: Restrict)
  owner  Owner @relation(fields: [ownerId], references: [userId], onDelete: Restrict)
  seller User  @relation("PurchaseSeller", fields: [sellerUserId], references: [userId], onDelete: Restrict)

  @@index([ownerId, createdAt(sort: Desc)])
  @@index([sellerUserId, status, createdAt(sort: Desc)])
  @@map("purchases")
}

// On-chain ownership mirror; canonical record is Solana
model Deed {
  imageId            String   @id @map("image_id")
  mintAddress        String   @unique @map("mint_address")
  ownerWalletAddress String   @map("owner_wallet_address")
  ownerId            String   @map("owner_id")
  deedState          String   @default("sealed") @map("deed_state")   // sealed | opened | rights_disputed | void | burned
  variantHashes      Json     @map("variant_hashes")                  // {"M+00": {sha256, anchored_at}, "E+01": {...}}
  mintedAt           DateTime @map("minted_at")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  image Image @relation(fields: [imageId], references: [imageId], onDelete: Restrict)
  owner Owner @relation(fields: [ownerId], references: [userId], onDelete: Restrict)

  @@index([ownerWalletAddress])
  @@index([ownerId, mintedAt(sort: Desc)])
  @@map("deeds")
}

// Append-only ESIGN ledger; one row per signed legal event
model Signature {
  id                   String   @id @default(uuid())
  userId               String   @map("user_id")
  documentType         String   @map("document_type")                 // ToS | Privacy | CMA | MJA | LICENSE_ACCEPTANCE | IMAGE_SIGNING_AFFIRMATION | SOLE_COPY
  documentVersionLabel String   @map("document_version_label")
  documentVersionHash  String   @map("document_version_hash")
  imageId              String?  @map("image_id")                      // populated for per-image signatures
  signingEventId       String   @unique @default(uuid()) @map("signing_event_id")
  clickedAt            DateTime @default(now()) @map("clicked_at")
  ipAddress            String   @map("ip_address")
  sessionTokenHash     String   @map("session_token_hash")

  user  User   @relation(fields: [userId], references: [userId], onDelete: Restrict)
  image Image? @relation(fields: [imageId], references: [imageId])

  @@index([userId, documentType])
  @@map("signatures")
}

```

Notes:
- `Image.signingEventId` is a value reference to `Signature.signingEventId`, not a Prisma `@relation`. The bidirectional FK pair (Image has a signature, Signature points back to image for per-image affirmations) would require explicit `@relation` naming and complicate the Signature side where the same field is nullable. Application-layer joins on the unique `signingEventId` value are sufficient.
- The `Image` <-> `Report` model has two relations: many `Report` rows belong to one `Image` (relation `ImageReports`), and many `Image` rows can point at one `Report` as their adjudicating takedown ticket (relation `ImageTakedown`). Both relations are named explicitly to satisfy Prisma's ambiguity rule.
- The `purchasesAsSeller` back-relation on `User` carries the name `PurchaseSeller` so Prisma can distinguish it from `Purchase.image`'s implicit User join (which doesn't exist here; included for forward-compat clarity).
- Migration generation: `npx prisma migrate dev --name init` produces the initial migration. Subsequent §3.6 changes flow through `prisma migrate dev --name <change>` after editing this file.

---

## APPENDIX D: API CONVENTIONS

The §3.7 endpoint table is the authoritative per-endpoint source. This appendix defines the derivation rules that turn each row into a full contract (Zod schema + route handler signature + OpenAPI fragment). Applied uniformly, the rules make the per-endpoint Notes column sufficient -> no per-endpoint contract restatement is required.

**Request body.** Fields named in the Notes column form the Zod schema. Type per field: if the field name matches a column in the §3.6 / Appendix C Prisma schema, inherit that column's type and constraints; otherwise the type is stated inline in Notes. Validation rules combine column constraints from §3.6 with any additional qualifiers in Notes (length bounds, regex, allowed-value sets).

**Path parameters.** Extracted from the route pattern: `:imageId` -> 5-char base-36 lowercase per R62 §2.3; `:id` -> UUID; `:mintAddress` -> Solana base58.

**Query parameters.** List endpoints (returning a collection) accept `?after=<cursor>&limit=<n>` where `cursor` is the id of the last item from the prior page; default `limit=20`, max `limit=100`. Other endpoints accept no query params unless stated in Notes.

**Request context (middleware-set, not body).** Every authenticated endpoint has `userId`, `ipAddress`, `sessionTokenHash`, `requestId` populated by middleware before the handler runs. `userId` comes from Magic DID validation; `sessionTokenHash` is the hashed session token used in `signatures` writes; `requestId` is a per-request UUID propagated to Pino log lines.

**Success response.** Verb conventions:

| Pattern | Status | Body |
|---|---:|---|
| `POST` that creates a row | 201 | the created resource |
| `POST` that triggers an action | 200 | action result (named in Notes) |
| `GET` single resource | 200 | the resource |
| `GET` collection | 200 | `{ items: T[], next_cursor: string | null }` |
| `PATCH` | 200 | the updated resource |
| `DELETE` | 204 | no body |

Resource shape: the §3.6 row, with timestamps and FKs included; sensitive fields excluded by default (no raw DEK, no full session token, no inline private payloads). Sensitive-field rules are stated once here, not per endpoint.

**Error response.** All errors return:

```
{ code: ErrorCode, message: string, details?: object }
```

HTTP status per error code is defined in Appendix E (Error Taxonomy). Standard handler sequence:

1. Validate body -> `E_VALIDATION` (422)
2. Validate path / query params -> `E_VALIDATION` (422)
3. Auth check -> `E_AUTH_REQUIRED` (401)
4. Role check -> `E_ROLE_INSUFFICIENT` (403)
5. Endpoint-specific preconditions named in Notes -> the appropriate `E_*` code from the taxonomy

Handlers never throw to the framework; uncaught errors map to `E_INTERNAL` (500) and are recorded by Pino + Sentry.

**Formats.**

| Concept | Format |
|---|---|
| Timestamps | ISO 8601 UTC strings (`2026-05-21T15:04:05Z`) |
| Money | Integer cents |
| UUIDs | Lowercase v4 (`a1b2c3d4-...`) |
| `image_id` | 5-char base-36 lowercase per R62 §2.3 |
| `mint_address` | Solana base58 |
| Field naming | camelCase in JSON request / response; snake_case is the storage column name only (see Appendix C `@map` directives) |

**Webhook endpoints (rows 21-22).** Request body is the provider's event payload (Stripe `Event` object; Crossmint mint event) -> third-party schemas, not redefined here. Signature verification logic per provider is documented in §3.3. Webhook handlers return `200` unless signature verification fails (return `400`); handler errors are caught, logged, and the response is still `200` to avoid third-party retry storms. Idempotency at MVP is provided by the conditional `UPDATE ... WHERE status = <expected_prior>` pattern against `purchases` -> the row's existing state is the dedup token (no separate idempotency table; deferred to MMP).

---

## APPENDIX E: ERROR TAXONOMY

Every error response from the API follows the shape defined in Appendix D:

```
{ code: ErrorCode, message: string, details?: object }
```

The `message` field is the **UI-displayable, end-user-readable** explanation. It is written as text the front-end can drop directly into a toast, banner, or inline-validation message without rewriting -> plain English, action-oriented where applicable, never leaking internal-system details (no stack traces, no third-party error codes, no SQL fragments). The `When (trigger)` column below is the spec / developer view (when the code fires) and is **not** sent to the client. Full upstream error context is logged server-side via Pino keyed by `requestId` for forensic correlation; only the sanitized `code` + `message` + optional `details` reach the client.

Codes form a closed set; the TypeScript discriminated-union and the handler `code -> HTTP` mapping are generated from this appendix.

### Validation

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_VALIDATION` | 422 | One or more body / param fields fail the Zod schema | "One or more fields could not be accepted. Please review the highlighted items." | `{ field: string, reason: string }[]` |
| `E_DOCUMENT_VERSION_STALE` | 400 | `document_version_label` does not match the current legal-document version | "The legal document was updated while you were signing. Please reload the page and review the latest version before signing." | `{ document_type: string, current_version_label: string }` |

### Auth & Role

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_AUTH_REQUIRED` | 401 | No Magic DID token on a protected endpoint | "Please sign in to continue." | -- |
| `E_AUTH_INVALID` | 401 | Magic DID token fails `magic.token.validate` or is expired | "Your session has expired. Please sign in again." | -- |
| `E_ROLE_INSUFFICIENT` | 403 | User lacks the role the endpoint requires (e.g., calling a creator endpoint without a `creators` row) | "You don't have access to this action." | `{ required_role: "CREATOR" | "OWNER" }` |
| `E_NOT_ALLOWLISTED` | 403 | `POST /v1/creator/sign-cma` precondition: email not in `creator_allowlist` | "This account isn't on the creator allowlist. Please contact Elanoid to request creator access." | -- |

### State / Conflict

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_ALREADY_CREATOR` | 409 | `creators` row already exists for this `user_id` | "You're already set up as a creator. Head to your dashboard to start uploading." | -- |
| `E_ALREADY_OWNER` | 409 | `owners` row already exists; MJA already signed | "You've already completed buyer onboarding. Continuing to checkout." | -- |
| `E_DUPLICATE_PURCHASE` | 409 | A `purchases` row already exists for this `image_id` + buyer with `status='started'` or `status='paid'` | "You already have a purchase in progress for this image. Please complete or cancel it before starting a new one." | `{ purchase_id: string, status: string }` |
| `E_IMAGE_NOT_LIVE` | 409 | Attempted to purchase an image whose `status` is not `live` (already sold, taken down, or still draft) | "This image is no longer available for purchase." | `{ status: string }` |
| `E_IMAGE_NOT_OWNED` | 403 | Ownership-gated endpoint called by a non-owner: Share Copy download requested by a wallet that is not the current deed holder, or privacy-flip (`POST /v1/images/:imageId/make-public`, §2.6) called by a user who is not the current owner per the `purchases` join | "Only the current deed owner can perform this action." | -- |
| `E_IMAGE_TAKEN_DOWN` | 410 | Resource previously existed but is now in `taken_down` state | "This image has been removed and is no longer available." | -- |

### Ingestion Gate

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_IMAGE_TOO_SMALL` | 422 | Long edge < 4200 px or short edge < 3300 px | "This image is below our minimum resolution. Please upload an image at least 4200 x 3300 pixels." | `{ long_edge_px: int, short_edge_px: int }` |
| `E_IMAGE_TOO_LARGE` | 422 | Pixel count > 38 MP or file size > 20 MB | "This image exceeds the size limit. Please upload an image up to 38 megapixels and 20 megabytes." | `{ pixels_mp: number, size_mb: number }` |
| `E_IMAGE_BAD_ASPECT` | 422 | Aspect ratio outside 1.0 - 2.0 range | "This image's shape is outside the accepted range. Please upload an image with an aspect ratio between 1:1 (square) and 2:1." | `{ aspect_ratio: number }` |
| `E_IMAGE_BAD_FORMAT` | 422 | Non-JPEG, wrong color depth, or unsupported subsampling | "This file format isn't supported. Please upload a JPEG image in standard sRGB color." | `{ format: string, color_depth: string }` |
| `E_PHOTODNA_MATCH` | 451 | PhotoDNA returns a non-empty match array; §2258A NCMEC report and account suspension fire as side effects before the response | "This image was rejected by automated review and the account has been suspended." | -- |
| `E_HIVE_REJECT` | 422 | Hive classifier returns a non-G tier (Suggestive, Adult, or Prohibited) | "This image was rejected by automated review for content reasons. Only G-rated content is accepted at this time." | `{ classifier_tier: string }` |

### External Service

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_STRIPE_CHARGE_FAILED` | 402 | Stripe `payment_intent.payment_failed` | "Your payment could not be processed. Please try a different card or contact your card issuer." | `{ stripe_decline_code?: string }` (sanitized; raw decline reason logged server-side only) |
| `E_CROSSMINT_MINT_FAILED` | 502 | Crossmint mint dispatch fails after the retry budget; triggers the §4.3 auto-refund path | "We couldn't issue the deed. Your purchase has been refunded automatically. Please try again later." | -- |
| `E_ARWEAVE_UPLOAD_FAILED` | 502 | ArDrive Turbo upload fails after retries; triggers auto-refund | "We couldn't finalize this purchase. Your payment has been refunded automatically. Please try again later." | -- |
| `E_CLOUDINARY_FAILED` | 502 | Cloudinary variant build fails after retries; triggers auto-refund | "We couldn't prepare your image. Your payment has been refunded automatically. Please try again later." | -- |
| `E_SERVICE_UNAVAILABLE` | 503 | Downstream service is temporarily unreachable (PhotoDNA, Hive, etc.) before the retry budget is exhausted | "We're temporarily unable to complete this action. Please try again in a moment." | -- |

### Resource

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_NOT_FOUND` | 404 | Requested resource does not exist (any GET / PATCH by id) | "We couldn't find what you were looking for." | -- |

### Rate / Abuse

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_RATE_LIMITED` | 429 | Per-IP or per-user request rate limit exceeded; `Retry-After` header set | "You're sending requests too quickly. Please wait a moment and try again." | `{ retry_after_seconds: int }` |

### Webhook

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_WEBHOOK_SIGNATURE_INVALID` | 400 | Webhook signature verification fails (Stripe HMAC, Crossmint signature, etc.) | -- (not user-facing; webhook callers receive raw status only) | -- |

### Internal

| Code | HTTP | When (trigger) | Message (UI) | Details |
|---|---:|---|---|---|
| `E_INTERNAL` | 500 | Uncaught handler error; logged via Pino + Sentry with `requestId` | "Something went wrong on our end. Please try again. If this keeps happening, please reach out at support@epimage.com with the reference code in this message." | `{ request_id: string }` |

---

## REFERENCES

**Primary Source Documents:**
- **R62 Gallery Protocol:** Three-function architecture (Certification + Commerce + Registry per §1); deed structure, image variants, glass-box display, ingestion gates, takedown procedures, account lifecycle, technical architecture (including §2.3 Registry image-ID handle used in §3.3 / §3.6, §3.5.1 image-custody state machine used in §3.8, §7.3 Cloudinary asset naming used in §3.3 / §3.6, §7.4 Storage Model used in §3.5 / §3.6 / §3.8, §7.5 Decryption and Rendering Architecture used in §2.4 / §3.1 / §3.3, and §7.6 URL-Text Rendering Contract used in §2.4 / §3.3)
- **R65 Gallery Platform Security:** Threat model, license-overreach defense surface, countermeasures
- **R66 Gallery PMF:** Market sizing, audience targeting, competitive positioning, default-tier creator-merchandise wedge
- **R67 Gallery Design:** Behavioral foundations (psychological ownership, art-context valuation, identity relevance, costly signaling)

**Cross-Document Dependencies:**
- **R61 Platform Cost Analysis §3:** Production-grade MMP development effort estimate (2,203 base / 2,643 with 20% contingency); referenced in Appendix A as a context comparison only. R71's Appendix A methodology is self-contained per-feature decomposition, not derived from R61
- **R70 Gallery Investment Thesis §1.4:** Downstream financial models calibrated by the MVP's realized price distribution and 30-day GMV output

**Analysis Code:**
- **r71_ingestion_analysis.py** - Derives the §1.3 image ingestion window: print-quality resolution floor, Cloudinary megapixel ceiling, and JPEG file-size estimates across the accepted range

**External References:**
All external sources cataloged in **Reference.txt**, including Cloudinary transformation and file-size limits [cloudinary-2026] cited in §1.3.

---

*Last Updated: 05/29/26 14:40*