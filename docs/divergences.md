# Divergences from Spec

Central registry of intentional divergences from R71 / R62 / R67 / R65 / subsystem specs. Each row is a decision we shipped that knowingly conflicts with the written spec; each one is here so reviewers find it instead of mistaking it for a bug. Per-doc divergence notes (e.g. image_gen §2.3.1) stay where they live; this file is the index.

## Index

| ID | Area | Status | Decision | Spec it diverges from |
|---|---|---|---|---|
| D-01 | Buyer purchase UX | shipped | Single BuyWizard modal replaces the staged Stripe modal / ESIGN modal / monogram modal sequence | R71 §2.4 (sequence of steps, implementation-agnostic but read as separate views) |
| D-02 | Buyer purchase UX | shipped | "Mark my image" button replaces "Issue deed" / generic confirm at the monogram step | R71 §2.4 step 9 / 12 wording |
| D-03 | Stale-paid recovery | shipped | Wait indefinitely when the buyer never reached the monogram step; no auto-default, no auto-refund. Recovery happens on next signed-in visit to the image page. | payments.md OI-08 (suggested auto-default monogram or auto-refund after N hours) |
| D-04 | Build dispatch ownership | shipped | Server sweeper retries build dispatches on the buyer's behalf using their persisted monogram. The buyer never sees a Retry button. | ADR-0001 (buyer-triggered build via start-build POST) |
| D-05 | Build error surfacing | shipped | Build pipeline failures (Arweave, Crossmint, runImageOps) are hidden from the buyer. UI shows "Still issuing your deed..." indefinitely while sweeper retries. | payments.md §1.3 error codes surface to caller |
| D-06 | Image URL exposure | shipped | `<img src>` points at `/i/<image_id>` -- redirects server-side to the right Cloudinary variant -- so "Copy image address" produces a stable `<origin>/i/<image_id>` URL. | R62 §4.3 / §7.6 (image src not constrained but historically the raw Cloudinary URL) |
| D-07 | Frame size card | shipped | Row 4's third card is the largest matching standard frame size at 300 DPI (e.g. `Frame: 14"x11"`), not the legacy `Print Size: 8"x10"` static placeholder | R71 §3.4 / R62 §4.3 (Row 4 content not formally spec'd) |
| D-08 | Image visibility | shipped | Public / Private toggle is **round-trip**: post-sale owner can flip back and forth | R71 §2.6 ("the promotion is one-way for the owner's tenure"); R62 §4.7 |
| D-09 | Watermark hollow rendering | shipped | Listing Copy watermark is low-opacity (30%) + heavy outer outline instead of a true hollow / transparent-fill outline | R62 §2.2 "centered italic Epimage outline watermark"; details in image_gen §2.3.1 |
| D-10 | Listing Copy URL + edition mark | shipped | URL text register and edition mark "1 of 1" are rendered on the Listing Copy in addition to the Share Copy | R62 §4.3 (those registers live only on the Share Copy in spec) |
| D-11 | Encrypted Master upload | resolved 2026-06-06 | Arweave Turbo wallet funded (~$10 / ~465 MB capacity). Verified end-to-end via test mint image_id=1kqrw: ciphertext (121 KB) charged ~1.17B winc to Turbo, confirming the real upload path fired and the manifest-JSON fallback did NOT. Fallback code stays in arweave_master.ts as defense-in-depth; D-11 row preserved for history. Go-live ops: monitor Turbo balance via scripts/arweave_check.ts; top up when capacity drops below ~50 MB remaining. | R62 §2.3 / arweave_master.md §2.4 (encrypted Master must reach Arweave) |
| D-12 | Tax handling | shipped | Stripe Managed Payments handles tax automation; we do not set `automatic_tax` separately | R71 §3.7 (tax surface assumed to be managed by Connect-direct flow) |
| D-13 | Creator landing URL | shipped | Canonical URL is `epimage.com/c/<handle>` (handle stored with leading `@` in DB; URL omits it). Bare `epimage.com/<handle>` 301-redirects to the canonical form for legacy / external links. The `/c/` path prefix sidesteps email-fragment misreading of `/@<handle>` and removes the 5-char reserved-namespace collision with image_ids. | R71 §3.4 ("Public Creator Page deferred to post-MVP") |
| D-14 | Mint vendor + standard | migrated 2026-06-03 | Self-mint Bubblegum V2 cNFT under MPL-Core Collection (Path 4) is the operative implementation per /docs/registry/deed.md. Test mint succeeded on devnet. Crossmint code retired to /trash/. R62 §2.3 + R71 §3.7 still reference Crossmint in spec text -- captured in /docs/registry/r62_r71_alignment.md for the next R62/R71 revision pass. | R62 §2.3 / R71 §3.7 (spec text not yet aligned) |
| D-15 | Master encryption on Arweave (ADR-0010 nested ZIP) | **reverted 2026-06-07** | Shipped 2026-06-06 as nested ZIP-AES-256 envelope on Arweave per ADR-0010. Reverted the next morning per user directive "MVP implementation on inner key must match R62 at MVP." Arweave now receives single-layer AES-256-GCM(DEK_image, plaintext) per R62 §1.5/§2.3; the doubly-nested `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` lives on-chain in deed metadata. See [ADR-0010 supersession](adr/adr_0010_nested_zip_master_encryption.md#status). Devnet test deed `es0rx` retains the ZIP envelope as stranded history (no production data affected). | None remaining -- now R62-aligned |
| D-16 | cNFT on-chain `image` URL | pre-MVP only; revert at launch | cNFT metadata's `image:` field embeds the Cloudinary URL directly (`buildThumbnailUrl(image_id)`) instead of the platform-branded `${PLATFORM_BASE_URL}/i/<id>?variant=thumbnail` indirection. Reason: epimage.com is currently a parked GoDaddy page returning 404 on `/i/...` routes; until the app is actually hosted at that domain, any platform-routed image URL produces broken images in Solana Explorer / wallets / marketplaces. Flagged in cnft_dispatch.ts with `TODO(MVP-launch)` and queued for the go-live checklist. | R62 §2.2 / R67 design intent (image URL stays platform-branded for CDN swap independence) |
| D-17 | Owner key survival post-Magic-death (Recovery Document) | shipping in MVP | At first sign-in, the **client** (browser, not server) generates a self-contained Recovery HTML document containing the owner's Magic wallet privkey (exported via Magic SDK in-browser), their deed list (fetched from existing API; public anchor data), and step-by-step recovery instructions, then offers immediate download via a `Blob` + `download` attribute. No email, no password-protection (local-disk save is the security boundary; user's machine login is the gate). Document re-generates from a settings affordance after each new deed. R72 §2.9 assumes owners self-custody their wallet privkey post-cessation, which doesn't hold for Magic-OAuth Dedicated Wallet users: if Magic dies before/with Epimage, owners can't sign the recovery challenge → can't peel R62 §1.5's inner asymmetric layer → can't recover the Master even when the trustee publishes `PLATFORM_DEK`. The Recovery Document fills this gap by handing the privkey to the owner at first sign-in; from that point on Magic survival is no longer a hard dependency. INV-02 **strictly enforced architecturally**: privkey exists only in the browser, never travels to the server, never lives in server memory, never logs, never persists. The server cannot leak what it cannot see. | R72 §2.9 implicit "owners retain wallet privkey access" assumption (silent gap, not an explicit spec divergence) |
| D-18 | Operational-life independent Arweave verification (unsealing-on-download) | shipped 2026-06-07 (MVP local persistence; on-chain mirror post-MVP) | At first `/v1/deeds/:imageId/download-master` (the existing R62 §3.5.1 seal-break event), the platform peels the outer PLATFORM_DEK wrap of `enc_final` and persists the inner sealed-box on `Deed.enc_final_unwrapped`. Anyone holding the deed-owner's wallet privkey can fetch this from `GET /v1/images/:imageId` and use it to decrypt the Arweave Master independently of the platform during operational life. Cryptographically safe (AES-256 resists known-plaintext attacks). Post-MVP polish: mirror the unwrapped value to on-chain deed metadata via Bubblegum `updateMetadataV2` so the disclosure survives platform cessation; requires DAS `getAssetProof` (Helius). R62 + R72 don't currently spec this operational-life verification path -- they defer cryptographic byte-identity to post-cessation. This divergence opens it during life as a side effect of the existing seal-break, no new state, no new endpoint. | R62 §3.5.1 seal-break extended with one side effect (Deed.enc_final_unwrapped persistence); R72 §3.3 "byte-identity deferred to post-cessation" framing partially mooted for the deed-holder during operational life |
| D-19 | Arweave Master packaging (ZIP-AES-256 + platform proxy for friendly filename) | shipped 2026-06-07 | Arweave-bound payload is a single-layer ZIP-AES-256 archive (`<image_id>.zip` containing `<image_id>.jpg`, password = base64(DEK_image)) instead of R62 §2.3's literal "AES-256-GCM" raw ciphertext. R62 §1.5 architecture preserved exactly: one DEK_image per image is still the only key needed to decrypt the Arweave bytes; the on-chain `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` still does the doubly-nested protection. ZIP packaging is for native-tool UX only (Windows 11 23H2+, macOS Archive Utility, iOS Files, Android Files, Linux unzip 6.0+, 7-Zip all open it natively once the password is in hand). Mode shifts from GCM to ZIP-native AES-256-CBC; same algorithm strength, WinZip AE-2 spec integrity. **Platform proxy `GET /a/:imageId`** fetches the Arweave bytes and streams them back with `Content-Disposition: attachment; filename="<image_id>.zip"` so the buyer's browser saves a recognized file. The deed UI displays the raw `arweave.net/<tx_id>` URL as text (proves permanence, survives cessation) but hyperlinks to the proxy (operational-life UX). Post-cessation the proxy is gone; buyers fetch directly from `arweave.net/<tx_id>`, save with tx_id name, rename to `.zip`, extract. Local-disk encrypted Master persistence stays raw AES-256-GCM (R62 §2.3 exact); only the Arweave-bound copy uses ZIP packaging. | R62 §2.3 "AES-256-GCM" text for the Arweave payload (mode shift only; algorithm + key unchanged) |

