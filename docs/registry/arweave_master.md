# Arweave Master (Registry)

On-Arweave Master upload via ArDrive Turbo. Reads the ZIP-AES-256 archive from `EncryptedMasterStore` (written at Card 1 by [server.ts](../../src/app/api/server.ts) `/v1/images` per D-21) and uploads it as-is to Arweave -- **no decrypt, no re-encrypt, no repackaging**. Arweave bytes are byte-identical to FS bytes. The doubly-nested `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)` per R62 §2.3 is constructed by [`run_image_ops`](../commerce/run_image_ops.md) and written to on-chain deed metadata by [`cnft_dispatch`](cnft_dispatch.md). Persists `arweave_uri` + `sha256` to `images`. Called by Commerce's `run_image_ops` at step (b).

After Arweave gateway readiness is confirmed (`arweave_ready_at` stamped by [arweave_ready_sweeper](../../src/app/workers/arweave_ready_sweeper.ts)), the store entry is deleted. Arweave becomes the authoritative encrypted-Master copy for sold images. `/download-master` no longer streams Master bytes -- it returns a JSON payload `{ archive_url, arweave_uri, password, filename_hint, custody_state }` for the owner to fetch the ZIP from Arweave + extract client-side.

> **Implementation status (2026-06-11): D-21 -- ZIP-at-Card-1 + Card-5 pass-through + password-reveal /download-master.** Card 1 (`/v1/images`) builds the single-layer ZIP-AES-256 archive (`<image_id>.jpg` inside, password = `base64(DEK_image)`) and writes it to `EncryptedMasterStore` at `data/encrypted_masters/<image_id>.zip`. Card 5 (this module) lifts those bytes to Arweave unchanged. `/download-master` returns the password + Arweave URL; the server never decrypts. D-19's Card-5-decrypt-and-rezip is **superseded** by D-21. After Arweave readiness is confirmed, the store entry is deleted -- Arweave becomes the authoritative copy. ZIP packaging preserves the native-tool extract UX (WinZip / macOS Archive Utility / iOS Files / Linux unzip 6.0+). ADR-0010's nested ZIP variant was [superseded 2026-06-06](../adr/adr_0010_nested_zip_master_encryption.md#status); D-19's Card-5-rezip variant is superseded 2026-06-11. Resale (post-MVP) will need server-side ZIP extraction to regenerate Share Copies per new owner -- contract point at [src/cert/zip.ts `extractFromZipAes256`](../../src/cert/zip.ts) (stubbed).

## 1. Interface

### 1.1 Inputs

#### buildAndUpload
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | |
| buyer_wallet_pubkey | string | Solana base58; inner layer of `enc_final` |
| title | string | Embedded in the Arweave-tag metadata (App-Name=Epimage flow) and the no-credit manifest fallback. |
| creator_display_name | string | Same -- metadata only. |

Note: `master_url` is no longer an input. The encrypted Master is read from `EncryptedMasterStore` per §2.7 instead of fetched from a Cloudinary URL.

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
| Pre | encrypted Master present in `EncryptedMasterStore` (Card 1); `images.sha256` + `images.phash` populated (Card 1); ArDrive Turbo FIAT-credit topped up. (`images.dek_wrapped` is set at Card 1 too but this module does not read it -- it's used by `/download-master`.) |
| Post (build) | `images.arweave_uri` populated; `images.sha256` populated; `images.phash` preserved (read-through, never overwritten); byte-immutable for deed lifetime per R62 §7.4 |
| Post (idempotent) | already-built returns existing values; no re-decrypt, no re-upload |
| Post (gateway ready) | `images.arweave_ready_at` stamped by the sweeper; `EncryptedMasterStore` entry deleted (Arweave becomes authoritative) |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image with encrypted Original; not yet built | `buildAndUpload(image_id, pubkey)` | `arweave_uri` set; `sha256` set; `phash` read-through from `images.phash`; `enc_final` returned |
| AC-02 | already built | re-call | `MASTER_ALREADY_BUILT`; no upload, no DB mutation |
| AC-03 | ArDrive 503 | call | retried internally by SDK; if all fail, `ARWEAVE_UPLOAD_FAILED` |
| AC-04 | INV-04 verification | post-build | Original at `/var/originals/<image-id>.enc` byte-equal to pre-build (read-only) |

## 2. Functional Requirements

### 2.1 Read Encrypted Master from Store (no decrypt)
1. Read the ZIP-AES-256 bytes from `EncryptedMasterStore.read(image_id)` (populated at Card 1 by [server.ts](../../src/app/api/server.ts) `/v1/images`). If absent, return `ARWEAVE_UPLOAD_FAILED` -- this indicates Card 1 didn't run or the store entry was prematurely deleted.
2. Do **not** decrypt. The Arweave-bound bytes are the same ZIP bytes on FS; the module is a pass-through to permanent storage.

Rationale: `dek_wrapped` is preserved on `images` for `/download-master` to use at password-derive time; this module never needs it. Arweave bytes match FS bytes match the ZIP archive of the upload buffer the on-chain SHA-256 anchors. End-to-end byte-identity preserved without any in-memory key-handling here.

### 2.2 Hash + phash read-through
1. Read `images.sha256` (populated at Card 1 over the upload buffer -- the cleartext Master). This becomes `deed.variant_hashes["M+00"].sha256`. Recompute on the legacy path runs on the FS ZIP bytes (not cleartext, since this module no longer extracts) -- different from the upload-buffer hash; new rows always have `images.sha256` populated to avoid that drift.
2. Read `images.phash` (populated at Card 1 by [cert/image_uniqueness](../cert/image_uniqueness.md) per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md)). This becomes `deed.variant_hashes["M+00"].phash`. **No recomputation**: upload-time phash is the deed anchor.

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
The encrypted Master in the store is **never modified** by this module. It's read, decrypted in-memory, ZIP-packaged for Arweave, and deleted post-readiness. The decrypted bytes are byte-identical to the upload buffer, preserving pixel integrity end-to-end.

### 2.7 EncryptedMasterStore (Card 1 write → Card 5 read → post-ready delete)

The store is an interface at [src/registry/arweave_master.ts](../../src/registry/arweave_master.ts):

```ts
export interface EncryptedMasterStore {
    read(image_id: string): Promise<Buffer | null>;
    write(image_id: string, ciphertext: Buffer): Promise<void>;
    delete(image_id: string): Promise<void>;
    exists(image_id: string): Promise<boolean>;
}
```

| Phase | Caller | Operation |
|---|---|---|
| Card 1 (creator upload) | server.ts `/v1/images` | `write(image_id, ciphertext)` after Cloudinary upload succeeds + before DB row creation. Atomic write (write-temp + rename) protects against partial-write corruption from crashes. |
| Pre-sale (operational) | server.ts `/v1/deeds/:imageId/download-master` | `read(image_id)` -- still the primary source while pre-sale (sweeper hasn't deleted yet) |
| Card 5 (post-sale build) | this module's `buildAndUpload` | `read(image_id)` to decrypt + ZIP-package for Arweave |
| Post-Arweave-ready | [arweave_ready_sweeper](../../src/app/workers/arweave_ready_sweeper.ts) | `delete(image_id)` once `arweave_ready_at` is stamped -- Arweave is authoritative |
| Takedown | [src/cert/takedown.ts](../../src/cert/takedown.ts) `recordTakedown` | `delete(image_id)` as a side effect (no need to retain bytes for content the platform will not serve) |

**MVP implementation**: `fsEncryptedMasterStore` -- writes/reads/deletes files at `data/encrypted_masters/<image_id>.bin`. Path overridable via `ENCRYPTED_MASTER_DIR` env var. No backup at MVP per explicit scope decision; if the FS loses an entry pre-sale, the creator re-uploads.

**Post-MVP**: swap the `encryptedMasterStore` export to an `s3EncryptedMasterStore` (new file implementing the same interface against S3/B2/R2). Call sites don't change. Durability rises to 11 9s; FS loses its "single point of failure" status; multi-instance scale-out becomes possible.

## 3. Architecture

### 3.1 Single-DEK per R65 §3.14
Same `DEK_image` for Original (operational) and Master (archival). Trade-off: simpler than per-variant DEKs while preserving per-owner exclusivity via the wallet-inner layer of `enc_final`.

### 3.2 Encryption Happens at Card 1, Not Card 5
Historically, encryption + `dek_wrapped` population happened at Card 5 in this module. As of 2026-06-10, Card 1 (`/v1/images`) owns encryption: it writes the ciphertext to the store and populates `images.dek_wrapped`. This module reads from the store rather than fetching cleartext from Cloudinary -- fixing the SHA-256 drift caused by Cloudinary metadata normalization.

### 3.3 No Plaintext In-Flight
This module never holds cleartext Master bytes -- it reads ciphertext from the store and uploads ciphertext to Arweave. The only module that ever decrypts the Master is `/download-master` (server.ts) when serving an authenticated owner. Reducing key-handling surface area was a deliberate goal of the 2026-06-10 simplification.

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
| `EncryptedMasterStore` (this module) | Read source (set at Card 1); pass-through to Arweave |
| `images` table (Prisma) | `sha256` + `phash` read (set at Card 1); `arweave_uri` write. `dek_wrapped` is not read here -- it's owned by Card 1 (write) and `/download-master` (read). |
| `cert/image_uniqueness` (predecessor at Card 1) | populates `images.phash` per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md) |
| `app/workers/arweave_ready_sweeper` | Deletes store entry post-readiness |
| `process.env.PLATFORM_DEK` | envelope key |
| `process.env.ARDRIVE_TURBO_TOKEN` | upload credential |
| `process.env.ENCRYPTED_MASTER_DIR` (optional) | overrides `data/encrypted_masters` |

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
*Last Updated: 26/06/11 10:30*
