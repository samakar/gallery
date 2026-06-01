# Card 5: Deed (Workflow Sequence)

Per-asset workflow for deed issuance. Spawned as part of Commerce's `run_image_ops` after Cloudinary Share Copy build (step c) completes. Calls `arweave_master` → `crossmint_dispatch` → exits; the terminal `minting → confirmed | failed` is owned by `crossmint_webhook`. Authoritative MVP steps per R71 §2.4 steps 11-14.

## 1. Preconditions

| Condition | Source |
|---|---|
| `purchases.status='building'` | transitioned from `'paid'` by `run_image_ops` per ADR-0001 |
| `purchases.monogram_text` populated | metadata.captureMonogram per ADR-0002 |
| `images.status='live'` | moderator-approved at Card 1 |
| `images.dek_wrapped` populated | image_gen.encryptAndStoreOriginal at Card 2 |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | Arweave Master build | Backend → Arweave | arweave_master.buildAndUpload(image_id, buyer_wallet_pubkey) | `images.arweave_uri` + `images.sha256` persisted; `images.phash` read-through (already set at Card 1 per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md)); `enc_final` returned | ARWEAVE_UPLOAD_FAILED |
| 2 | Share Copy build | Backend + Cloudinary | image_gen.generateShareCopy(image_id, 1, monogram_text) -- called by run_image_ops between steps 1 and 3 | Cloudinary `public_id` `<image_id>-share-1` exists | VARIANT_BUILD_FAILED |
| 3 | Transition state | Backend (run_image_ops) | Conditional UPDATE `purchases.status='minting' WHERE id=? AND status='building'` | -- | -- |
| 4 | Mint dispatch | Backend → Crossmint | crossmint_dispatch.dispatch(image_id, buyer_wallet_pubkey, arweave_uri, sha256, phash, enc_final, license_signing_event_id) | Crossmint mint job queued; `crossmint_job_id` returned; deed `variant_hashes["M+00"]` carries both sha256 + phash anchors | CROSSMINT_DISPATCH_FAILED |
| 5 | Mint outcome | Crossmint → Backend | crossmint_webhook.handleWebhook(mint.succeeded \| mint.failed) | On success: `deeds` row inserted with `deed_state='sealed'`; metadata.onMintSucceeded → `images.status='sold'` + `images.visibility='private'`; `purchases.status='confirmed'`. On failure: payments.refundPurchase | MINT_FAILED |

## 3. State Transitions

`purchases.status`:
- `building → minting` (step 3, run_image_ops)
- `minting → confirmed` (step 5 success, crossmint_webhook)
- `minting → failed` (step 5 failure)

`images.status`:
- `live → sold` (step 5 success, metadata.onMintSucceeded)

`images.visibility`:
- `public → private` (step 5 success, Vault default per R71 §2.6)

`deeds.deed_state`:
- (new row) → `'sealed'` (step 5 success, crossmint_webhook writes)

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 1 (Arweave) | runImageOps terminal: `purchases.status='failed'`; `failure_reason='ARWEAVE_UPLOAD_FAILED'`; payments.refundPurchase; no deed |
| 2 (Share Copy) | Same terminal pattern with `failure_reason='VARIANT_BUILD_FAILED:share'` |
| 4 (Crossmint dispatch) | Same with `failure_reason='CROSSMINT_DISPATCH_FAILED'`; no mint queued |
| 5 (`mint.failed`) | crossmint_webhook handles; `failure_reason='MINT_FAILED:<error_code>'`; payments.refundPurchase; no `deeds` row |

## 5. Subsystems Invoked

| Subsystem | Step |
|---|---|
| Registry: arweave_master | 1 |
| Commerce: image_gen | 2 (via run_image_ops) |
| Commerce: run_image_ops | 2, 3 (orchestrator) |
| Registry: crossmint_dispatch | 4 |
| Registry: crossmint_webhook | 5 |
| Commerce: metadata (onMintSucceeded) | 5 (callback from webhook) |
| Commerce: payments (refundPurchase) | failure paths |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Crossmint mint latency at MMP scale -- typical seconds-to-minute; SLA TBD |
| OI-02 | Recovery from partial mint (Crossmint job queued but webhook never fires) -- crash-recovery in run_image_ops re-dispatches; verify Crossmint dispatch idempotency on `purchase_id` |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| arweave_master.md | step 1 |
| crossmint_dispatch.md | step 4 |
| crossmint_webhook.md | step 5 |
| deed_state.md | sets `'sealed'` at step 5 |
| run_image_ops.md (Commerce) | Workflow orchestrator owning steps 2 and 3 |
| purchase_wsd.md (Commerce) | Card 4 -- parent workflow |
| **ADR-0001** | Build trigger: webhook does not spawn; buyer POST does |
| **ADR-0002** | Monogram persisted; passed to step 2 inline |
| **ADR-0005** | phash carried through from Card 1 read-through; deed embeds both sha256 + phash at M+00 |
| R71 §2.4 steps 11-14 | authoritative reference |
| R71 §3.7 row 22 | crossmint webhook endpoint |
| R71 §3.8 purchase + image lifecycles | state machines |
| R71 §3.9 | runImageOps + crash recovery |
| R62 §3.1 Card 5 | reference card |

---
*Last Updated: 05/29/26 17:30*
