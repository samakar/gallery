# Go-Live Checklist

Operational items that activate only when `epimage.com` flips from "Launching Soon" parked page to the production server. Items here are explicitly NOT MVP / devnet work -- they're the launch-day punch list. Append new items as conversations surface them; do not delete completed items, mark them `[x]` so the history stays auditable.

Cross-references:
- `/docs/divergences.md` (intentional MVP shortcuts whose resolution lives here)
- `/docs/R71_Gallery_MVP_Specification.md` §1.2 "Out of MVP Scope" (post-MVP feature set)
- `/docs/registry/deed.md` OI-NN (`[POST-MVP]` / `[OPERATIONAL]` tagged items)

---

## 1. DNS / Hosting

- [x] **Domain registered: epimage.com** -- owned (currently parked at GoDaddy "Launching Soon" page).
- [x] **Domain registered: epima.ge** -- owned. Short-link domain referenced from on-chain metadata: every deed's `name` field is `epima.ge/<image_id>` (set in `cnft_dispatch.ts` `nameForOnchain`). This makes `epima.ge` load-bearing -- if it stops resolving, the visible title of every minted deed in Phantom / Explorer becomes a dead string.
- [ ] **DNS A/AAAA: epimage.com** -- repoint from GoDaddy parking to production server. Confirm `curl https://epimage.com/collection.json` returns the JSON (not the parked HTML) before triggering the DAS refresh in §2.
- [ ] **DNS + redirect: epima.ge via Cloudflare** -- chosen approach: add `epima.ge` to a Cloudflare free-plan account, switch nameservers at the registrar to Cloudflare's, then configure a Single Redirect rule:
  ```
  Source URL:  https://epima.ge/*
  Target URL:  https://epimage.com/${1}
  Status:      301 (permanent)
  ```
  Path preservation is built in (`${1}` captures the wildcard). Cloudflare auto-issues a TLS cert for `epima.ge` so the `TLS: epima.ge` item is handled by the same step. The redirect lives at Cloudflare's edge -- it survives `epimage.com` origin outages, which is important because the on-chain `name` field on every minted deed (`epima.ge/<image_id>`) is permanently load-bearing.

  **Bare-root behavior**: when a user types just `epima.ge` (no path), the browser sends `GET /`, the wildcard captures the empty string, and the redirect lands them on `https://epimage.com/` (homepage). This is intentional -- the short domain effectively doubles as a vanity URL for the main site. If you ever want a different bare-root behavior (e.g. a `epimage.com/welcome` landing or a 410), add a second Single Redirect rule with source `https://epima.ge` (no path) evaluated before the wildcard rule.

  Verify post-setup:
  - `curl -I https://epima.ge/op23z` -> `301` + `location: https://epimage.com/op23z`
  - `curl -I https://epima.ge`        -> `301` + `location: https://epimage.com/`
- [ ] **TLS: epimage.com** -- valid cert covering apex (and `www.epimage.com` if used).
- [ ] **Static asset serving** -- wire Express static middleware so `/static/*` resolves to `src/app/api/static/` (or equivalent CDN path).

## 2. Collection metadata (Solana Explorer + DAS surfaces)

On-chain URI is permanently set to `https://epimage.com/collection.json` (tx `eTF393Py...TojpHY`, 2026-06-03). The route exists in `src/app/api/server.ts`; it activates the moment the server is reachable at `epimage.com`.