## D-01: BuyWizard single-modal purchase flow

**What the spec says.** R71 §2.4 lists 17 sequential steps for the first-purchase flow: anonymous discovery, OAuth, MJA+License click-wrap, wallet provisioning, Stripe Embedded Checkout, monogram selection, image ops, deed mint, etc. Each step is implementation-agnostic but reads as a separate UI surface.

**What we ship.** A single `BuyWizard` modal mounts at the moment of Buy-button click and walks the buyer through four progress-strip stages without unmounting: `welcome -> contracts -> payment -> monogram`. The wizard:
- Stays open across Magic OAuth's full-page redirect via sessionStorage state + `?buy=resume` on return URL
- Mounts Stripe Embedded Checkout inline and advances via Stripe's `onComplete` callback (`redirect_on_completion: 'never'`) so no page navigation interrupts the flow
- Closes immediately on monogram submit; the rest of the build pipeline runs in the background

**Why.** The staged modal pattern showed 3 distinct overlays in succession with state passing between them. Single-modal-with-progress reduces perceived friction, keeps state co-located, and surfaces the user's position in the flow continuously.

**Mapping to R71 §2.4 steps.**
- Steps 1-3 (discover, click Buy, OAuth) -> Wizard step 1 (welcome) + Magic redirect
- Step 4 (MJA + License) -> Wizard step 2 (contracts)
- Steps 5-8 (wallet, Stripe entry, payment auth, customer persist) -> Wizard step 3 (payment)
- Step 9 (monogram) -> Wizard step 4 (monogram, the "Mark my image" click)
- Steps 10-17 (revenue split, image ops, mint, backfill, confirmation, Share Copy availability) -> backgrounded after wizard close; see ADR-0007 + D-04

