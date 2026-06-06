# UI Design Reference

Compact compilation of theme + page-design rules from R71 + R62. Canonical sources are noted per row; consult this doc for fast lookup when writing components.

## 1. Theme + Library Stack (R71 §3.2)

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS |
| Component / theme | **DaisyUI v5.5** with **`lofi` theme** (high-contrast monochrome; gallery-print aesthetic) |
| Install | `@plugin "daisyui"` in the Tailwind config |
| Apply | `data-theme="lofi"` on `<html>` |
| Preferred classes | DaisyUI semantic: `btn`, `card`, `modal`, `form-control`, etc. -- over raw Tailwind utilities |

No dark variant -- `lofi` is the only theme spec'd at MVP.

## 2. Typography Registers (R62)

Six registers; each has a specific typeface and scope. Mixing is disallowed.

| Register | Typeface | Where it applies | Where it doesn't |
|---|---|---|---|
| Gallery | **EB Garamond Italic Regular** (Google Fonts) | Listing-preview "Epimage" watermark; Gallery brand wordmark | General UI copy; Creator Page |
| Gallery-wall-label (monogram) | Restrained neutral grotesque OR text serif; warm off-white 75-85% opacity + soft drop shadow; cap-height ~27-32 px on 1080 px Share Copy | The buyer's monogram in-pixel on Keepsake Copy + Share Copy | Display, brand, script, calligraphy faces **prohibited** |
| Museum-label | Institutional caption -- small, neutral, recessive | Image-page framing chrome (title, creator name, creation date, edition tier and number) | Hero; conversion bar |
| URL-text (in-pixel) | **IBM Plex Mono** Medium/Semi-Bold (Google Fonts); default slashed zero + distinct `1`/`l`; cap-height ~32-43 px on Share Copy; fixed light fill + ~2 px dark stroke | Lower-right vertical-edge URL on Share Copy | Proportional UI typefaces (Inter, Roboto) **excluded** -- disambiguating glyphs gated behind OpenType features Cloudinary can't reach |
| Social-promotion | -- (deliberately excluded throughout) | -- | Creator-presence block is gallery-register, not social-promotion |
| URL-shortener | -- (deliberately excluded) | -- | Why `epimage.com` was picked over `jpg1.me`-class options |

**General UI copy = DaisyUI `lofi` theme defaults**, NOT EB Garamond. R62 §4.3 explicitly: "the Creator Page UI follows the product's overall typography system, which is a separate decision from this composition spec."

**In-pixel typography is delivered via Cloudinary's Google Fonts integration** (`<FontName>@google` syntax, released 2026-05-28) -- no custom font upload to Cloudinary needed. Implementation in [/src/commerce/image_gen.ts](../src/commerce/image_gen.ts). Watch-out: weight specifiers must be **numeric** (`font_weight: 500`), not named (`'medium'`) -- the Google Fonts CSS API rejects names.

## 3. Image Page Composition (R62 §4.3)

The most spec'd page in the system.

| Zone | Content | Treatment |
|---|---|---|
| Hero (largest area, image-dominant) | Listing preview 1080 px + centered italic "Epimage" outline watermark | Image owns the visual weight; framing chrome cannot compete |
| Adjacent block (right of hero on desktop; below on mobile) | Creator-presence: `creator_headshot` + verified-creator badge + first-person `description` + optional `context_video_url` link-out | Gallery-register typography -- **not** social-promotion register |
| Framing chrome (above and below hero) | Title + creator name (text link to Creator Page) + creation date + edition tier and number | Museum-label register |
| Conversion bar (below creator-presence on desktop; fixed bar on mobile) | Listing price (plain numeric -- no chart/floor/banner) + **"Own this"** primary CTA + **"View deed"** secondary link | Primary action grouped with secondary |
| Below the fold | Provenance summary + rights summary + optional redundant "View deed" link | Convenience for buyers who scroll past the conversion bar |

**Canonical CTA wording**: **"Own this"** -- not Buy / Purchase / Acquire / Invest. Carries R67 §5.8 deed-as-receipt principle; avoids the investment register R67 §6.6 disallows.

**Visual-weight hierarchy** (preserved across breakpoints): image **>** creator-presence **>** conversion bar.

**Responsive**:
- Desktop: hero + creator-presence side-by-side; conversion bar below
- Mobile: vertical stack (hero -> creator-presence -> conversion bar -> below-fold)
- Hierarchy never rearranges

## 4. Image Page Render States (R71 §3.4 + R62 §4.7)

Same URL `epimage.com/<image-id>`; render branches on (`images.visibility`, sold-status, viewer-is-owner):

