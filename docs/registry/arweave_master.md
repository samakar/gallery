# Arweave Master (Registry)

On-Arweave Master encryption + ArDrive Turbo upload. Fetches the Master (original full-resolution upload bytes) from Cloudinary's no-transformation delivery URL, encrypts with the per-image `DEK_image` (single-DEK per R65 §3.14), reads the persisted `images.sha256` (populated at certify time over the upload buffer) and `images.phash` (Card 1 uniqueness gate per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md)) -- both used for deed metadata anchoring -- and uploads the single-layer AES-256-GCM ciphertext to Arweave via ArDrive Turbo. The doubly-nested `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` per R62 §2.3 is constructed by [`run_image_ops`](../commerce/run_image_ops.md) and written to on-chain deed metadata by [`cnft_dispatch`](cnft_dispatch.md). Persists `arweave_uri` + `sha256` to `images`. Called by Commerce's `run_image_ops` at step (b).

> **Implementation status (2026-06-07): R62 §1.5 architecture preserved + D-19 packaging.** The Arweave-bound payload is a single-layer ZIP-AES-256 archive (`<image_id>.zip` containing `<image_id>.jpg`, password = base64(DEK_image)) per [D-19](../divergences.md#d-19-arweave-master-packaging-zip-aes-256--platform-proxy-for-friendly-filename). One DEK_image per image is still the only key; the on-chain `enc_final` still does the doubly-nested wrap per R62 §1.5/§2.3. Mode shifts from GCM to ZIP-native AES-256-CBC for native-tool UX. The buyer-facing deed UI displays the raw `arweave.net/<tx_id>` URL but hyperlinks to the platform proxy `GET /a/:imageId` which streams the bytes with `Content-Disposition: attachment; filename="<image_id>.zip"`. Local-disk persisted ciphertext stays raw AES-256-GCM (R62 §2.3 exact) for `/download-master`. ADR-0010's nested ZIP variant was [superseded](../adr/adr_0010_nested_zip_master_encryption.md#status) the same day; D-19's single-layer ZIP preserves the UX win without ADR-0010's resale-rekey problem.

## 1. Interface

### 1.1 Inputs

#### buildAndUpload
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | |
| buyer_wallet_pubkey | string | Solana base58; inner layer of `enc_final` |

### 1.2 Outputs

#### buildAndUpload
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| arweave_uri | string | `https://arweave.net/<tx_id>` |
| sha256 | string | hex of canonical Master pixels (deed `variant_hashes["M+00"].sha256`) |
| phash | string | 16-char hex 64-bit DCT pHash; **read from `images.phash`** (computed at Card 1 per ADR-0005); deed `variant_hashes["M+00"].phash` |
| enc_final | string | base64 of `encrypt(encrypt(DEK_image, buyer_wallet_pubkey), platform_DEK)` |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| ARWEAVE_UPLOAD_FAILED | ArDrive Turbo upload failed after retries |
| MASTER_ALREADY_BUILT | `images.arweave_uri` populated -- idempotent return per R71 §3.9 |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `images.dek_wrapped` populated; `images.phash` populated (Card 1 uniqueness gate); PLATFORM_DEK set; ArDrive Turbo FIAT-credit topped up |
| Post (build) | `images.arweave_uri` populated; `images.sha256` populated; `images.phash` preserved (read-through, never overwritten); byte-immutable for deed lifetime per R62 §7.4 |
| Post (idempotent) | already-built returns existing values; no re-encrypt, no re-upload |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image with encrypted Original; not yet built | `buildAndUpload(image_id, pubkey)` | `arweave_uri` set; `sha256` set; `phash` read-through from `images.phash`; `enc_final` returned |
| AC-02 | already built | re-call | `MASTER_ALREADY_BUILT`; no upload, no DB mutation |
| AC-03 | ArDrive 503 | call | retried internally by SDK; if all fail, `ARWEAVE_UPLOAD_FAILED` |
| AC-04 | INV-04 verification | post-build | Original at `/var/originals/<image-id>.enc` byte-equal to pre-build (read-only) |

## 2. Functional Requirements

### 2.1 Fetch Master + Hash + phash read-through
1. Fetch the Master bytes from Cloudinary's no-transformation delivery URL (`buildOriginalUrl(image_id)` -- returns the original full-resolution unwatermarked upload, NOT the listing-preview variant). These are the bytes that get encrypted to the local disk + nested-ZIP'd to Arweave + delivered to the buyer via /v1/deeds/:imageId/download-master.
2. Read `images.sha256` (populated at certify time over the upload buffer in [server.ts](../../src/app/api/server.ts) `/v1/creator/certify-image`). This becomes `deed.variant_hashes["M+00"].sha256`. Recompute over the Cloudinary-served Master bytes only on the legacy path (rows with sha256=null). Buyer-visible "SHA-256 (M+00)" pre-sale matches what the deed anchors post-sale. Note: the certify-time hash is over the EXACT upload buffer; the mint-time recompute hashes Cloudinary-served bytes, which can differ if Cloudinary strips EXIF/metadata -- in practice `images.sha256` (upload-buffer) takes precedence via read-through.
3. Read `images.phash` (already populated at Card 1 by [cert/image_uniqueness](../cert/image_uniqueness.md) per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md)). This becomes `deed.variant_hashes["M+00"].phash`. **No recomputation**: the upload-time phash is the deed anchor (single source of truth -- pixel-equivalent under INV-04 means the canonical-Master phash equals the upload-buffer phash; explicit read-through guarantees this without re-running sharp-phash).

