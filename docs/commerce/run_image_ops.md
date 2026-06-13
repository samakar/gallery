# Run Image Ops (Commerce)

Async build orchestrator. Owns `POST /v1/purchases/:id/start-build` (per [ADR-0001](../adr/adr_0001_buyer_triggered_build.md)) and the **full** `paid → building → minting → confirmed | failed` purchase-state machine (mint now synchronous per [ADR-0008](../adr/adr_0008_self_mint_bubblegum_v2.md)). Coordinates `metadata.captureMonogram` → Registry's `arweave_master` → `image_gen.generateShareCopy` → Registry's `cnft_dispatch` → `post_mint.applyMintSucceeded`. Triggered by buyer's monogram POST, **not** by Stripe webhook. Crash recovery via Prisma row-state on process startup.

## 1. Interface

### 1.1 Inputs

#### startBuild (endpoint handler)
| Field | Type | Notes |
|---|---|---|
| purchase_id | UUID | path param |
| monogram_text | string | body; non-empty |

#### recoverStalled (process startup)
Scans `purchases` for stale rows in (`paid`, `building`, `minting`) and re-spawns the pipeline. No external inputs.

### 1.2 Outputs

#### startBuild
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| status | enum | `'building'` -- the new state |

HTTP 202 Accepted; client polls `GET /v1/purchases/:id` (payments.handleGetPurchase) for terminal status.

#### recoverStalled
| Field | Type | Notes |
|---|---|---|
| recovered_count | int | number of pipelines re-spawned |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| PURCHASE_NOT_FOUND | `purchase_id` not in `purchases` table |
| PURCHASE_NOT_PAID | `purchases.status != 'paid'` |
| MONOGRAM_REQUIRED | empty `monogram_text` |
| BUILD_ALREADY_SPAWNED | `purchases.status` is already `'building'` or `'minting'` (idempotency reject) |

