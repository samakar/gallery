# Metadata (Commerce)

Per-image and per-purchase metadata management. Owns the `images`-row state surface (title, description, listed_price, status transitions for publishing, visibility) plus `purchases.monogram_text` per-purchase metadata (per [ADR-0002](../adr/adr_0002_monogram_as_metadata.md)). Provides the render-routing decision helper for the public image page (R62 §4.3 / R71 §2.7). Pure Prisma module -- no Stripe, no Cloudinary, no Magic.

## 1. Interface

### 1.1 Inputs

#### publishListing (R71 §2.2 step 9; R71 §3.7 row 8)
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | precondition: `images.status='draft'` (moderation-approved) |
| title | string | non-empty |
| description | string | non-empty |
| creation_date | DateTime | creator-supplied; image creation, not upload date |
| listed_price | int | cents; $20-$2000 range per R71 §1.1 (2000 to 200000) |

#### getListing (R71 §3.7 row 12)
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | anonymous-accessible |

#### getCreatorImages (R71 §3.7 row 9)
| Field | Type | Notes |
|---|---|---|
| creator_user_id | UUID | scopes to caller's own listings |

#### makePublic (R71 §3.7 row 20a; R71 §2.6)
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | |
| owner_user_id | UUID | must equal current owner (identity verifies upstream) |

#### onMintSucceeded
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | called by Registry's `crossmint_webhook` on `mint.succeeded` |

#### captureMonogram (per ADR-0002)
| Field | Type | Notes |
|---|---|---|
| purchase_id | UUID | precondition: `purchases.status='paid'` |
| monogram_text | string | non-empty; from buyer's `start-build` POST body |

#### decideRenderState
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | |
| viewer_user_id | UUID or null | from session (null for anonymous) |

### 1.2 Outputs

#### publishListing → `{ ok, image_id }`
#### getListing → `{ image_id, title, description, listed_price, creation_date, status, visibility, creator_display_name, creator_youtube_channel_handle, creator_headshot_url, creator_bio, ... }`
#### getCreatorImages → `Image[]` (id, title, status, listed_price, created_at)
#### makePublic → `{ ok }`
#### onMintSucceeded → `{ ok }`
#### captureMonogram → `{ ok }`
#### decideRenderState → `'public-presale' | 'public-postsale' | 'private-stub' | 'owner' | 'taken-down' | 'not-found'`

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| IMAGE_NOT_FOUND | `image_id` doesn't exist |
| NOT_OWNER | viewer is not the current owner (`makePublic`) |
| INVALID_LISTING | missing fields OR `listed_price` outside $20-$2000 OR `images.status` not `'draft'` |
| MONOGRAM_REQUIRED | empty `monogram_text` |
| ALREADY_LIVE | `publishListing` called on non-draft image (idempotency: returns ok if already live) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre (publishListing) | `images.status='draft'` (moderation-approved per [cert/moderation.md](../cert/moderation.md)) |
| Pre (makePublic) | viewer is current owner (verified upstream); `images.visibility='private'` |
| Pre (onMintSucceeded) | called by Registry's `crossmint_webhook` only |
| Pre (captureMonogram) | `purchases.status='paid'` |
| Post (publishListing) | `images.status='live'`; `images.published_at` stamped |
| Post (makePublic) | `images.visibility='public'`; `images.privacy_updated_at` stamped; CDN cache for SSR HTML purged |
| Post (onMintSucceeded) | `images.status='sold'`; `images.visibility='private'`; `images.privacy_updated_at` stamped |
| Post (captureMonogram) | `purchases.monogram_text` populated; ready for `runImageOps` to read |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image in `draft` (moderation-approved) | `publishListing(image_id, title, ..., $50)` | `status='live'`, `published_at` set |
| AC-02 | already `live` | `publishListing(...)` (re-call) | idempotent no-op; ok returned |
| AC-03 | `live` + `visibility='private'` + viewer is owner | `makePublic(image_id, owner_id)` | `visibility='public'`, `privacy_updated_at` set, CDN purged |
| AC-04 | non-owner attempts `makePublic` | `makePublic(image_id, other_user)` | `NOT_OWNER` |
| AC-05 | mint succeeds | `onMintSucceeded(image_id)` | `status='sold'`, `visibility='private'` |
| AC-06 | paid purchase | `captureMonogram(purchase_id, "AB")` | `purchases.monogram_text='AB'` |
| AC-07 | live + public + non-owner viewer | `decideRenderState(image_id, viewer)` | `'public-presale'` |
| AC-08 | sold + public + non-owner viewer | `decideRenderState(...)` | `'public-postsale'` |
| AC-09 | sold + private + non-owner viewer | `decideRenderState(...)` | `'private-stub'` |
| AC-10 | sold + private + viewer is owner | `decideRenderState(...)` | `'owner'` |
| AC-11 | taken_down | `decideRenderState(...)` | `'taken-down'` |