## D-02: "Mark my image" button

**What the spec says.** R71 §2.4 step 9 / 12 wording implies the buyer's confirmation is for monogram selection within the deed-issuance flow ("the chosen monogram is captured in `purchases.monogram_text` for the Share Copy build at step 13"). Reasonable button wording would be "Confirm" or "Issue deed".

**What we ship.** The monogram-step button reads **"Mark my image"**.

**Why.** The buyer's intent at this click is "I want this image, with these letters". Deed mint, Arweave upload, Crossmint dispatch are platform-side side effects whose success or failure should not change the buyer's mental model of what just happened. "Mark my image" frames the click as a customer action; "Issue deed" frames it as a blockchain transaction the buyer is initiating. The former is closer to how the platform wants the buyer to think of the transaction (per R67 §5.8 deed-as-receipt).

## D-03: Indefinite wait for abandoned purchases

**What the spec says.** payments.md OI-08:
> Stale `paid` purchases per ADR-0001 -- if buyer closes tab before `start-build` POST, `purchases.status` sits at `paid` forever. Recovery: grace-period sweeper (auto-default monogram to billing initials + spawn build) or auto-refund after N hours.

**What we ship.** Neither auto-default nor auto-refund. When `Purchase.status='paid'` and `monogram_text` is null, the row is left untouched indefinitely. Recovery happens on the next signed-in visit to the image page: `GET /v1/images/:id` surfaces `pending_purchase_id`, and the client auto-opens the BuyWizard at the monogram step.