| State | Trigger | Renders |
|---|---|---|
| Default-public (pre-sale) | visibility=public, sold=false | Listing preview + price + creator credit + "Own this" CTA + "View deed" link |
| Default-public (post-sale) | visibility=public, sold=true | Share Copy variant + monogram + creator credit + "View deed" (no Buy) |
| Default-private stub | visibility=private, viewer != owner | Blank card with lock icon + `image <image-id> is private`; no creator credit, no Buy, no Report; `<meta name="robots" content="noindex,nofollow">`; generic OG/Twitter Card |
| Default-owner | viewer == current owner (any visibility) | Share Copy + deed metadata + Collection link + Share affordance (privacy-flip modal when private); "Click Share to make public" banner when private |
| Owner-editable | is_creator AND status ∈ {pending_review, draft} | Metadata form (title, description, price, creation date) + Save changes + "Put on sale" CTA (greyed with checklist until moderated + complete); pending shows "Awaiting review" notice |
| Owner-listed | is_creator AND status='live' | Read-only summary + "Take off sale to edit" CTA -- per [ADR-0003](adr/adr_0003_unlist_before_edit.md), live listings require an unlist transition before edits |
| Buy state | "Buy" click (formerly "Own this") | **BuyWizard** single modal -- progress strip `1. Sign in -> 2. Sign documents -> 3. Payment -> 4. Personalize your edition`. Step 1 triggers Magic OAuth and resumes the wizard via sessionStorage + `?buy=resume`; step 2 is the bundled MJA + License Acceptance ESIGN click-wrap (License-only on returning); step 3 is Stripe Embedded Checkout with `redirect_on_completion: 'never'` so completion fires the in-place `onComplete` callback (no page navigation); step 4 captures the monogram and the **"Mark my image"** button click closes the wizard and dispatches `start-build`. Cancel at any step returns to Default-public. Build retries are server-driven per ADR-0007 -- buyer sees "Issuing your deed..." through any infrastructure failure, never a Retry button (/docs/divergences.md D-01, D-02, D-04, D-05) |
| Confirmation state | post-Sign | Receipt summary + License Acceptance summary + deed details + Collection link |

## 5. Deed-Content Page (R62 §4.3)

New surface at `epimage.com/<image-id>/deed`. Dedicated route; may also render as a modal on the image page.

| Field state | Treatment |
|---|---|
| Firm (determined by Card 3) | Normal weight |
| TBD (filled at Card 5 issuance) | Recessive: lighter weight, italic, or a small "to be issued" tag -- title-insurance commitment pattern (R67 §5.18) |

Pre-purchase: shows the deed as it will be issued; the buyer reads TBD fields as their own slot. Post-purchase: renders the actual on-chain record.

## 6. Other MVP UI Rules

| Rule | Source |
|---|---|
| **No CTA on Creator Page** -- "Own this" lives only on individual image pages; Creator Page routes to them but carries no purchase action | R62 §4.3 |
| **No aggregated metrics** -- no follower counts, view counts, aggregate sale metrics, sort-by-price, "trending" sorts, appreciation analytics | R62 §4.3, R67 §5.15 / §6.6 |
| **Site-wide footer Report link**: `mailto:abuse@epimage.com?subject=Report%20<image-id>` on every page | R71 §3.4 |
| **SSR only on `/[image-id]`** for OG / Twitter Card; all other routes client-rendered | R71 §2.7 |
| **`noindex` headers** on private image pages | R62 §4.3 / §4.7 |

## 7. MVP Page Inventory (R71 §3.4)

| # | Page | URL | Viewer | Status |
|---|---|---|---|---|
| 1 | Sign-in | `/signin` | Anonymous | MVP |
| 2 | Creator dashboard | `/creator` | Authenticated creator | MVP |
| 3 | Image page (multi-state per §4) | `/[image-id]` | Anonymous / non-owner / owner | MVP |
| 4 | Buyer Collection | `/collection` | Authenticated buyer | MVP |
| 5 | Deed-content page | `/[image-id]/deed` | Anonymous (canonical per R62 §4.3) | MVP |
| 6 | Moderator review queue | `/admin/reviews` | Moderator (founder at MVP) | MVP |

**Deferred to post-MVP**: Public Creator Page (creator-handle landing surface aggregating all listings; full composition spec'd in R62 §4.3 but deferred per R71 §3.4); Account / Settings page; Per-buyer monogram-decision UI on Image page Default-owner state.

## 8. Cross-References

| Doc | What |
|---|---|
| R71 §3.2 | DaisyUI `lofi` theme + library stack |
| R71 §3.4 | MVP page inventory + render states |
| R71 §2.6 / §2.7 | Privacy / Share flow + public image page rendering |
| R62 §4.3 | Image page composition + Deed-content page + Creator Page composition |
| R62 §3.1 | Creator-account display fields (`creator_headshot`, `creator_bio`, `creator_channel_url`) |
| R62 §3.2 | Per-image provenance metadata (first-person `description`, `context_video_url`) |
| R62 §2.2 | EB Garamond Italic + Listing-preview watermark + monogram typography & sizing |
| R62 §7.6 | IBM Plex Mono URL-text rendering contract |
| R67 §5.8 | "Own this" rationale (deed-as-receipt) |
| R67 §5.15 / §6.6 | No-aggregated-metrics rationale |
| R67 §5.16 | Creator-presence + headshot rationale |
| R67 §5.17 | Watermark composition rationale |
| R67 §5.18 | Deed-content page rationale |
| R67 §5.19 | Image page composition rationale |
| R67 §5.20 | Creator Page rationale |
| docs/cert/identity.md §2.7 | Creator profile fields captured at sign-cma |
| docs/sad.md §2.2 | Commerce catalog / presentation pointer |

---
*Last Updated: 05/31/26 19:45*
