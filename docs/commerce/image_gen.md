# Image Gen (Commerce)

**The canonical interface to all Cloudinary image-generation operations on the Commerce side**, plus Original custody on local FS. Covers (i) Original encryption at rest, (ii) Cloudinary generation of the three public-circulation variants -- Listing preview, Thumbnail, Share Copy. **No other module composes Cloudinary chains or calls the Cloudinary SDK.** None of the public-circulation variants are on-chain-anchored per R62 §7.4 -- verification routes through in-pixel URL text (Share Copy) and the off-chain match engine. The on-Arweave Master is a separate Registry module that reads the Original through this module's `decryptOriginal`. Signed-download caching for deed-holder access is the renderer's concern, not this module.

## 1. Interface

### 1.1 Inputs

#### encryptAndStoreOriginal
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | assigned at Card 2; binds the encrypted Original to this id |
| bytes | Uint8Array | clean source from creator upload (post-ingestion gate) |

#### decryptOriginal
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | called by other entry points (internal); also exposed for Registry's `arweave_master` (external read) |

#### generateListingPreview
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | Card 2 (R71 §2.2 step 8) |

#### generateThumbnail
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | Card 2 (R71 §2.2 step 8) |

#### generateShareCopy
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | Card 4 step 13 (R71 §2.4) |
| owner_ordinal | int | 1 at first sale; increments at resale (post-MVP) |
| monogram_text | string | passed inline by runImageOps; sourced from `purchases.monogram_text` (per ADR-0002, metadata-persisted) |

### 1.2 Outputs

#### encryptAndStoreOriginal
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| local_path | string | `/var/originals/<image-id>.enc` |
| width_px | int | captured at ingestion |
| height_px | int | captured at ingestion |

#### decryptOriginal
| Field | Type | Notes |
|---|---|---|
| bytes | Uint8Array | decrypted plaintext (in-flight only; never written to disk) |

#### generateListingPreview / Thumbnail
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| public_id | string | `<image_id>-listing` \| `<image_id>-thumb` (R62 §7.3) |
| cdn_url | string | Cloudinary delivery URL |

#### generateShareCopy
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| public_id | string | `<image_id>-share-<owner_ordinal>` |
| cdn_url | string | Cloudinary delivery URL |
| format | enum | `1080x566` (landscape) \| `1080x1080` (square) \| `1080x1350` (portrait) |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| VARIANT_BUILD_FAILED | Cloudinary retries exhausted (3 attempts; exponential backoff 1s / 4s / 16s per R71 §3.5) |
| ORIGINAL_NOT_FOUND | local-FS Original file missing OR `images.dek_wrapped` is null |
| ORIGINAL_DECRYPT_FAILED | DEK_image unwrap failed OR AES-GCM auth tag mismatch (tamper / wrong key) |
| KEK_MISSING | `process.env.PLATFORM_DEK` not set at encrypt / decrypt time |
| ORIGINAL_ALREADY_STORED | `images.dek_wrapped` already populated -- `encryptAndStoreOriginal` is idempotent |

