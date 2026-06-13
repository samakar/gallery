# Card 3: List (Workflow Sequence)

Per-asset workflow for creator listing publication. Begins when Card 1 (Certify) + Card 2 (Image Creation) complete successfully (image at `draft`, Original encrypted, Listing preview + Thumbnail built); ends when the listing is live at `epimage.com/<image-id>`. Authoritative MVP steps per R71 §2.2 step 9. Thin workflow -- mostly delegates to `metadata.publishListing`.

Includes the **unlist sub-flow** per [ADR-0003](../adr/adr_0003_unlist_before_edit.md) -- creators may take a `'live'` listing off sale to edit metadata, then re-invoke this same workflow to re-list.

## 1. Preconditions

| Condition | Source |
|---|---|
| Creator authenticated | identity.verifyDidToken |
| Image is moderator-approved | `images.status='draft'` (post-moderation per cert/moderation.md) |
| ISA signed | `images.signing_event_id_authorship` non-null (esign) |
| Master encrypted at rest | `images.dek_wrapped` non-null + `EncryptedMasterStore` entry at `<image_id>` (written at Card 1 by `POST /v1/images` per arweave_master.md §2.7) |
| Cloudinary asset uploaded | public_id `<image_id>` (type:'private' per image_gen.md §2.10). Listing-preview + Thumbnail are URL transformations of the same asset, not separate uploads -- rendered lazily via `buildListingPreviewUrl` / `buildThumbnailUrl` (signed URLs, 60s TTL). |

## 2. Step Sequence

### 2.1 Publish (draft → live)

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | Creator enters listing metadata | Web App | -- | Form: title, description, creation_date, listed_price (whole-dollar, $5-$500 per metadata.md §2.1) | -- |
| 2 | Submit | Web App + Backend | `POST /v1/images/:imageId/list` → metadata.publishListing | `images.status='live'`; `images.visibility='public'`; `images.published_at` stamped | INVALID_LISTING |
| 3 | Listing live at `epimage.com/<image-id>` | Web App (SSR) | metadata.decideRenderState → `'public-presale'` | Public image page renders Listing preview + creator-presence block + framing chrome + "Own this" CTA per R62 §4.3 | -- |
| 4 | Creator shares link | Web App | -- | Per-creator-per-post UTM-tagged link; Plausible custom events fire (`image_page_visit`, etc.) | -- |

### 2.2 Unlist (live → draft), per ADR-0003

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| U1 | Creator on owner-listed view clicks "Take off sale to edit" | Web App | -- | -- | -- |
| U2 | Submit | Web App + Backend | `POST /v1/images/:imageId/unlist` → metadata.unlistListing | `images.status='draft'`; `images.visibility='private'`; `published_at` preserved | NOT_LIVE, FORBIDDEN |
| U3 | Image disappears from public discovery | Web App (SSR) | metadata.decideRenderState → `'private-stub'` for non-creator viewers | -- | -- |
| U4 | Creator returns to owner-editable view | Web App | -- | Edits flow normally; re-publish via 2.1 step 2 | -- |

## 3. State Transitions

`images.status`:
- `draft → live` (step 2, publish)
- `live → draft` (step U2, unlist per ADR-0003)

`images.visibility`:
- `private → public` (step 2, publish)
- `public → private` (step U2, unlist)

`images.published_at`:
- `null → <ISO timestamp>` (step 2 first publish)
- overwritten on re-publish after unlist (step 2 again); unlist itself preserves the prior value

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 2 (validation) | `INVALID_LISTING` if missing fields OR price out of `$5-$500` range (server.ts `PRICE_MIN_CENTS=500` / `PRICE_MAX_CENTS=50000`, whole-dollar) OR price not a multiple of 100 cents; creator re-enters; no DB write |
| 2 (already live) | Idempotent: returns ok; no state change (metadata.publishListing handles) |
| 2 (not in draft) | Rejects: image must be moderator-approved first (precondition violation surfaces upstream) |
| U2 (not live) | `NOT_LIVE`; idempotent on already-`draft` |
| U2 (non-creator caller) | `FORBIDDEN`; only `images.creator_id` may unlist |

## 5. Subsystems Invoked

| Subsystem | Step |
|---|---|
| identity | 1, 2 (auth + creator role check) |
| metadata | 2 (publishListing) |
| moderation | precondition only -- image must be in `draft` (moderator-approved) |
| image_gen + cert/crypto + EncryptedMasterStore | precondition only -- Master encrypted + Cloudinary asset uploaded at Card 1 (`POST /v1/images`); Cloudinary variants are URL transformations, no separate build step |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Edit and delete of pre-sale listings -- **fully resolved at MVP**: edit via [ADR-0003](../adr/adr_0003_unlist_before_edit.md) (unlist-then-edit-then-relist), delete via [ADR-0004](../adr/adr_0004_pre_sale_delete.md) (`DELETE` in `pending_review` / `draft`). Live requires unlist-first for both. Post-sale (`sold` / `taken_down`) remains immutable. |
| OI-02 | Listing duplication / similar-image warning -- deferred to MMP (uniqueness gate in cert/deferred/drm_uniqueness.md, also deferred) |
| OI-03 | Creator dashboard "stale draft" UX -- if creator never publishes a moderator-approved draft, it sits in `draft` forever. Sweeper / nudge email TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| metadata.md | `publishListing` + `unlistListing` + `deleteImage` endpoints |
| ADR-0003 | Editable-until-first-sale via unlist transition |
| ADR-0004 | Pre-sale delete; post-sale immutable |
| moderation.md | Card 1 precondition -- draft status requires moderator approval |
| image_gen.md | Card 2 precondition -- Original encryption + Listing preview / Thumbnail builds |
| certify_wsd.md (cert) | Card 1 upstream (image-id assignment, encryption, ISA, variant builds) |
| purchase_wsd.md | downstream -- Card 4 begins on `live` listing |
| R71 §2.2 step 9 | Authoritative step |
| R71 §3.6 `images` | Data model |
| R71 §3.7 row 8 | `POST /v1/creator/images/:imageId/publish` endpoint |
| R71 §3.8 image lifecycle | `draft → live` transition |
| R62 §3.1 Card 3 | Reference card |
| R62 §4.3 | Public image page composition (post-publish render target) |

---
*Last Updated: 26/06/10 18:30*
