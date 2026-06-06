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
| D-11 | Encrypted Master upload | partial | Arweave upload falls back to a manifest JSON when the Turbo wallet runs out of credit; ciphertext stays on the platform DB | R62 §2.3 / arweave_master.md §2.4 (encrypted Master must reach Arweave) |
| D-12 | Tax handling | shipped | Stripe Managed Payments handles tax automation; we do not set `automatic_tax` separately | R71 §3.7 (tax surface assumed to be managed by Connect-direct flow) |
| D-13 | Creator landing URL | shipped | Canonical URL is `epimage.com/c/<handle>` (handle stored with leading `@` in DB; URL omits it). Bare `epimage.com/<handle>` 301-redirects to the canonical form for legacy / external links. The `/c/` path prefix sidesteps email-fragment misreading of `/@<handle>` and removes the 5-char reserved-namespace collision with image_ids. | R71 §3.4 ("Public Creator Page deferred to post-MVP") |
| D-14 | Mint vendor + standard | migrated 2026-06-03 | Self-mint Bubblegum V2 cNFT under MPL-Core Collection (Path 4) is the operative implementation per /docs/registry/cnft_dispatch.md. Test mint succeeded on devnet. Crossmint code retired to /trash/. R62 §2.3 + R71 §3.7 still reference Crossmint in spec text -- captured in /docs/registry/r62_r71_alignment.md for the next R62/R71 revision pass. | R62 §2.3 / R71 §3.7 (spec text not yet aligned) |

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

## D-14: Mint vendor + standard (Crossmint cNFT replaced by self-mint Bubblegum V2 cNFT)

**Status: migrated 2026-06-03.** Self-mint pipeline is operational on devnet; first end-to-end mint succeeded (asset_id 7wAPe8piSeiBBtJGGzgiZcgDwiKSRVbpRrUmrTcBoNnq, devnet tx 5RAKrX1Xiex6LC3dZmeZDH7ZJ8sHeCQouBExfqCEyes6XbbEVHgJQKEKrtLtqrtV1gWTkEcxpYrXnjPUT1TyXh9c). Crossmint code retired to /trash/. R62 + R71 spec-text alignment pending per /docs/registry/r62_r71_alignment.md.

**What R62 + R71 still say.** R62 §1 lists Crossmint as a Registry primitive; §2.3 + §3.1 Card 5 / Card 8 + §4.5 specify the Crossmint Minting API and Metaplex Core UpdateDelegate / transfer plugins. R71 §3.7 names the Crossmint Minting API as the deed-mint vendor. These spec edits are captured but not applied -- see r62_r71_alignment.md.

**What we ship.** Self-mint Bubblegum V2 cNFT under a platform-owned MPL-Core Collection per /docs/registry/mint_architecture.md. Implementation in /src/registry/cnft_dispatch.ts (Path 4: per-tree mutex, predict asset_id, Arweave upload, mintV2 with permanent URI, advisory post-mint verification). Post-mint finalization in /src/registry/post_mint.ts (vendor-agnostic, extracted from the retired crossmint_webhook). Architecture details:
- Collection-level PermanentFreezeDelegate (frozen=true, authority=COLD_RECOVERY_KEY) + PermanentTransferDelegate (authority=HOT_RESALE_KEY) + BubblegumV2 plugin
- Path 4 mint sequence (per-tree mutex reserves asset_id; Arweave upload completes before mint; single mintV2 with permanent Arweave URI)
- Three signers per mint: HOT_MINT_KEY (payer), HOT_OPS_KEY (tree authority), COLD_RECOVERY_KEY (collection authority)
- Procedural-multisig admin tool for INV-06 enforcement -- still TBD per OI-01 in mint_architecture.md
- Embedded provenance manifest + per-event Arweave snapshots -- post-MVP, not yet implemented

**Why.** Crossmint's vendor-held tree authority made INV-06 enforcement impossible at the protocol level and gated every standard change behind a per-project support ticket. Bubblegum V2's collection-level permanent plugins closed the soulbound-enforcement gap that originally motivated keeping Crossmint as the simplest path. Cost economics also favor self-mint (~$0.001 per mint vs Crossmint's vendor margin on top of bare-chain cost). Full reasoning in /docs/registry/mint_architecture.md §2 and §3.5.

**Migration status.** Existing Crossmint-issued test data was wiped 2026-06-03 (zero real users). Production migration policy (OI-06 in mint_architecture.md) is therefore moot for this cohort. Retired implementation files live at /trash/src/registry/crossmint_*.ts and /trash/docs/registry/crossmint_*.md -- delete the folder once R62 + R71 spec-text alignment lands (per r62_r71_alignment.md). The .env vars CROSSMINT_API_KEY + VITE_CROSSMINT_CLIENT_KEY are commented out but not deleted -- next .env audit.

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
| Mint architecture decision | /docs/registry/mint_architecture.md |
| Self-mint dispatcher target | /docs/registry/cnft_dispatch.md |
| R62 + R71 pending alignment | /docs/registry/r62_r71_alignment.md |

---

*Last Updated: 26/06/03 02:30*