R71 §3.7 surfaces `VARIANT_BUILD_FAILED:<step>` to the caller; on terminal failure during the async build, `runStripeRefund` fires per R71 §3.9.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre (encryptAndStoreOriginal) | image_spec server gate passed (R71 §1.3); `images` row in `draft` status; `images.dek_wrapped` null; `PLATFORM_DEK` set |
| Pre (decryptOriginal) | `images.dek_wrapped` populated; `PLATFORM_DEK` set |
| Pre (Listing preview, Thumbnail) | `images.status = 'draft'`; `images.dek_wrapped` populated |
| Pre (Share Copy) | payment authorized; `monogram_text` supplied by caller (sourced from `purchases.monogram_text` per ADR-0002); Original retrievable |
| Post (encryptAndStoreOriginal) | Encrypted Original at `/var/originals/<image-id>.enc`; `images.dek_wrapped` / `width_px` / `height_px` populated |
| Post (decryptOriginal) | Plaintext returned in-flight only -- no persisted plaintext |
| Post (Cloudinary variants) | Cloudinary `public_id` exists, deterministic from `image_id` (+ owner_ordinal for Share Copy) |
| Post (all) | INV-04: Original byte-immutable post-ingest |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image in `draft`; image_spec passed; `PLATFORM_DEK` set | `encryptAndStoreOriginal(image_id, bytes)` | encrypted file at `/var/originals/<image-id>.enc`; `dek_wrapped` populated; width/height stamped |
| AC-02 | re-call on already-stored image | `encryptAndStoreOriginal(...)` | `ORIGINAL_ALREADY_STORED`; no re-encryption, no DB mutation |
| AC-03 | `PLATFORM_DEK` unset | encrypt or decrypt call | `KEK_MISSING` |
| AC-04 | tampered `.enc` file | `decryptOriginal(image_id)` | `ORIGINAL_DECRYPT_FAILED` (GCM auth-tag mismatch) |
| AC-05 | Original encrypted | `generateListingPreview(image_id)` | public_id `<image_id>-listing` exists with PREVIEW watermark + creator credit |
| AC-06 | same | `generateThumbnail(image_id)` | public_id `<image_id>-thumb` exists; 500 px long-edge; no watermark |
| AC-07 | payment authorized; portrait Original; monogram | `generateShareCopy(...)` | public_id `<image_id>-share-1` at `1080x1350` with URL-text overlay (R62 §7.6) |
| AC-08 | Cloudinary 503 | any `generate*` call | retried 3x with 1 / 4 / 16 s backoff; if all fail, `VARIANT_BUILD_FAILED:<variant_code>` |

## 2. Functional Requirements

### 2.1 Original Custody (Card 2 ingest)
At Card 2, post-ESIGN ISA (R71 §2.2 step 7):

| Step | Detail |
|---|---|
| Generate DEK | Per-image random AES-256 key (`DEK_image`) via `node:crypto.randomBytes(32)` |
| Wrap DEK | `encrypt(DEK_image, process.env.PLATFORM_DEK)` → `dek_wrapped` BLOB (R65 §3.14 single-DEK rationale) |
| Encrypt Original | AES-256-GCM(`DEK_image`, plaintext) → ciphertext + 16-byte auth tag, prefixed with the 12-byte IV |
| Persist | Ciphertext written atomically to `/var/originals/<image-id>.enc` (tempfile + rename) |
| Persist DEK + dims | `prisma.image.update({ data: { dek_wrapped, width_px, height_px } })` |
| Idempotency | Existing `dek_wrapped` → `ORIGINAL_ALREADY_STORED` (no re-encryption, no overwrite) |

INV-04: the Original is byte-immutable post-ingest. The on-Arweave Master (Registry) is a re-encryption of the SAME plaintext with the SAME `DEK_image` per R65 §3.14 single-DEK architecture.

### 2.2 Decrypt-on-Demand
Called internally by every `generate*` function and externally by Registry's `arweave_master`:

| Step | Detail |
|---|---|
| Unwrap DEK | `decrypt(dek_wrapped, process.env.PLATFORM_DEK)` → `DEK_image` |
| Read ciphertext | Read `/var/originals/<image-id>.enc` into memory |
| Decrypt + verify | AES-256-GCM verify auth tag + decrypt → plaintext bytes. Tag mismatch → `ORIGINAL_DECRYPT_FAILED` (tamper detection) |
| Lifetime | Plaintext is in-flight only -- consumed by Cloudinary upload OR returned to caller; NEVER persisted to disk |

### 2.3 Listing preview (R71 §2.2 step 8; R62 §2.2)
Cloudinary chain: `c_limit,w_1080,h_1080` → creator-credit text layer → centered italic "Epimage" outline watermark (EB Garamond Italic, ~5% opacity per R62 §2.2 lines 74-82) → `q_auto:good,f_jpg`.