- [ ] **Cover image** -- create `src/app/api/static/collection-cover.png` (recommended >= 512x512, branded; transparent or solid bg). Until present, Explorer falls back to the grey Solana fleur icon.
- [ ] **Production env** -- confirm `PLATFORM_BASE_URL=https://epimage.com` in production `.env` (it's the default but explicit beats implicit).
- [ ] **Revert cnft_dispatch `image:` to platform URL (D-16)** -- in `src/registry/cnft_dispatch.ts` `buildDeedMetadataJson`, swap `image: buildThumbnailUrl(input.image_id)` back to `image: \`${PLATFORM_BASE_URL}/i/${input.image_id}?variant=thumbnail\``. Pre-MVP we embed the Cloudinary URL directly because epimage.com is parked; once the production server serves `/i/...` routes, the platform-branded form is correct (CDN-swap-independent, branded link surfaces in marketplaces). This MUST land before the first mainnet mint -- existing devnet test mints will be wiped, but every mainnet mint's `image:` URL is permanent on Arweave. See [divergences D-16](divergences.md), grep for `TODO(MVP-launch)` in cnft_dispatch.ts.
- [ ] **Platform wallet pubkey** -- set `PLATFORM_WALLET_PUBKEY` explicitly in production `.env` instead of letting it derive from `HOT_MINT_KEY`. Production wallet should be distinct from the fee-payer key.
- [ ] **DAS refresh after DNS** -- once `epimage.com/collection.json` returns 200 JSON, trigger Helius refresh on the Collection pubkey and every minted deed `asset_id` (one-off script: query Deed table -> POST to Helius refresh endpoint per asset). Without this, DAS keeps serving cached blank metadata for hours-to-days.
- [ ] **Verify on Explorer** -- Collection page shows symbol `epimage`, Website link, Creators dropdown (platform wallet, verified), cover image renders. Every deed page shows its Thumbnail + clickable `external_url` to `epimage.com/<image_id>`.

## 3. Arweave

- [x] **Funding** -- Arweave Turbo wallet funded with $10 (~465 MB capacity, ~58 mints at 8 MB). Verified via test mint 1kqrw on 2026-06-06; D-11 resolved. Top up to whatever covers projected month-one launch volume before production cutover (rule of thumb: $0.20 per 8 MB encrypted Master).
- [ ] **Remove or repurpose D-11 fallback** -- decide whether the manifest-JSON stub fallback in `src/registry/arweave_master.ts` stays as a safety net or gets removed. If it stays, add a monitoring alert for any fallback firing in production (it's a sign of credit exhaustion, not a benign degraded mode).
- [ ] **Balance monitoring** -- alert at 30 / 10 / 5 days of projected runway at current mint rate.
- [ ] **Gateway redundancy** -- the per-deed Arweave URI uses `arweave.net` by default; consider serving via the gateway list (`arweave.dev`, `g8way.io`) when the primary 502s. Test how DAS / Explorer behave if `arweave.net` is briefly unreachable.
- [ ] **Local-ciphertext retention policy** -- `data/encrypted_masters/<image_id>.bin` (D-11 follow-through) currently grows unbounded. Define retention: keep forever vs. delete after N successful Arweave anchors; if delete, the Master download endpoint loses its fast-path fallback.

## 4. Stripe

- [ ] **Switch from test mode to live mode** -- replace `pk_test_*` / `sk_test_*` / webhook signing secret with `pk_live_*` / `sk_live_*` equivalents in production `.env`.
- [ ] **Production webhook endpoint** -- register `https://epimage.com/v1/webhooks/stripe` (or current path) in Stripe Dashboard live-mode. Test mode webhooks do NOT carry over.
- [ ] **Products / Prices in live mode** -- recreate any Stripe Product / Price records; test-mode IDs are not valid in live mode. Confirm `Image.stripe_product_id` / `Image.stripe_price_id` handling for the live -> test divergence.
- [ ] **Stripe Connect setup** -- decision required: are creators onboarded as Connect accounts (direct payouts) or does the platform collect 100% and reconcile out-of-band? Affects KYC, tax forms, and payout cadence.
- [ ] **Tax** -- D-12 ships Managed Payments tax automation; confirm tax registration is complete in operating jurisdictions before going live.
- [ ] **Refund + dispute policy** -- document the refund window (current `refundPurchase` flow handles `requested_by_customer`); align with Terms of Service.
- [ ] **PCI attestation** -- Embedded Checkout means most of PCI scope is Stripe's, but SAQ A self-assessment may still be required.

## 4.5 Creator gating

- [ ] **Enable YouTube channel-activity (dormancy) gate** -- set `YOUTUBE_DORMANCY_ENABLED=true` in production `.env`. At MVP the gate is implemented and tested but defaults to off (see [identity.md §2.8.1](cert/identity.md)) so onboarding only checks the subscriber threshold. Enabling makes creators with 100k+ subs but <6 uploads in the last 180 days fail with `YOUTUBE_DORMANT_CHANNEL`. The defaults (6 uploads / 180 days) are configurable via `YOUTUBE_DORMANCY_MIN_UPLOADS` and `YOUTUBE_DORMANCY_LOOKBACK_DAYS`. Verify after enabling: a known-active 100k+ channel still passes; a known-dormant 100k+ channel (lifetime sub count high but no recent uploads) gets the expected error.
- [ ] **Google OAuth app verification** -- the `youtube.readonly` scope is classified as a Sensitive Scope, so launching past Google's "Testing" mode requires Google's OAuth verification review. Without it, only emails on the OAuth client's Test users list can sign in. Required artifacts: privacy policy URL, OAuth scope-use demo video, app homepage URL. Estimated 2-4 weeks review turnaround. Do this BEFORE flipping `epimage.com` DNS at the production server -- otherwise public creators trying to sign up will hit the "Epimage has not completed the Google verification process" 403.

## 4.6 Google Cloud key hardening

- [ ] **Restrict `VITE_GOOGLE_PLACES_API_KEY` by HTTP referrer.** At MVP-test the key has `Application restrictions: None` so dev testing works without setup. Before launch, switch to HTTP referrers in Google Cloud Console -> Credentials -> [the Places key] -> Application restrictions, and allowlist `https://epimage.com/*` (drop the `localhost` entry at prod cutover). The key ships in the client bundle, so without referrer restrictions anyone can copy it from devtools and burn through your $200/month free credit on their own site.
- [ ] **Same for the YouTube OAuth client.** `YOUTUBE_OAUTH_CLIENT_ID` is server-side so it's less exposed, but the secret pair must be rotated -- they were pasted in chat during this session. Google Cloud Console -> Credentials -> [the youtube OAuth client] -> reset secret -> paste the new `YOUTUBE_OAUTH_CLIENT_SECRET` into production `.env`.
- [ ] **`RECAPTCHA_API_KEY` IP restriction.** Currently set to Application restrictions = None (no stable prod server IP yet). Once production has a fixed egress IP, switch the key's Application restrictions to "IP addresses" and add the egress IP -- belt-and-suspenders on top of the API restriction (which is the real protection).

## 4.7 Abuse / report inbox

- [ ] **Set up `abuse@epimage.com`** -- the image-page Report footer (`FooterReport` in `src/ui/Image.tsx`) used to be a mailto link to this address but has since been replaced by an in-app form gated by reCAPTCHA Enterprise (see /docs/cert/image_report.md). The address is still needed for: (a) the optional reporter-confirmation email per OI-04 in image_report.md, and (b) the moderator-out side -- when the queue UI ships, moderators will notify reporters via this address. Route to a monitored inbox / ticketing system; at MVP a forwarded shared inbox is fine.

## 4.8 Email subsystem (R62 §3.5 obligation -- in MVP scope)

Email is **IN MVP** per R71 §1.1 for the R62 §3.5 legal-artifact subset: onboarding_creator (CMA PDF), onboarding_buyer (BMA/MJA PDF), coa_at_mint (four-PDF certification bundle). Other variants (`coa_at_resale`, `report_ack`, `takedown_notice`) deferred with their parent workflows. Subsystem spec: /docs/cert/email.md. ESP decision: ADR-0009 (Postmark). This section's items split into MVP-BUILD (must ship for launch) and LAUNCH-CUTOVER (operational, do at production cutover).

- [x] **ESP picked: Postmark.** Per ADR-0009. Free tier (100/mo) covers pre-launch eval; Basic plan ($15/mo for 10k) at launch. Migration to SES if volume crosses ~100k/mo is bounded to one file.
- [ ] **Click "Request approval" in Postmark dashboard** to lift the test-mode restriction. Test mode only allows sending TO verified Sender Signatures (limits us to the founder's own address). Approval review is typically same-day for transactional use cases. Required BEFORE any real creator / buyer sends, but NOT required for pre-launch integration testing.
- [ ] **Provision sending domain.** `notifications@epimage.com` (or similar). DNS records: SPF, DKIM, DMARC. Domain verification with the ESP.
- [ ] **PDF generation pipeline.** R62's email attachments are PDFs, not just text:
  - PDF Certificate of Authenticity (creator name, title, year, edition, content hash, signature record)
  - PDF Title Document (bill-of-sale equivalent: parties, transaction hash, timestamp, price)
  - Purchase Receipt (CMA/BMA hashes, NFT mint address, transaction hash)
  - Per-image License Acceptance record (click-wrap evidence)
  Library choice: react-pdf, pdfkit, puppeteer-as-PDF-renderer. Templates designed once and parameterized per mint.
- [ ] **Onboarding email at sign-cma.** Sent to creator after CMA signature: PDF of executed CMA + ESIGN consent record + record-retention notice. Hook: end of `POST /v1/creator/sign-cma` transaction.
- [ ] **Onboarding email at MJA capture.** Sent to buyer after first purchase (MJA bundle): PDF of executed BMA / MJA + ESIGN consent record + record-retention notice. Hook: end of MJA capture in BuyWizard flow.
- [ ] **COA email at deed mint.** Sent to BOTH parties (creator + buyer) at successful mint: the 4 PDFs above as attachments. Hook: end of `applyMintSucceeded` in `src/registry/post_mint.ts`. Per R62, this email IS the certificate of authenticity bundle that both parties retain independently of the platform.
- [ ] **Resale + license-migration COA emails.** When resale ships (post-MVP), the same COA package emails again to the new buyer (+ optionally the seller as transfer evidence). Same hook pattern, different mint trigger.
- [ ] **Bounce / suppression handling.** If the ESP reports bounced or complained, mark `users.email_status` accordingly so the moderation tool can flag accounts; do not retry indefinitely. Compliance: CAN-SPAM list-unsubscribe header on every send.
- [ ] **Report-flow emails (R71 §1.2 list).** Lower priority than R62 obligations: optional reporter-confirmation email (per /docs/cert/image_report.md §2.6 when reporter provides email), takedown-decision emails to creator + buyer, abuse-report acknowledgement.
- [ ] **Spec doc.** Create `/docs/cert/email.md` (or `/docs/commerce/email.md` -- the wsd folder structure choice is operational) capturing the trigger inventory, template inventory, ESP integration, and operational concerns (sending volume, deliverability monitoring, suppression list).

## 5. UI

- [ ] **Disable dev-only mocks** -- `Deed.tsx` and any other components with `USE_MOCK = true` switch off; verify real API path renders correctly.
- [ ] **Remove dev auth shim** -- `x-dev-user: creator | buyer | admin` header path in `src/app/api/server.ts` must be disabled in production (currently auth still falls back to it when Magic DID verification is absent). Production auth = Magic DID verification only.
- [ ] **Magic publishable key** -- switch from devnet `pk_live_*` (yes confusingly Magic uses "live" for dev too; this is the Dedicated Wallet project key) to the production Magic project key. Confirm OAuth allowed-origin list includes `epimage.com`.
- [ ] **Production Vite build** -- run `npm run build`; serve the static bundle from `epimage.com` (not the dev server). Confirm `VITE_*` env vars baked in at build time (Magic key, Solana RPC URL, mainnet cluster).
- [ ] **Solana Explorer links** -- remove `?cluster=devnet` from explorer URLs in `Image.tsx` + `Deed.tsx` (or drive from a `VITE_SOLANA_NETWORK` env var). Mainnet URLs have no cluster param.
- [ ] **OG / Twitter meta tags** -- per-image OG image generation for share preview cards (currently absent; sharing a deed link on social shows nothing).
- [ ] **Favicon / brand assets** -- production favicon, apple-touch-icon, manifest.json.
- [ ] **Error monitoring** -- wire Sentry or equivalent for the React app + the Express server.
- [ ] **Analytics** -- decision pending: GA4 / Plausible / nothing? R65 has no privacy guidance yet for this.

## 6. Solana mainnet migration

- [ ] **Fund HOT_MINT_KEY on mainnet** -- ~0.7 SOL for a depth-14 production tree + buffer for ongoing mint fees. Realistic cost depends on tree depth.
- [ ] **Re-run `scripts/cnft_setup.ts` on mainnet** -- generates a fresh mainnet Collection + tree. Set `SOLANA_RPC` to a mainnet endpoint before running. Update `PLATFORM_COLLECTION_PUBKEY` and `PLATFORM_TREE_PUBKEY` in production `.env`.
- [ ] **Re-run `scripts/update_collection_metadata.ts` on mainnet** -- sets the mainnet Collection's URI to `https://epimage.com/collection.json`.
- [ ] **Production-depth tree** -- dev tree is depth=10, canopyDepth=0 (1,024 leaves). Production target is depth=14+ with non-zero canopy depth so proof size fits in a single tx without lookups. Sizing decision should be made before mainnet setup, not after.
- [ ] **Cold custody for COLD_RECOVERY_KEY** -- currently hot at MVP per [deed.md](registry/deed.md) OI-06. Migrate to hardware wallet / multisig before launching. The collection's update_authority is the highest-value key in the system.
- [ ] **Mainnet Helius / Triton RPC** -- production needs a paid RPC plan; free public RPC won't sustain mint volume + DAS reads.

## 7. SOL domain (Solana Name Service)

Register `epimage.sol` on Bonfida's SNS so the platform wallet + collection have an on-chain human-readable identity. Wallets (Phantom, Solflare) auto-display `.sol` names in place of base58 pubkeys; this is the Solana-native equivalent of a verified Twitter handle for the platform.

- [ ] **Check availability** -- search `epimage.sol` on https://sns.id (Bonfida SNS Marketplace). If taken, decide on fallback (`epima.sol`, `epimagedeeds.sol`, etc.).
- [ ] **Register** -- mint the domain to `COLD_RECOVERY_KEY` (or a dedicated brand-custody key). Registration is a one-time SOL payment scaled by name length; budget ~0.5-2 SOL depending on length.
- [ ] **Decide what it resolves to** -- two record types are independent:
  - **SOL record** (wallet pointer): point at the production platform-receive wallet so anyone sending to `epimage.sol` reaches the right pubkey. This is the highest-value resolution; treat it like a DNS A record.
  - **URL record** (website pointer): point at `https://epimage.com` (or the Arweave-hosted permaweb mirror if one ships) so wallet-embedded browsers resolve `epimage.sol` to the site.
- [ ] **Sub-domain strategy for creators** (post-launch, post-MVP) -- Bonfida supports sub-domains under an owned root. Reserve the pattern `<youtube-handle>.epimage.sol` for verified creators as a discoverability surface; decision deferred until creator-verification flow is built.
- [ ] **UI rendering** -- add an optional SNS resolver lookup in `src/ui/Deed.tsx` / `Image.tsx` so when a deed's `current_owner_wallet` or platform creator wallet has a registered `.sol` name, the UI shows `epimage.sol` instead of the truncated pubkey. Use Bonfida's `@bonfida/spl-name-service` or the SNS resolver RPC method.
- [ ] **Brand kit** -- document the `.sol` domain alongside `epimage.com` in any branding / press materials. The two are independent identities; both should be claimed before launch to prevent squatting.

## 8. Post-launch DAS refresh playbook

Reference for the DAS refresh in §2. Helius accepts batched per-asset refresh:

```
POST https://api.helius.xyz/v0/refresh?api-key=<key>
Body: { "id": "<collection_pubkey_or_asset_id>" }
```

Script outline (to be written and committed before launch as `scripts/das_refresh_all.ts`):

1. Query `prisma.deed.findMany({ select: { asset_id: true } })`.
2. POST refresh for each asset_id + the Collection pubkey.
3. Print success/fail counts.
4. Pause + run again after 5 minutes (Helius re-indexes off the latest fetch, not the last refresh request).

---

*Last Updated: 26/06/03*
