# Renderer (Commerce)

Deed-holder Share Copy download surface. Owns `GET /v1/deeds/:mintAddress/social-copy-download` (R71 §3.7 row 20). Verifies ownership via Registry's `crossmint_lookup`, lazily caches Share Copy bytes from Cloudinary CDN to local FS on first request, issues short-lived signed URLs pointing at platform-served bytes. The local cache that image_gen externalized (`/var/share_copies/`) lives here.

## 1. Interface

### 1.1 Inputs

#### serveShareCopyDownload
| Field | Type | Notes |
|---|---|---|
| mint_address | string | Solana base58 NFT address (path param) |
| viewer_user_id | UUID | from authenticated session |

### 1.2 Outputs

#### serveShareCopyDownload
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| signed_url | string | short-lived URL to local-FS bytes (`/platform/share-copies/<image-id>-<owner-ordinal>.jpg?sig=...&exp=...`) |
| expires_at | string | ISO 8601 UTC; 5 minutes from now |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| DEED_NOT_FOUND | `mint_address` not in `deeds` table |
| NOT_OWNER | viewer's wallet does not match current on-chain owner (per Crossmint lookup) |
| SHARE_COPY_NOT_BUILT | `purchases.status != 'confirmed'` (build not yet complete) |
| CACHE_FILL_FAILED | Cloudinary CDN fetch failed on cache miss (after retries) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | viewer authenticated; session has `wallet_address` populated |
| Pre | `mint_address` exists in `deeds`; corresponding `purchases.status='confirmed'`; `images.arweave_uri` populated; Cloudinary Share Copy public_id `<image_id>-share-<owner_ordinal>` exists |
| Post (cache hit) | signed URL returned pointing at existing local-FS bytes |
| Post (cache miss) | Cloudinary CDN bytes fetched + written to `/var/share_copies/<image-id>-<owner-ordinal>.jpg`; signed URL returned |
| Post (ownership mismatch) | `NOT_OWNER`; no bytes served; no cache fill |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | viewer is owner; cache hit | `serveShareCopyDownload(mint_address, viewer)` | signed URL returned in <= 200 ms |
| AC-02 | viewer is owner; cache miss | same | Cloudinary CDN fetched; bytes written to `/var/share_copies/`; signed URL returned in <= 5 s |
| AC-03 | viewer is not on-chain owner | same | `NOT_OWNER`; no fill, no serve |
| AC-04 | mint_address absent | same | `DEED_NOT_FOUND` |
| AC-05 | build not yet complete | same | `SHARE_COPY_NOT_BUILT` |
| AC-06 | static-serve route hit with expired signature | (browser fetches signed_url after 5 min) | 401 + signature-expired error |

## 2. Functional Requirements

### 2.1 Ownership Verification (R71 §3.7 row 20)
| Step | Detail |
|---|---|
| Lookup | `prisma.deed.findUnique({ where: { mint_address } })` → fail `DEED_NOT_FOUND` if absent |
| On-chain check | `Registry.crossmint_lookup.getOwner(mint_address)` → returns `current_owner_wallet` |
| Compare | If `current_owner_wallet !== viewer.wallet_address` → `NOT_OWNER` |
| Build check | `prisma.purchase.findFirst({ where: { image_id: deed.image_id, status: 'confirmed' } })` -- if not found → `SHARE_COPY_NOT_BUILT` |

Every request does a fresh Crossmint lookup -- wallet transfers (post-MVP resale) immediately revoke prior owner's access.

### 2.2 Lazy Cache Fill
| Step | Detail |
|---|---|
| Cache path | `/var/share_copies/<image-id>-<owner_ordinal>.jpg` |
| Check | `fs.stat(cache_path)` -- exists → cache hit; else cache miss |
| Fetch on miss | Cloudinary delivery URL constructed from deterministic `public_id` `<image_id>-share-<owner_ordinal>` via `cloudinary.url(public_id, { sign_url: true, expires_at: now+60 })` -- short-lived signed CDN URL |
| Write | Stream Cloudinary response → atomic write to local FS (tempfile + rename) |
| Retry | Cloudinary fetch retries 3 times with exponential backoff (1s, 4s, 16s); exhausted → `CACHE_FILL_FAILED` |

Single-flight guard: if multiple concurrent requests miss cache for the same key, only one fetches; the others wait (OI-02).