### 2.4 Thumbnail (R71 §2.2 step 8)
Cloudinary chain: `c_limit,w_500` → `q_70,f_jpg`. Aspect-preserving; unwatermarked; 500 px long-edge.

### 2.5 Share Copy (R71 §3.5; R62 §2.2 + §7.6)

| Step | Detail |
|---|---|
| Format | Orientation-driven: landscape → 1080×566, square → 1080×1080, portrait → 1080×1350 |
| Chain | `c_fill,g_auto,w_1080,h_<format>` (AI-driven gravity) → monogram layer (gallery-wall-label register per R62 §2.2; warm off-white 75-85% opacity + soft drop shadow) → URL-text layer per R62 §7.6 (IBM Plex Mono Medium / Semi-Bold, rotated 90°, lower-right vertical edge, slashed zero, fixed light fill + ~2 px dark stroke, cap-height ~3-4% of width) → `q_85,f_jpg` |
| Recompression | Q85 chosen because social platforms recompress on upload; higher is wasted bandwidth |
| Delivery | Cloudinary CDN is canonical for both public-page render and any signed-download retrieval. **This module does not cache locally** -- if deed-holder downloads require caching, the renderer (TBD) handles that lazily |

### 2.6 Variant Naming (R62 §7.3)
`public_id` = `<image_id>-<variant_code>` where `variant_code` ∈ {`listing`, `thumb`, `share-<owner_ordinal>`}. Deterministic from inputs; no DB column required.

### 2.7 Retry Policy (R71 §3.5, §3.9)
Each Cloudinary call retries 3 times with exponential backoff (1s, 4s, 16s). All retries exhausted → `VARIANT_BUILD_FAILED:<variant_code>`. Calling pipeline (`runImageOps`) triggers `runStripeRefund`.

### 2.8 Single Transformation per Variant
Each variant is one Cloudinary request: resize / crop first, overlays composited second, quality / format encoded last (R71 §3.5). No intermediate chained encoding -- variant encoded exactly once.

## 3. Architecture

### 3.1 Two Phases
- **Ingest** (Card 2): `encryptAndStoreOriginal` -- DEK generation + wrap + encrypt + atomic write + Prisma update.
- **Build** (Card 2 + Card 4): `generate*` functions call `decryptOriginal` internally, push plaintext to Cloudinary, discard plaintext after the response.

