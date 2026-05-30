# Card 3: List (Workflow Sequence)

Per-asset workflow for creator listing publication. Begins when Card 1 (Certify) + Card 2 (Image Creation) complete successfully (image at `draft`, Original encrypted, Listing preview + Thumbnail built); ends when the listing is live at `epimage.com/<image-id>`. Authoritative MVP steps per R71 §2.2 step 9. Thin workflow -- mostly delegates to `metadata.publishListing`.

## 1. Preconditions

| Condition | Source |
|---|---|
| Creator authenticated | identity.verifyDidToken |
| Image is moderator-approved | `images.status='draft'` (post-moderation per cert/moderation.md) |
| ISA signed | `images.signing_event_id_authorship` non-null (esign) |
| Original encrypted at rest | `images.dek_wrapped` non-null (image_gen.encryptAndStoreOriginal) |
| Listing preview + Thumbnail built | Cloudinary `public_id` `<image_id>-listing` + `<image_id>-thumb` exist (image_gen) |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | Creator enters listing metadata | Web App | -- | Form: title, description, creation_date, listed_price ($20-$2000) | -- |
| 2 | Submit | Web App + Backend | `POST /v1/creator/images/:imageId/publish` → metadata.publishListing | `images.status='live'`; `images.published_at` stamped | INVALID_LISTING |
| 3 | Listing live at `epimage.com/<image-id>` | Web App (SSR) | metadata.decideRenderState → `'public-presale'` | Public image page renders Listing preview + creator-presence block + framing chrome + "Own this" CTA per R62 §4.3 | -- |
| 4 | Creator shares link | Web App | -- | Per-creator-per-post UTM-tagged link; Plausible custom events fire (`image_page_visit`, etc.) | -- |

## 3. State Transitions

`images.status`:
- `draft → live` (step 2)

`images.published_at`:
- `null → <ISO timestamp>` (step 2)

`images.visibility`:
- `public` (row-default, pre-sale must be discoverable -- no transition at this card)

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 2 (validation) | `INVALID_LISTING` if missing fields OR price out of $20-$2000 range; creator re-enters; no DB write |
| 2 (already live) | Idempotent: returns ok; no state change (metadata.publishListing handles) |
| 2 (not in draft) | Rejects: image must be moderator-approved first (precondition violation surfaces upstream) |

## 5. Subsystems Invoked

| Subsystem | Step |
|---|---|
| identity | 1, 2 (auth + creator role check) |
| metadata | 2 (publishListing) |
| moderation | precondition only -- image must be in `draft` (moderator-approved) |
| image_gen | precondition only -- Original encrypted + Listing preview/Thumbnail built at Card 2 |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Edit / Delete of listing post-publish -- deferred to MMP per R71 §3.4 |
| OI-02 | Listing duplication / similar-image warning -- deferred to MMP (uniqueness gate in cert/deferred/drm_uniqueness.md, also deferred) |
| OI-03 | Creator dashboard "stale draft" UX -- if creator never publishes a moderator-approved draft, it sits in `draft` forever. Sweeper / nudge email TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| metadata.md | `publishListing` endpoint |
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
*Last Updated: 05/29/26 16:00*