### 2.3 Signed URL Minting
| Step | Detail |
|---|---|
| URL shape | `/platform/share-copies/<image-id>-<owner_ordinal>.jpg?sig=<hmac>&exp=<unix_timestamp>` |
| Signature | `sig = hmac_sha256(path + exp, PLATFORM_SIGNING_SECRET)` |
| TTL | `exp = now + 300 seconds` (5-minute window) |
| Verification | Express middleware on `/platform/share-copies/` route: verify `sig` + `exp`; serve file from local FS on pass; 401 on fail |

### 2.4 Response Headers
- `Cache-Control: no-store` on the JSON response (signed URLs are single-use; don't let browsers cache the URL itself)
- `Cache-Control: private, max-age=300` on the static-serve route (cached client-side until expiry)

### 2.5 Owner Ordinal Resolution
At MVP, owner_ordinal is always `1` (no resale). Resolved from `deeds.owner_id` history -- at MVP it's the only owner. Post-MVP resale increments the ordinal per transfer (matches `image_gen.generateShareCopy` resale re-personalization, both deferred).

## 3. Architecture

### 3.1 Lazy Cache, Not Pre-Built
The cache is populated on first request, not at build time. Saves disk if a buyer never downloads. Trade-off: first download slower (Cloudinary fetch + write).

### 3.2 Ownership Check Per Request
Every serve does a fresh Crossmint lookup. No in-memory caching of ownership -- wallet transfers (MMP resale) immediately revoke prior access.

### 3.3 Static-Serve via Signed URL
At MVP the platform's Express app handles both the JSON endpoint and the static-serve route. nginx or a CDN can take over the static-serve route later without changing the signature scheme.

### 3.4 No Direct Cloudinary Exposure
The signed URL points at the platform, not at Cloudinary. The platform fronts Cloudinary entirely -- the buyer never sees a Cloudinary URL. Preserves brand surface + lets the platform revoke access by stopping serves; Cloudinary cache outside our control would not.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Cache-hit latency | <= 200 ms p95 (Crossmint lookup + FS stat + sign) |
| Cache-miss latency | <= 5 s p95 (Cloudinary fetch + write + sign) |
| Crossmint lookup | <= 500 ms p95 (Registry's call) |
| URL TTL | 5 minutes (signed `exp`) |
| Audit | Pino: `renderer.serve` with `mint_address`, `viewer_user_id`, `cache_hit` boolean, `duration_ms` |
| Secret handling | `PLATFORM_SIGNING_SECRET` read once at module load; never logged |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `deeds` table (Prisma) | mint_address lookup + image_id resolution |
| `purchases` table (Prisma) | build-completion gate (`status='confirmed'`) |
| Registry: `crossmint_lookup` (TBD) | on-chain owner verification |
| Cloudinary Node SDK | source bytes via signed CDN URL on cache miss |
| `node:fs/promises` | local-FS read / write for `/var/share_copies/` |
| identity | viewer session resolution upstream |
| `process.env.PLATFORM_SIGNING_SECRET` | HMAC key for short-lived URLs |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Cache eviction policy -- "keep forever" at MVP; LRU + size cap at MMP |
| OI-02 | Cache stampede on cold start -- many simultaneous misses for one (image, owner) pair; single-flight mutex per cache key TBD (in-process Map at MVP; Redis at MMP) |
| OI-03 | Cache invalidation on takedown -- if `images.status='taken_down'`, existing cached Share Copy should be purged; sweeper keyed on takedown events TBD |
| OI-04 | `PLATFORM_SIGNING_SECRET` rotation -- env-secret rotation invalidates outstanding URLs; acceptable at MVP (5-min TTL means narrow window) |
| OI-05 | Forward-compat: deed-holder Master download (Card 7, R62 §3.1) -- separate `serveMasterDownload` flow that transitions `deed_state` `sealed → unsealed`. MVP scope is Share Copy only |
| OI-06 | Range / partial-content support -- MVP serves whole file; range requests for large downloads TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| image_gen | Source of Share Copy bytes (Cloudinary deterministic `public_id`); explicitly externalized the cache to this module |
| Registry: `crossmint_lookup` (TBD) | Per-request ownership verification |
| metadata | Stores Stripe-payment state (`purchases.status='confirmed'`) that gates serve |
| identity | Session / viewer resolution upstream |
| R71 §3.7 row 20 | `GET /v1/deeds/:mintAddress/social-copy-download` |
| R71 §2.5 | Buyer Collection deed-holder viewing flow |
| R62 §7.5 | Decryption / rendering architecture (Master download is forward-compat per OI-05) |
| Constitution INV-02 | Platform MUST NOT hold buyer private keys -- ownership check uses on-chain lookup, not key material |

---
*Last Updated: 05/29/26 16:30*