**Why.** Auto-defaulting on the buyer's behalf substitutes platform judgment for buyer choice. Auto-refunding after N hours forces a decision on the buyer that they may not have intended (e.g. they're traveling and will come back next week). Indefinite wait preserves buyer agency at the cost of orphan-paid rows on the platform balance sheet. We accept the cost.

The `Purchase.status='paid'` row carries no on-chain footprint, so leaving it indefinitely is operationally cheap; it's a row in SQLite. Operational risk is bounded.

## D-04: Sweeper retries build dispatches

**What the spec says.** ADR-0001:
> Per ADR-0001, runImageOps is triggered by a buyer-initiated `start-build` POST, not by [the Stripe webhook handler].

The intent is "build does not start automatically; the buyer's POST is the trigger".

**What we ship.** Stale-paid sweeper at `/src/app/workers/stale_paid_sweeper.ts` retries `start-build` every 60 seconds, indefinitely, for purchases where:
- `status='paid'`
- `monogram_text` is not null (i.e., the buyer already marked the image)
- `created_at` is more than 5 minutes ago

The first dispatch is still buyer-triggered (clicking Mark my image). Subsequent retries are system-triggered on the buyer's behalf, using the persisted `monogram_text`.

**Why.** ADR-0001's "buyer-triggered" frame was about decoupling the slow build from the Stripe webhook handler -- not about making the buyer babysit infrastructure failures. The sweeper retry uses the buyer's intent (their monogram) verbatim; it just attempts the dispatch the buyer already initiated, again, when the platform's first attempt failed. The buyer never has to know the first attempt failed.

## D-05: Build errors hidden from buyer

**What the spec says.** payments.md §1.3 lists error codes that surface to the caller: `STRIPE_PAYMENT_FAILED`, `STRIPE_SIGNATURE_INVALID`, etc. By extension the spec implies build-pipeline errors propagate similarly.

**What we ship.** Build-pipeline errors (Arweave upload, Crossmint dispatch, runImageOps failures) are caught and logged server-side but **not surfaced to the buyer**. The buyer sees one of three states on the post-mark listing page:
- "Issuing your deed..." (in progress)
- "Still issuing your deed..." (took longer than expected, but still in progress -- this is the bucket that hides the failed-and-being-retried state)
- "Deed issued." with action buttons enabled (success)

There is no buyer-facing "Issue failed" state with a Retry button.

**Why.** Buyer agency does not extend to choosing whether to retry a Cloudinary or Arweave outage -- that's the platform's responsibility. Surfacing "Issue failed" with a Retry button shifts operational concern onto the buyer; hiding it preserves the trustworthy-backend UX even at the cost of opacity. The platform is expected to monitor sweeper retries via Pino logs and intervene operationally if a class of failures persists.

Payment failures (`STRIPE_PAYMENT_FAILED`) are not affected; those still surface in the wizard before the modal closes because they happen during the buyer's active session.

