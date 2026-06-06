# Crossmint Webhook (Registry) -- SUPERSEDED

> **Status: SUPERSEDED.** When the self-mint dispatcher (/docs/registry/cnft_dispatch.md) ships, the async webhook pattern is replaced by direct in-process awaiting of the Solana `confirmed` commitment after `mint_v1` submission. The `deeds` row insert + `images.status='sold'` flip + `purchases.status='confirmed'` transitions happen synchronously at the end of the Path 4 mint sequence in /docs/registry/mint_architecture.md §4. No webhook surface exists in the self-mint architecture. This doc remains in tree for historical context; see /docs/divergences.md D-14.

Receives `mint.succeeded` / `mint.failed` callbacks from Crossmint. On success: inserts `deeds` row, calls `metadata.onMintSucceeded` (Commerce) to flip `images.status='sold'` + visibility, and transitions `purchases.status='confirmed'`. On failure: calls `payments.refundPurchase`. HMAC signature verification analogous to Stripe.

## 1. Interface

### 1.1 Inputs

#### handleWebhook
| Field | Type | Notes |
|---|---|---|
| raw_body | Buffer | exact bytes Crossmint signed (via `express.raw`) |
| signature | string | from `x-crossmint-signature` header (confirm at integration) |

### 1.2 Outputs

#### handleWebhook
| Field | Type | Notes |
|---|---|---|
| ok | bool | true on success / duplicate; false only on signature failure |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| CROSSMINT_SIGNATURE_INVALID | HMAC verification failed |

Internal handler errors are caught + logged; still respond 200 to avoid Crossmint retry storms.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `express.raw` body parser preserved raw bytes; `CROSSMINT_WEBHOOK_SECRET` set |
| Post (`mint.succeeded`) | `deeds` row inserted (idempotent via PK); `metadata.onMintSucceeded` called; `purchases.status='confirmed'` |
| Post (`mint.failed`) | `purchases.status='failed'`, `failure_reason='MINT_FAILED:<error_code>'`; `payments.refundPurchase` called |
| Post (always) | 200 returned (including duplicates); 400 only on signature failure |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | `mint.succeeded` with valid signature | `handleWebhook(...)` | `deeds` row inserted; `images.status='sold'`; `purchases.status='confirmed'` |
| AC-02 | duplicate `mint.succeeded` | re-call | 200 returned; `deeds.create` errors harmlessly (PK conflict); conditional UPDATE on purchases no-ops |
| AC-03 | `mint.failed` | `handleWebhook(...)` | `purchases.status='failed'`; `payments.refundPurchase` called |
| AC-04 | invalid signature | `handleWebhook(...)` | 400; no DB write |
| AC-05 | Crossmint sends event for an unknown `crossmint_job_id` | `handleWebhook(...)` | logged + ignored; 200 returned |

## 2. Functional Requirements

### 2.1 Signature Verification (R71 §3.3 Crossmint webhook verification)
| Step | Detail |
|---|---|
| Body parsing | `express.raw({ type: 'application/json' })` -- HMAC operates on the exact bytes |
| Verify | HMAC-SHA256 of raw_body against `process.env.CROSSMINT_WEBHOOK_SECRET` (Crossmint SDK helper if available, else `crypto.timingSafeEqual`) |
| Failure | 400 with `CROSSMINT_SIGNATURE_INVALID`; no DB write |

### 2.2 Event Routing

#### `mint.succeeded`
| Step | Detail |
|---|---|
| Read | extract `mint_address`, `transaction_signature`, `purchase_id` (from mint metadata) |
| Insert deed | `prisma.deed.create({ image_id, mint_address, owner_wallet_address, owner_id, deed_state: 'sealed', variant_hashes, minted_at })` -- naturally idempotent via `image_id` PK |
| Cross-function | `metadata.onMintSucceeded(image_id)` -- sets `images.status='sold'` + `images.visibility='private'` (Vault default per R71 §2.6) |
| Update purchase | Conditional UPDATE `purchases.status='confirmed'` WHERE `id=?` AND `status='minting'` |

#### `mint.failed`
| Step | Detail |
|---|---|
| Update purchase | Conditional UPDATE `purchases.status='failed'`, `failure_reason='MINT_FAILED:<error_code>'` WHERE `id=?` AND `status='minting'` |
| Trigger refund | `payments.refundPurchase(purchase_id)` |

### 2.3 Idempotency
- `deeds.image_id` is PRIMARY KEY → re-insert errors harmlessly
- Conditional UPDATE on `purchases.status` uses expected prior state
- Duplicate webhook → no double-mutation; 200 returned

### 2.4 Body Stream Preservation
The Express route uses `express.raw({ type: 'application/json' })` -- not `express.json()`. The application-level JSON parser is registered AFTER the webhook route in middleware order.

## 3. Architecture

### 3.1 The Only Registry → Commerce Caller
This module calls into Commerce's `metadata.onMintSucceeded` and `payments.refundPurchase`. Documented as the sole Registry → Commerce export.

### 3.2 Terminal State Owner
crossmint_webhook owns `minting → confirmed | failed`. `run_image_ops` exits after dispatch; the webhook is the next state-machine owner.

### 3.3 Stripe-Pattern Mirroring
Body parsing + signature verification + conditional UPDATE for idempotency + always-200-except-signature-failure mirrors payments.handleStripeWebhook. Same robustness pattern.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 500 ms p95 (signature verify + DB writes + cross-function calls) |
| Reliability | 200 on duplicate; 400 only on signature failure; internal errors logged but still 200 |
| Audit | Pino `crossmint.webhook.<event_type>` |
| Body parser | `express.raw`; integration-test verified |
| Secrets | `CROSSMINT_WEBHOOK_SECRET` -- never logged |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `deeds`, `purchases`, `images` (Prisma) | state writes |
| `metadata.onMintSucceeded` (Commerce) | sets `images.status='sold'` + visibility |
| `payments.refundPurchase` (Commerce) | refund on mint.failed |
| Express `express.raw` middleware | byte-preserving body parser |
| `process.env.CROSSMINT_WEBHOOK_SECRET` | HMAC verification |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Confirm `x-crossmint-signature` header name + HMAC algorithm at integration time (per current Crossmint dashboard docs) |
| OI-02 | Confirm `mint_address` and `purchase_id` correlation in `mint.succeeded` event payload |
| OI-03 | Webhook secret rotation -- two-secret rolling window TBD |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| crossmint_dispatch.md | Predecessor (queued the mint job) |
| metadata.md (Commerce) | `onMintSucceeded` callback target |
| payments.md (Commerce) | `refundPurchase` callback target |
| `deeds` table (R71 §3.6) | data model |
| R71 §3.3 Crossmint webhook verification | signature pattern |
| R71 §3.7 row 22 | `POST /v1/webhooks/crossmint` |
| R71 §3.8 | purchase state machine terminal transitions |

---
*Last Updated: 05/29/26 17:00*
