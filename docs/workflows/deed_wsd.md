# Card 5: Deed (Workflow Sequence)

Per-asset workflow for deed issuance. Spawned as part of Commerce's `run_image_ops` after Cloudinary Share Copy build (step c) completes. Calls `arweave_master` → `cnft_dispatch` (synchronous self-mint per [ADR-0008](../adr/adr_0008_self_mint_bubblegum_v2.md)) → `post_mint.applyMintSucceeded` -- terminal `minting → confirmed | failed` is owned by `run_image_ops` inline. Authoritative MVP steps per R71 §2.4 steps 11-14.

## 1. Preconditions

| Condition | Source |
|---|---|
| `purchases.status='building'` | transitioned from `'paid'` by `run_image_ops` per ADR-0001 |
| `purchases.monogram_text` populated | metadata.captureMonogram per ADR-0002 |
| `images.status='live'` | moderator-approved at Card 1 |
| `images.dek_wrapped` populated | set at Card 1 in `POST /v1/images` (server.ts: `encryptMaster(buffer) → { ciphertext, dek_wrapped }`) per arweave_master.md §3.2 |
| `EncryptedMasterStore` has entry for `<image_id>` | written at Card 1 via `encryptedMasterStore.write` per arweave_master.md §2.7 |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | Arweave Master upload (Card 5 build) | Backend → Arweave | arweave_master.buildAndUpload(image_id, buyer_wallet_pubkey) -- reads the ZIP-AES-256 archive from `EncryptedMasterStore` (built at Card 1 per D-21; FS file is `<image_id>.zip` with `<image_id>.jpg` inside, password = base64(DEK_image)) and uploads as-is to Arweave via Turbo SDK. **No decrypt, no rezip.** | `images.arweave_uri` persisted; `images.sha256` is **read-through** from Card 1 (no recompute); `images.phash` read-through from Card 1 per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md); `enc_final` constructed for the on-chain deed | ARWEAVE_UPLOAD_FAILED |
| 2 | Share Copy build | Backend + Cloudinary | image_gen.generateShareCopy(image_id, 1, monogram_text) -- called by run_image_ops between steps 1 and 3 | Cloudinary `public_id` `<image_id>-share-1` exists | VARIANT_BUILD_FAILED |
| 3 | Transition state | Backend (run_image_ops) | Conditional UPDATE `purchases.status='minting' WHERE id=? AND status='building'` | -- | -- |
| 4 | Mint dispatch (synchronous) | Backend → Solana (self-mint per ADR-0008) | cnft_dispatch.dispatch(image_id, buyer_wallet_pubkey, arweave_uri, sha256, phash, enc_final, ...) | Bubblegum V2 `mintV2` submitted + awaited; returns `{ asset_id }`; deed `variant_hashes["M+00"]` carries both sha256 + phash anchors. Throws on failure. | MINT_FAILED |
| 5 | Mint outcome | runImageOps (inline) | post_mint.applyMintSucceeded(asset_id, ...) on success; catch + payments.refundPurchase on thrown failure | On success: `deeds` row inserted with `custody_state='sealed'`, `legal_state='legit'`; metadata.onMintSucceeded → `images.status='sold'` + `images.visibility='private'`; `purchases.status='confirmed'`. On failure: payments.refundPurchase | -- (failure surfaces as step 4's MINT_FAILED) |
| 6 | Arweave gateway readiness (background) | `arweave_ready_sweeper` (30s poll) | HEAD `arweave.net/<tx_id>` until 200 | `images.arweave_ready_at` stamped + `encryptedMasterStore.delete(image_id)` -- Arweave becomes the authoritative encrypted-Master copy; subsequent `/download-master` calls fall back to Arweave automatically (server.ts:2042). Local FS entry no longer needed. | -- (sweeper retries on next pass) |

## 3. State Transitions

`purchases.status`:
- `building → minting` (step 3, run_image_ops)
- `minting → confirmed` (step 5 success, post_mint.applyMintSucceeded inline in run_image_ops)
- `minting → failed` (step 5 failure)

`images.status`:
- `live → sold` (step 5 success, metadata.onMintSucceeded)

`images.visibility`:
- `public → private` (step 5 success, Vault default per R71 §2.6)

`deeds.deed_state`:
- (new row) → `'sealed'` (step 5 success, post_mint.applyMintSucceeded writes)

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 1 (Arweave) | runImageOps terminal: `purchases.status='failed'`; `failure_reason='ARWEAVE_UPLOAD_FAILED'`; payments.refundPurchase; no deed |
| 2 (Share Copy) | Same terminal pattern with `failure_reason='VARIANT_BUILD_FAILED:share'` |
| 4 (cnft_dispatch throws) | run_image_ops catches; `failure_reason='MINT_FAILED:<error_code>'`; payments.refundPurchase; no `deeds` row |

## 5. Subsystems Invoked

| Subsystem | Step |
|---|---|
| Registry: arweave_master | 1 |
| Commerce: image_gen | 2 (via run_image_ops) |
| Commerce: run_image_ops | 2, 3 (orchestrator) |
| Registry: cnft_dispatch | 4 |
| Registry: post_mint (applyMintSucceeded) | 5 |
| Commerce: metadata (onMintSucceeded) | 5 (inline call from runImageOps) |
| Commerce: payments (refundPurchase) | failure paths |
| Registry: arweave_ready_sweeper + EncryptedMasterStore.delete | 6 (post-readiness deletion) |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Self-mint latency under load -- typical sub-second for Bubblegum V2; SLA TBD as production traffic ramps |
| OI-02 | Recovery from partial mint (RPC submitted the tx but the response was lost) -- crash-recovery in run_image_ops re-dispatches; deterministic asset_id derivation means the retry resolves to the same address (no double-mint). Verified by advisory post-mint check in cnft_dispatch. |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| arweave_master.md | step 1 |
| deed.md | step 4 (dispatch via Bubblegum V2 mintV2) + sets `'sealed'` at step 5 (state machine §2.4) |
| run_image_ops.md (Commerce) | Workflow orchestrator owning steps 2 and 3 |
| purchase_wsd.md (Commerce) | Card 4 -- parent workflow |
| **ADR-0001** | Build trigger: webhook does not spawn; buyer POST does |
| **ADR-0002** | Monogram persisted; passed to step 2 inline |
| **ADR-0005** | phash carried through from Card 1 read-through; deed embeds both sha256 + phash at M+00 |
| R71 §2.4 steps 11-14 | authoritative reference |
| R71 §3.7 row 22 | (formerly Crossmint webhook endpoint -- superseded; mint outcome is synchronous per ADR-0008) |
| R71 §3.8 purchase + image lifecycles | state machines |
| R71 §3.9 | runImageOps + crash recovery |
| R62 §3.1 Card 5 | reference card |

---
*Last Updated: 26/06/11 11:00*