## 2. Functional Requirements

### 2.1 Listing Lifecycle
`publishListing` transitions `draft → live` (R71 §3.8 image lifecycle). Validates title (non-empty), description (non-empty), price ($20-$2000 cents), and creation_date (creator-supplied). Stamps `published_at`. Idempotent: re-call on `live` is a no-op.

`getListing` returns the public-facing listing JSON including creator-presence fields (`creator_headshot_url`, `creator_bio`, `youtube_channel_handle`) joined from `creators` per [identity.md §2.7](../cert/identity.md).

`getCreatorImages` returns the creator's own listings (filtered by `creator_id = caller`).

### 2.2 Visibility State Machine (R71 §3.8 privacy lifecycle)

| From | To | Trigger | Side effect |
|---|---|---|---|
| `'public'` (row default at draft creation) | `'private'` | `onMintSucceeded` post-mint hook | stamps `privacy_updated_at` |
| `'private'` | `'public'` | `makePublic` (owner Share, one-way for owner tenure) | stamps `privacy_updated_at`; CDN purge |
| `'public'` (post-resale, MMP) | `'private'` | post-transfer hook | MMP scope |

`makePublic` is idempotent and **one-way** for the owner's tenure -- no reverse endpoint exposed. Resale resets to `'private'` automatically at MMP via post-transfer hook.

### 2.3 Monogram Capture (per ADR-0002)
`captureMonogram` is called inside the buyer's `POST /v1/purchases/:id/start-build` handler (runImageOps owns the route). Persists `monogram_text` to `purchases.monogram_text` **before** spawning the build. `runImageOps` reads it back when calling `image_gen.generateShareCopy`.

Per ADR-0002, the build-trigger decision from ADR-0001 (buyer POST, not webhook) is preserved; only the persistence-drop is reversed.

### 2.4 Render-Routing Decision
`decideRenderState(image_id, viewer_user_id)` maps state to a render label:

| Condition | Render state |
|---|---|
| `images.status='taken_down'` | `'taken-down'` (route handler returns 451) |
| `images` row absent | `'not-found'` (404) |
| `viewer_user_id == current_owner_user_id` (any state) | `'owner'` |
| `images.visibility='private'` AND viewer is not owner | `'private-stub'` (R71 §2.6 / R62 §4.7) |
| `images.status='live'` AND `visibility='public'` | `'public-presale'` |
| `images.status='sold'` AND `visibility='public'` | `'public-postsale'` |

Current owner = `purchases.owner_id` where `status='confirmed'`, latest by `completed_at` (null if no confirmed purchase yet, i.e. pre-sale).

The Express SSR route handler at `GET /:imageId` calls `decideRenderState`, then templates the visibility-appropriate OG / Twitter Card metadata per R71 §2.7. React SPA hydrates and reads the same state.

### 2.5 CDN Cache Purge
`makePublic` invalidates the Cloudinary purge keyed on `image_id` so link-preview crawlers re-fetch the public SSR HTML. Cloudinary asset URLs themselves don't change (deterministic `public_id`); only the SSR response cache needs purging.

### 2.6 Idempotency
All state transitions are idempotent against existing state:
- `publishListing` on already `'live'` → no-op
- `makePublic` on already `'public'` → no-op
- `onMintSucceeded` on already `'sold'` → no-op
- `captureMonogram` re-call → updates `monogram_text` (last-write-wins; rare edge case)

## 3. Architecture