## D-15: Master encryption on Arweave (ADR-0010 nested ZIP) -- reverted

**Status: reverted 2026-06-07.** Shipped 2026-06-06; reverted the next morning per user directive "MVP implementation on inner key must match R62 at MVP." See [ADR-0010 supersession](adr/adr_0010_nested_zip_master_encryption.md#status) for the full post-mortem.

**What was shipped briefly.** Arweave-bound payload was a nested ZIP-AES-256 envelope (outer password = SHA256(PLATFORM_DEK || image_id), inner password = SHA256(buyer_ed25519_signature || image_id)). Wired through BuyWizard signing + Purchase.buyer_signature_b64 + arweave_master nested-ZIP build. Verified end-to-end on devnet (image_id `es0rx`, 7-Zip confirmed both layers decrypt).

**Why reverted.** R62 §1.5 already specifies the encryption form Epimage wants (`enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` with the inner asymmetric sealed-box to the buyer's wallet pubkey). The nested ZIP gave a nicer post-cessation 7-Zip UX but:
- Couldn't be re-keyed on resale (ZIP file is byte-immutable on Arweave; inner password bound to original buyer's signature forever)
- Diverged from every spec doc, creating sustained translation burden
- The "native-unzip" UX is moot once R72 §2.8's open-source recovery CLI ships

**Current state.** Arweave-bound payload = single-layer AES-256-GCM(DEK_image, plaintext) per R62. On-chain deed metadata carries `enc_final` per R62 §2.3. Code: `src/registry/arweave_master.ts` + `src/cert/crypto.ts` `buildEncFinal()`. Devnet test deed `es0rx` retains the legacy ZIP envelope on its Arweave URI (stranded history; no production impact).

**What survives from D-15 work.** The certify-time `Image.sha256` populate over the upload buffer + `buildOriginalUrl()` master-bytes refactor + Magic SDK Solana signMessage determinism finding (kept as a dev diagnostic) are independent of the encryption choice and remain in place.

## D-17: Owner Recovery Document (fills R72 §2.9 silent gap)

**Status: shipping in MVP.** Subsystem: `/src/ui/recovery/` (client-side; flat under src/ui/ per the user's memory). Trigger: first successful Magic sign-in. Output: a single self-contained `.html` file offered as a browser download (no server round-trip).

**What R72 §2.9 says** (implicit assumption). Owner identity verification post-cessation: "the owner signs a nonce with their wallet private key; the signature verifies against `owner_wallet_address` from the deed -> standard Solana wallet-control proof." R72 assumes the owner retains usable access to the wallet privkey at recovery time. The deadman switch (R72 §§2.1-2.7) only publishes `platform_DEK` (the outer layer); the inner R62 §1.5 wrap is keyed to `owner_wallet_pubkey` and only the owner's privkey peels it.

**Why it's a gap at MVP.** Almost every MVP buyer uses Magic Dedicated Wallet via Google OAuth. Their Solana keypair is **derivable from their Google identity by Magic's servers, not held by them**. Cessation scenarios:

| Scenario | Owner recoverable? |
|---|---|
| Epimage dies, Magic still operates, Google account intact | Yes (sign in to Magic, recover wallet, sign challenge) |
| Epimage dies, Magic dies, Google account intact | **No** (no path to privkey) |
| Owner loses Google-account access | **No** (Magic can't recover the wallet without the OAuth identity) |

The combined-failure rows are not theoretical: any large SaaS outage that takes both Epimage AND Magic offline within the post-cessation recovery window leaves owners stranded even when R72 §§2.1-2.7 publishes `platform_DEK` correctly. R72 doesn't address this because it scopes its design to the outer layer.

**What we ship.** Client-side end-to-end. At first successful Magic sign-in (after the user role is established):
1. Browser uses Magic SDK to export the user's wallet private key in-page (Magic Dedicated Wallet supports privkey export client-side; verify SDK surface before build -- OI-D17-01)
2. Browser fetches the user's current deed list from the existing `/v1/me/collection` API (public anchor data; empty at first sign-in for buyers)
3. Browser renders a single self-contained HTML document via a React component containing:
   - User identity (email + Solana wallet address)
   - The Solana wallet private key (base58) + 12-word mnemonic + inline-SVG QR code (`qrcode-svg` npm; client-side)
   - The user's current deed list (image_id, Arweave URI, SHA-256 anchor)
   - Step-by-step plain-English recovery instructions (find `PLATFORM_DEK`, derive outer password, run 7-Zip, sign challenge with wallet, derive inner password, run 7-Zip again)
   - Technical reference (exact KDF formulas, challenge string format, recovery-client mirrors)
   - Document SHA-256 for integrity verification (computed in-browser via SubtleCrypto)
4. Browser triggers a `Blob` download via an anchor with `download="epimage-recovery-<email>.html"` attribute. No HTTP roundtrip with the privkey in the body.
5. Modal prompts the user to confirm they've saved it before closing
6. Re-generation available from the user's account settings any time (re-runs the same client-side flow with the freshest deed list)
7. After each new deed purchase, the BuyWizard's completion banner offers a "Download updated recovery document" affordance (also client-side)

**File format choice (HTML, not PDF, no encryption).** HTML chosen over PDF for design control, smaller file size (~10-20 KB), universal browser rendering, inline-SVG QR codes, and `View Source` transparency. No JavaScript (so the saved file is statically inspectable forever; future browsers may block JS in saved HTML anyway). All CSS inline; no external assets. The user can print-to-PDF from their browser if they prefer a PDF artifact. No password-protection on the file itself: the user's local disk (and OS login) is the security boundary; PDF/HTML password adds a second gate they have to remember, and forgotten passwords destroy more recoveries than email breaches do (most buyers are not crypto-native). No email channel at MVP -- download-only avoids ESP-side privkey exposure and the in-transit leak surface. Settings-page re-generation is the recovery affordance if the user loses the file pre-cessation.

**Privacy / INV-02 alignment.** R62 INV-02: "Platform MUST NOT hold buyer private keys; Path 1 decryption uses buyer-signed challenge." Client-side generation enforces this architecturally rather than by promise:
- Privkey is exported by Magic SDK directly into the browser tab. It never leaves the tab.
- No HTTPS request body, no server endpoint, no Postmark, no log line on the server side could possibly contain the privkey -- the value never travels there.
- The HTML render happens in React in-browser; the `Blob` and download both stay client-side.
- Server-side audit log can record "user X requested recovery document at T" as a presence signal, but the privkey value cannot appear in the log because the server never receives it.
- This is strictly stronger than the server-side variant of this design ("server holds the value in memory then discards"): there is no in-memory window at all on the server.

**Open implementation issues** (none block this divergence row; tracked for the implementation pass):
- OI-D17-01: Verify Magic Dedicated Wallet SDK exposes a programmatic in-browser privkey export API (`magic.user.showSettings()` is hosted-UI only and round-trips to Magic's domain; we need a method that returns the privkey to the host page's JS context). If only the hosted-UI path is available, fall back to a paste-flow: user clicks "Export key" in Magic's UI, copies the key, pastes it into Epimage's recovery-doc generator, browser renders the doc with the pasted key. Still client-side; still INV-02-clean. Half-day spike before build.
- OI-D17-02: Decide whether to anchor the document's SHA-256 to a small Solana tx so post-cessation verifiers can prove the document was generated by Epimage for this user. Cheap; deferred to first implementation pass.
- OI-D17-03: Decide what happens if the user clears their browser before saving the document. Current plan: re-generate from settings (server doesn't hold the doc, but Magic still does the privkey export client-side as long as Magic + Google OAuth are alive). If the user ALSO loses Google/Magic access in the meantime: stuck. Standard self-custody UX -- worst-case mirrors any lost-paper-wallet scenario.

**Cross-references.** [R72 §2.9](R72_Trustless_Archive_Protocol.md) (the silent gap this fills); R62 §1.5 (the inner asymmetric layer that requires owner privkey); [ADR-0010](adr/adr_0010_nested_zip_master_encryption.md) (the inner-ZIP-password-from-wallet-signature variant of the same dependency); INV-02 (privkey-handling invariant the Recovery Document is designed to respect).

## D-14: Mint vendor + standard (Crossmint cNFT replaced by self-mint Bubblegum V2 cNFT)

**Status: migrated 2026-06-03.** Self-mint pipeline is operational on devnet; first end-to-end mint succeeded (asset_id 7wAPe8piSeiBBtJGGzgiZcgDwiKSRVbpRrUmrTcBoNnq, devnet tx 5RAKrX1Xiex6LC3dZmeZDH7ZJ8sHeCQouBExfqCEyes6XbbEVHgJQKEKrtLtqrtV1gWTkEcxpYrXnjPUT1TyXh9c). Crossmint code retired to /trash/. R62 + R71 spec-text alignment pending per /docs/registry/r62_r71_alignment.md.

**What R62 + R71 still say.** R62 §1 lists Crossmint as a Registry primitive; §2.3 + §3.1 Card 5 / Card 8 + §4.5 specify the Crossmint Minting API and Metaplex Core UpdateDelegate / transfer plugins. R71 §3.7 names the Crossmint Minting API as the deed-mint vendor. These spec edits are captured but not applied -- see r62_r71_alignment.md.

**What we ship.** Self-mint Bubblegum V2 cNFT under a platform-owned MPL-Core Collection per /docs/registry/deed.md. Implementation in /src/registry/cnft_dispatch.ts (Path 4: per-tree mutex, predict asset_id, Arweave upload, mintV2 with permanent URI, advisory post-mint verification). Post-mint finalization in /src/registry/post_mint.ts (vendor-agnostic, extracted from the retired crossmint_webhook). Architecture details:
- Collection-level PermanentFreezeDelegate (frozen=true, authority=COLD_RECOVERY_KEY) + PermanentTransferDelegate (authority=HOT_RESALE_KEY) + BubblegumV2 plugin
- Path 4 mint sequence (per-tree mutex reserves asset_id; Arweave upload completes before mint; single mintV2 with permanent Arweave URI)
- Three signers per mint: HOT_MINT_KEY (payer), HOT_OPS_KEY (tree authority), COLD_RECOVERY_KEY (collection authority)
- Procedural-multisig admin tool for INV-06 enforcement -- still TBD per OI-01 in deed.md
- Embedded provenance manifest + per-event Arweave snapshots -- post-MVP, not yet implemented

**Why.** Crossmint's vendor-held tree authority made INV-06 enforcement impossible at the protocol level and gated every standard change behind a per-project support ticket. Bubblegum V2's collection-level permanent plugins closed the soulbound-enforcement gap that originally motivated keeping Crossmint as the simplest path. Cost economics also favor self-mint (~$0.001 per mint vs Crossmint's vendor margin on top of bare-chain cost). Full reasoning in /docs/registry/deed.md §2 and §3.5.

**Migration status.** Existing Crossmint-issued test data was wiped 2026-06-03 (zero real users). Production migration policy (OI-06 in deed.md) is therefore moot for this cohort. Retired implementation files live at /trash/src/registry/crossmint_*.ts and /trash/docs/registry/crossmint_*.md -- delete the folder once R62 + R71 spec-text alignment lands (per r62_r71_alignment.md). The .env vars CROSSMINT_API_KEY + VITE_CROSSMINT_CLIENT_KEY are commented out but not deleted -- next .env audit.

---

## Cross-references

| Topic | Source |
|---|---|
| Mark my image semantics | ADR-0007 |
| Buyer flow steps | R71 §2.4 |
| Stale paid open issue | payments.md OI-08 |
| Image render states | R71 §3.4, R62 §4.7, ui_design.md §4 |
| Watermark rendering divergence | image_gen.md §2.3.1 |
| Public Creator Page deferral | R71 §3.4 footnote |
| Mint architecture decision | /docs/registry/deed.md |
| Self-mint dispatcher target | /docs/registry/deed.md |
| R62 + R71 pending alignment | /docs/registry/r62_r71_alignment.md |

---

*Last Updated: 26/06/07 02:30*