Internal pipeline failures surface to `purchases.failure_reason` and trigger `payments.refundPurchase`; not returned to the start-build caller.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre (startBuild) | `purchases.status='paid'`; `monogram_text` non-empty; PLATFORM_DEK + STRIPE_SECRET_KEY etc. all set (caller modules' concerns) |
| Pre (recoverStalled) | none -- runs at process startup |
| Post (startBuild success) | `purchases.monogram_text` persisted (captureMonogram); `purchases.status='building'`; async pipeline spawned in-process; 202 returned |
| Post (pipeline success) | Registry's cnft_dispatch fires synchronously; `purchases.status` advances `minting → confirmed` after `post_mint.applyMintSucceeded` returns |
| Post (pipeline failure) | `purchases.status='failed'`; `failure_reason='<STEP>_FAILED:<detail>'`; `payments.refundPurchase` called inline |
| Post (recovery) | Each stalled row's pipeline re-spawned; per-step idempotency prevents duplicate work |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | paid purchase; valid monogram | `startBuild(purchase_id, "AB")` | captureMonogram persisted; `status='building'`; pipeline spawned; 202 returned |
| AC-02 | re-call on `'building'` | `startBuild(...)` | `BUILD_ALREADY_SPAWNED`; no double-spawn (conditional UPDATE no-ops) |
| AC-03 | empty monogram | `startBuild(purchase_id, "")` | `MONOGRAM_REQUIRED` |
| AC-04 | arweave terminal failure | pipeline run | `status='failed'`; `failure_reason='ARWEAVE_UPLOAD_FAILED'`; payments.refundPurchase called |
| AC-05 | startup recovery; stuck `paid` > 5 min | `recoverStalled()` | row re-spawned through full pipeline; idempotent per-step checks prevent re-encrypt / re-upload |
| AC-06 | mint dispatched | pipeline reaches step (e) | `purchases.status='minting'`; cnft_dispatch returns synchronously and runImageOps advances to `confirmed` via post_mint.applyMintSucceeded |

## 2. Functional Requirements

### 2.1 startBuild Flow
1. Validate: purchase exists; `monogram_text` non-empty.
2. `metadata.captureMonogram(purchase_id, monogram_text)` -- persists to `purchases.monogram_text` per ADR-0002.
3. Conditional UPDATE: `purchases.status='building' WHERE id=? AND status='paid'` -- on `updateCount===0` return `BUILD_ALREADY_SPAWNED`.
4. Return 202 to client.
5. Spawn async pipeline in-process (`runPipeline(purchase_id)` -- detached from request).

### 2.2 Async Pipeline (per R71 §3.9)

| Step | Operation | Module |
|---|---|---|
| (a) | Read `purchases` + `images` + `users.wallet_address` for the buyer | Prisma |
| (b) | Build on-Arweave Master | Registry: `arweave_master.buildAndUpload(image_id, buyer_wallet_pubkey)` → `{ arweave_uri, sha256, enc_final }` (calls image_gen.decryptOriginal internally) |
| (c) | Build Share Copy | `image_gen.generateShareCopy(image_id, owner_ordinal=1, monogram_text)` → `{ public_id }` |
| (d) | Transition state | Conditional UPDATE `purchases.status='minting' WHERE id=? AND status='building'` |
| (e) | Dispatch mint (synchronous) | Registry: `cnft_dispatch({ image_id, buyer_wallet_pubkey, enc_final, sha256, ... }) -> { asset_id }`. Throws on failure. |
| (f) | Apply mint outcome | On success: `post_mint.applyMintSucceeded` inserts the `deeds` row and advances `minting → confirmed`. On thrown failure: catch → `payments.refundPurchase` → advance to `failed`. |

### 2.3 Retry Policy (R71 §3.9)
- Cloudinary calls inside `image_gen.generateShareCopy` retry 3x with 1/4/16s backoff per image_gen §2.7.
- ArDrive Turbo retries internal to `@ardrive/turbo-sdk`.
- Self-mint retry semantics handled inside `cnft_dispatch` (RPC retries with backoff for transient network failures; deterministic asset_id derivation via `findLeafAssetIdPda` means a retried mint resolves to the same address).
- runImageOps itself does **not** add an outer retry layer -- each external call's retry policy is owned by its module.

### 2.4 Terminal Failure
Any step (b)-(e) terminal failure (after exhausted retries):
1. Conditional UPDATE: `purchases.status='failed'`; `failure_reason='<STEP>_FAILED:<detail>'`
2. Inline call: `payments.refundPurchase(purchase_id)`
3. Pipeline exits

No deed is minted for a partial build (R71 §2.4 step 14 precondition).

### 2.5 Crash Recovery (R71 §3.9)
On process startup, `recoverStalled()` runs once:
1. Query: `purchases WHERE status IN ('paid', 'building', 'minting') AND updated_at < now() - 5 minutes`
2. For each: re-spawn `runPipeline(purchase_id)` via the same code path.
3. Per-step idempotency makes re-runs safe:
   - **arweave_master**: skip if `images.arweave_uri` populated (returns `MASTER_ALREADY_BUILT`)
   - **generateShareCopy**: Cloudinary `public_id` is deterministic; re-call is byte-identical
   - **cnft_dispatch**: idempotent on `purchases.id`; deterministic asset_id derivation means re-dispatching for the same purchase resolves to the same address (no double-mint)

Rows in `'paid'` with no recent updates indicate the buyer POSTed start-build but the process crashed mid-flight; recovery resumes from step (b).

### 2.6 Mint Outcome Handoff
Under [ADR-0008](../adr/adr_0008_self_mint_bubblegum_v2.md) the mint is **synchronous** -- runImageOps catches the return value (success) or thrown exception (failure) and handles both inline. There is no Crossmint webhook. runImageOps invokes `post_mint.applyMintSucceeded` to:
- `mint.succeeded` → write `deeds` row + `metadata.onMintSucceeded` → `purchases.status='confirmed'`
- `mint.failed` → `purchases.status='failed'`; `payments.refundPurchase`

runImageOps exits after step (e); the webhook is the next state-machine owner.

## 3. Architecture

### 3.1 In-Process Spawn at MVP
Per R71 §3.9, runImageOps is an async fn spawned by the startBuild handler with `runPipeline(purchase_id).catch(handleTerminalFailure)`. No queue, no broker. Sufficient at ~3 sales/day MVP volume. MMP migration to BullMQ/Redis is mechanical (R71 §3.9): function bodies stay, the spawn point changes from `runPipeline(...)` to `imageOpsQueue.add({ purchase_id })`.

### 3.2 Purchase Row IS the Workflow State
No separate `jobs` table at MVP. Crash recovery reads `purchases.status` + `updated_at`. State transitions are conditional UPDATEs guarded by expected prior state -- duplicate spawns no-op.

### 3.3 The Only Commerce → Registry Caller
runImageOps is the only Commerce module that calls Registry directly (arweave_master at step b; cnft_dispatch at step e; post_mint at step f). All other Commerce modules stay Web2-bounded.

### 3.4 Endpoint Co-Ownership Note
runImageOps owns `POST /v1/purchases/:id/start-build`; payments owns `POST /v1/webhooks/stripe`, `POST /v1/purchases`. Both touch `purchases` but the route ownership is clean per ADRs.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| startBuild latency | <= 100 ms p95 (validate + captureMonogram + conditional UPDATE + spawn) |
| Pipeline latency | <= 60 s p95 (encrypt + Arweave upload + Share Copy build + mint dispatch) |
| Recovery interval | runs once at process startup |
| Audit | Pino lines per pipeline step: `run_image_ops.<step>` with `purchase_id`, `duration_ms`, `retry_count` |
| Idempotency | startBuild conditional UPDATE; per-step idempotency in downstream modules |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `purchases`, `images`, `users` (Prisma) | state reads + status updates |
| metadata | `captureMonogram` (step 2 of startBuild) |
| image_gen | `generateShareCopy` (step c) + `decryptOriginal` (called by arweave_master internally) |
| payments | `refundPurchase` callback on terminal failure |
| Registry: `arweave_master` (TBD) | step (b) |
| Registry: `cnft_dispatch` | step (e) -- synchronous self-mint per ADR-0008 |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Stale `'paid'` purchases per ADR-0001 -- if buyer never POSTs start-build, sits forever even after recovery (recovery only handles partial pipelines, not unstarted). Grace-period sweeper + auto-default-monogram TBD (mirrors payments OI-08, metadata OI-05, purchase_wsd OI-01) |
| OI-02 | Recovery interval (5 min) -- empirical; tune against typical pipeline latency |
| OI-03 | Idempotency of `captureMonogram` -- last-write-wins on re-POST; should startBuild reject when `purchases.monogram_text` already set + status='building' to prevent monogram change mid-build? See purchase_wsd OI-05 |
| OI-04 | MMP migration path to BullMQ / Redis per R71 §3.9 -- mechanical; documented but not executed |
| OI-05 | Sentry / Founder alert on terminal failure -- currently logged via Pino; explicit page TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| **ADR-0001** | Build trigger: buyer POST drives this module |
| **ADR-0002** | Monogram persisted via captureMonogram before spawn |
| metadata.md | captureMonogram (step 2); onMintSucceeded (post-mint, called inline by post_mint.applyMintSucceeded) |
| image_gen.md | generateShareCopy (step c); decryptOriginal (called by arweave_master internally) |
| payments.md | refundPurchase callback on terminal failure; webhook is upstream (transitions to `paid`) |
| Registry: arweave_master (TBD) | step (b) -- decrypt + re-encrypt + enc_final + ArDrive upload |
| Registry: cnft_dispatch | step (e) -- mint deed |
| Registry: post_mint (applyMintSucceeded) | step (f) -- inline success path; `deeds` insert + `minting → confirmed` |
| [workflows/purchase_wsd.md](../workflows/purchase_wsd.md) | steps 10-13 of Card 4 are owned by this module |
| R71 §2.4 steps 11-14 | authoritative reference for the pipeline shape |
| R71 §3.7 | start-build endpoint NOT in R71 §3.7 (diverged per ADR-0001) |
| R71 §3.8 | purchase state machine |
| R71 §3.9 | async pipeline + retry + crash recovery |

---
*Last Updated: 26/06/10 15:00*
