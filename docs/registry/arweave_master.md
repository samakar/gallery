# Arweave Master (Registry)

On-Arweave Master encryption + ArDrive Turbo upload. Decrypts the Original via `image_gen.decryptOriginal` (cross-function read into Commerce), re-encrypts with the SAME `DEK_image` (single-DEK per R65 §3.14), computes canonical-pixels sha256 for deed metadata anchoring, **reads the persisted `images.phash` from the Card 1 uniqueness gate (per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md))**, constructs the doubly-nested `enc_final` for deed-bound unlock per R62 §2.3, and uploads to Arweave via ArDrive Turbo. Persists `arweave_uri` + `sha256` to `images`. Called by Commerce's `run_image_ops` at step (b).

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

### 2.1 Decrypt + Hash + phash read-through
1. Call `image_gen.decryptOriginal(image_id)` → plaintext bytes (in-flight only).
2. Compute `sha256(canonical_pixels)` (decoded RGB; not the compressed JPEG bytes per image_gen OI-04). This becomes `deed.variant_hashes["M+00"].sha256`.
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
| OI-01 | Asymmetric encryption scheme for the wallet-pubkey inner layer -- ECIES vs hybrid; algorithm TBD |
| OI-02 | ArDrive Turbo FIAT credit top-up monitoring -- alert at threshold; TBD |
| OI-03 | Recovery path if `process.env.PLATFORM_DEK` rotates between upload and verification -- versioning the wrap TBD |
| OI-04 | Arweave permanence verification window -- bundler confirmation latency at peak load (typically seconds; spec'd as TBD per ArDrive SLA) |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| image_gen.md | `decryptOriginal` source + Original custody |
| crossmint_dispatch.md | Consumes `arweave_uri` + `enc_final` + `sha256` + `phash` in mint payload |
| cert/image_uniqueness.md | Card 1 producer of `images.phash` (read-through by this module) |
| **ADR-0005** | phash in deed + uniqueness gate restored to MVP |
| run_image_ops.md | Caller (step b of the pipeline) |
| R71 §2.4 step 11-12 | Authoritative steps |
| R71 §3.3 ArDrive Turbo | Vendor contract |
| R65 §3.14 | Single-DEK architecture rationale |
| R62 §2.3 | `enc_final` doubly-nested encryption + order rationale |
| R62 §7.4 | on-chain anchored variants |
| Constitution INV-04 | No pixel modification of the Original |
| Constitution INV-08 | C2PA append-only (N/A at MVP) |

---
*Last Updated: 05/29/26 17:30*