### 3.1 One Module, Three Concerns
`metadata.ts` groups three concerns that all operate on `images` / `purchases` row state:
- Listing CRUD (creator-side authoring + reads)
- Visibility state machine (Vault default + owner Share + post-mint hook)
- Monogram capture (per-purchase, per ADR-0002)

Plus the pure `decideRenderState` helper used by SSR routing.

### 3.2 Owner Resolution via Purchases Join
"Current owner" of an image is the `owner_id` of the latest `confirmed` purchase:
```
prisma.purchase.findFirst({
  where: { image_id, status: 'confirmed' },
  orderBy: { completed_at: 'desc' }
})
```
Returns null pre-sale; the route handler treats null-owner viewer as anonymous.

### 3.3 No External Vendors
This module never calls Stripe, Cloudinary (except CDN purge in §2.5), or Magic. Pure Prisma + decision logic.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency (CRUD writes) | <= 50 ms p95 |
| Latency (`decideRenderState`) | <= 15 ms p95 (1-2 indexed Prisma reads) |
| Audit | Pino `db.mutation` log lines via R71 §3.6 mutation-logging middleware |
| Idempotency | All state transitions idempotent against current row state |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `images` table (Prisma) | title, description, listed_price, status, visibility, privacy_updated_at, published_at, creator_id |
| `purchases` table (Prisma) | owner resolution + `monogram_text` persistence |
| `creators` table (Prisma) | read-only join for creator presence fields on `getListing` |
| `users` table (Prisma) | read for `creators.user.wallet_address` (when needed) |
| identity | upstream owner / role check on `makePublic` and `publishListing` |
| Cloudinary CDN purge API | invalidate SSR response on visibility flip (§2.5) |
| runImageOps (TBD) | callbacks: `captureMonogram` (before spawn) + reads `purchases.monogram_text` (during spawn) |
| Registry crossmint_webhook (TBD) | calls `onMintSucceeded` on `mint.succeeded` |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Bulk creator dashboard pagination for `getCreatorImages` -- deferred until volume > 1000 listings per creator |
| OI-02 | CDN purge fallback if Cloudinary purge API fails -- accept eventual consistency (TTL expiry) at MVP |
| OI-03 | Edit / Delete of listings before publish -- deferred to MMP per R71 §3.4 (only publish path active at MVP) |
| OI-04 | `images.status='taken_down'` transitions are owned by [cert/takedown.md](../cert/takedown.md) and [cert/moderation.md](../cert/moderation.md) -- this module reads but doesn't write `taken_down`. Boundary intentional |
| OI-05 | Stale `'paid'` purchases (per [ADR-0001](../adr/adr_0001_buyer_triggered_build.md) OI) -- if buyer never POSTs `start-build`, `monogram_text` stays null. Sweeper / auto-default policy TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| **ADR-0001** | Buyer-triggered build (preserved); webhook stays state-only |
| **ADR-0002** | Monogram persistence restored as metadata (this module owns capture) |
| image_gen | reads Original + builds variants; `generateShareCopy` accepts inline `monogram_text` (sourced from `purchases.monogram_text` by runImageOps) |
| payments | webhook transitions to `'paid'`; this module's `onMintSucceeded` runs on Registry callback |
| identity | owner / role verification upstream |
| moderation | approves draft listings (gates `publishListing` precondition) |
| takedown | owns `taken_down` writes (separate concern in cert/) |
| runImageOps (TBD) | calls `captureMonogram` before spawning; reads `purchases.monogram_text` for `image_gen.generateShareCopy` |
| renderer (TBD) | uses `decideRenderState` for SSR; cache logic separate |
| R71 §2.6 | Owner Privacy and Share Flow |
| R71 §2.7 | Public image page + render routing |
| R71 §3.4 | Image page render states |
| R71 §3.6 | images + purchases data model |
| R71 §3.7 rows 8, 9, 12, 20a | listing endpoints + makePublic |
| R71 §3.8 | image lifecycle + privacy state machine |
| R62 §4.3 | Image page composition + render states |
| R62 §4.7 | Privacy Architecture / Vault mode |

---
*Last Updated: 05/29/26 15:30*