### 3.2 Single-DEK Architecture
The operational Original here and the on-Arweave Master (Registry) share `DEK_image`. Rationale R65 §3.14: simpler than per-variant DEKs while preserving per-owner post-cessation exclusivity via the wallet-inner layer of `enc_final` (constructed by Registry's `arweave_master`).

### 3.3 Cloudinary as Sole Vendor Boundary
This module is the only place that talks to Cloudinary. Callers consume the returned `public_id` / `cdn_url`; no other module imports the Cloudinary SDK or composes Cloudinary chains directly.

### 3.4 Cross-Function Read by Registry
`decryptOriginal` is exposed for Registry's `arweave_master` to read the plaintext for the on-Arweave Master encryption. This is the only Commerce → Registry export.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency (encryptAndStoreOriginal) | <= 2 s p95 for a 38 MP source |
| Latency (decryptOriginal) | <= 500 ms p95 (local-FS + node:crypto only) |
| Latency (Listing preview, Thumbnail) | <= 3 s p95 |
| Latency (Share Copy) | <= 5 s p95 |
| INV-04 | Original byte-immutable post-ingest |
| INV-09 | server-side, no external network on encrypt / decrypt itself (Cloudinary call is downstream of decrypt) |
| Determinism | Cloudinary transformations deterministic for given (Original, parameters); Share Copy AI-gravity is a Cloudinary model-version dependency (OI-03) |
| Audit | Pino log lines per call: `image.encrypt`, `image.decrypt`, `variant.build` with `image_id`, op, `duration_ms`, `retry_count` |
| Key handling | `process.env.PLATFORM_DEK` read once at module load; never logged; rotation policy OI-04 |

## 5. Dependencies

| Dependency | Role |
|---|---|
| Cloudinary Node SDK | Variant transformations + signed URL minting (R71 §3.3) |
| `node:crypto` | AES-256-GCM encrypt / decrypt; random `DEK_image` |
| `node:fs/promises` | local-FS read / write for `/var/originals/` |
| `images.dek_wrapped` (Prisma) | per-image wrapped DEK_image |
| `images.width_px` / `images.height_px` (Prisma) | dimensions stamped at ingest |
| Build-trigger caller (runImageOps) | reads `monogram_text` from `purchases.monogram_text` (metadata, per ADR-0002) and supplies it inline to `generateShareCopy` |
| `process.env.PLATFORM_DEK` | env-secret envelope key |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Listing-preview watermark sizing -- R62 §2.2 says 12-18% of image width "tune by eye at build". Pin a specific value at first launch |
| OI-02 | Orphan Cloudinary assets -- if a Tier 0 / Tier 1 reject lands after Card 2 builds, Listing preview + Thumbnail are stranded. Cleanup policy TBD (cron sweep keyed on `images.status = 'taken_down'`) |
| OI-03 | Cloudinary AI-driven `g_auto` for Share Copy -- deterministic at MVP per docs, but Cloudinary model updates could shift gravity. Replay-test policy needed |
| OI-04 | `PLATFORM_DEK` rotation -- env-secret at MVP. Rotation procedure (re-wrap every existing `dek_wrapped`) is unspecified |
| OI-05 | Atomic write to `/var/originals/` -- tempfile + rename pattern; confirm POSIX atomicity guarantee on the deployment FS |
| OI-06 | Local-FS backup / replication -- MVP runs single-instance Render with ephemeral local-FS. Loss of `/var/originals/` loses every deed's operational Original (recovery path = Arweave via post-cessation trustee key release). Backup policy TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| **ADR-0001** | Buyer-triggered build / monogram inline (no `purchases.monogram_text` persistence) |
| arweave_master (Registry, TBD) | Reads the Original via `decryptOriginal`; re-encrypts with the same `DEK_image`; uploads to Arweave |
| renderer (TBD) | Serves deed-holder Share Copy via signed URL; handles its own caching (this module does not) |
| esign | ISA precedes Card 2 (INV-2) -- `encryptAndStoreOriginal` runs only after sign-affirmation |
| moderation | Approve transitions `images.status` → `draft`, gating both ingest and Card 2 variant builds |
| R71 §2.2 step 7 | Card 2 -- image-id assignment + Original encryption (this module) |
| R71 §2.2 step 8 | Card 2 -- Listing preview + Thumbnail |
| R71 §2.4 step 13 | Card 4 -- Share Copy |
| R71 §3.3 | Cloudinary vendor contract |
| R71 §3.5 | Share Copy build pipeline detail |
| R71 §3.7 | `VARIANT_BUILD_FAILED` error code surface |
| R71 §3.9 | `runImageOps` async pipeline; retry policy; `runStripeRefund` |
| R62 §2.2 | Listing-preview watermark composition + monogram typography |
| R62 §7.3 | Variant naming convention |
| R62 §7.4 | Storage model -- public-circulation variants NOT on-chain-anchored |
| R62 §7.6 | URL-Text Rendering Contract for Share Copy |
| R65 §3.14 | Single-DEK architecture rationale |
| Constitution INV-04 | No pixel modification of the Original post-ingest |
| Constitution INV-09 | Server-side gates may call external APIs; encrypt / decrypt itself is local |
| docs/ui_design.md | Render-side surfaces consuming these variants |

---
*Last Updated: 05/29/26 15:00*