### 2.2 Re-encrypt with Same DEK
1. Read `images.dek_wrapped` → unwrap with `process.env.PLATFORM_DEK` → `DEK_image`.
2. AES-256-GCM(`DEK_image`, plaintext) → ciphertext + auth tag (single-DEK architecture per R65 §3.14 -- same DEK as the operational Original).

### 2.3 Construct enc_final (R62 §2.3)
| Layer | Operation |
|---|---|
| inner | `encrypt(DEK_image, buyer_wallet_pubkey)` -- asymmetric, Solana wallet pubkey scheme |
| outer | `encrypt(inner, PLATFORM_DEK)` -- symmetric platform layer |
| Result | `enc_final = outer`; base64-encoded for Crossmint mint payload |

**Encryption order matters**: wallet-inner ensures per-owner post-cessation exclusivity even after the trustee publishes `PLATFORM_DEK`. Reverse order would leave a platform-only layer that anyone could decrypt at cessation, defeating per-deed ownership.

### 2.4 Upload via ArDrive Turbo
1. `@ardrive/turbo-sdk` `turbo.uploadFile(...)` with the encrypted Master bytes.
2. Returns Arweave transaction id; `arweave_uri = https://arweave.net/<tx_id>`.
3. Persist via `prisma.image.update({ data: { arweave_uri, sha256 } })`.

### 2.5 Idempotency
If `images.arweave_uri` populated → return `MASTER_ALREADY_BUILT` (no upload). Per R71 §3.9, run_image_ops crash recovery re-spawns; this guard makes recovery safe.

### 2.6 INV-04 Compliance
Original at `/var/originals/<image-id>.enc` is **never modified** by this module. The on-Arweave Master is a separate ciphertext derived from the same plaintext.

## 3. Architecture

### 3.1 Single-DEK per R65 §3.14
Same `DEK_image` for Original (operational) and Master (archival). Trade-off: simpler than per-variant DEKs while preserving per-owner exclusivity via the wallet-inner layer of `enc_final`.

### 3.2 Reads via Commerce
The only Registry → Commerce read: `image_gen.decryptOriginal`. Documented in image_gen as "the only Commerce → Registry export".

### 3.3 Plaintext In-Flight Only
Decrypted plaintext is consumed by re-encryption + sha256; never persisted to disk; discarded after upload.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 30 s p95 (decrypt + encrypt + upload) |
| INV-04 | Original byte-immutable |
| Audit | Pino `arweave.upload` with image_id, duration, retry_count |
| Idempotency | exists-check before any work |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `@ardrive/turbo-sdk` (R71 §3.2) | Arweave upload (FIAT-funded) |
| `image_gen.decryptOriginal` (Commerce) | Source plaintext (cross-function read) |
| `node:crypto` | AES-256-GCM + asymmetric encrypt for inner layer |
| `images` table (Prisma) | `dek_wrapped` + `phash` read; `arweave_uri` / `sha256` write |
| `cert/image_uniqueness` (predecessor at Card 1) | populates `images.phash` per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md) |
| `process.env.PLATFORM_DEK` | envelope key |
| `process.env.ARDRIVE_TURBO_TOKEN` | upload credential |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | **Resolved 2026-06-07.** Asymmetric encryption scheme for the wallet-pubkey inner layer of `enc_final`: NaCl sealed-box via Ed25519 → Curve25519 conversion (`ed2curve`), implemented in [src/cert/crypto.ts:128-156](../../src/cert/crypto.ts#L128-L156) (`sealToSolanaWallet` / `openFromSolanaWallet`). The choice satisfies R62 §2.3 (asymmetric to wallet pubkey) with the simplest standard primitive that maps Solana Ed25519 → encryption-capable Curve25519 key. |
| OI-02 | ArDrive Turbo FIAT credit top-up monitoring -- alert at threshold; TBD |
| OI-03 | Recovery path if `process.env.PLATFORM_DEK` rotates between upload and verification -- versioning the wrap TBD |
| OI-04 | Arweave permanence verification window -- bundler confirmation latency at peak load (typically seconds; spec'd as TBD per ArDrive SLA) |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| image_gen.md | `decryptOriginal` source + Original custody |
| [deed.md](deed.md) | Consumes `arweave_uri` + `enc_final` + `sha256` + `phash` in mint payload |
| cert/image_uniqueness.md | Card 1 producer of `images.phash` (read-through by this module) |
| **ADR-0005** | phash in deed + uniqueness gate restored to MVP |
| run_image_ops.md | Caller (step b of the pipeline) |
| R71 §2.4 step 11-12 | Authoritative steps |
| R71 §3.3 ArDrive Turbo | Vendor contract |
| R65 §3.14 | Single-DEK architecture rationale |
| R62 §2.3 | `enc_final` doubly-nested encryption + order rationale (this module's operative spec) |
| R62 §1.5 | Master Storage row -- Arweave-bound single-layer `DEK_image` encryption + on-chain `enc_final` rotation on resale |
| [ADR-0010](../adr/adr_0010_nested_zip_master_encryption.md) | Superseded 2026-06-07; brief history of the nested-ZIP variant |
| [D-15](../divergences.md#d-15-master-encryption-on-arweave-adr-0010-nested-zip----reverted) | Divergence registry post-mortem for the ADR-0010 revert |
| R62 §7.4 | on-chain anchored variants |
| Constitution INV-04 | No pixel modification of the Original |
| Constitution INV-08 | C2PA append-only (N/A at MVP) |

---
*Last Updated: 26/06/07 02:30*
