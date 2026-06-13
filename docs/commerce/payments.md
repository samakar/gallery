# Payments (Commerce)

Stripe orchestration: checkout init, the four webhook handlers, 90 / 10 net split, refunds. Owns the entry and exit of the purchase pipeline (`purchases.status` lands at `started` from checkout init; lands at `paid` on success; lands at `failed` then `refunded` on payment failure or downstream terminal collapse). The middle of the pipeline (`paid → building → minting → confirmed`) is owned by runImageOps, which calls into the self-mint cnft_dispatch synchronously (no Crossmint webhook -- per ADR-0008, cNFT mints are self-issued via Bubblegum V2 inside runImageOps). Per **ADR-0001**, runImageOps is triggered by a buyer-initiated `start-build` POST, not by this module's webhook handler.

## 1. Interface

### 1.1 Inputs

#### initCheckout
| Field | Type | Notes |
|---|---|---|
| image_id | string(5) | the image being purchased |
| owner_id | UUID | from authenticated session (owners row exists post-MJA) |

#### handleStripeWebhook
| Field | Type | Notes |
|---|---|---|
| raw_body | Buffer | exact bytes Stripe signed (via `express.raw`, not `express.json`) |
| signature | string | from `Stripe-Signature` header |

#### refundPurchase
| Field | Type | Notes |
|---|---|---|
| purchase_id | UUID | terminal-failure trigger from runImageOps (which owns mint outcome under self-mint per ADR-0008) |

### 1.2 Outputs

#### initCheckout
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| purchase_id | UUID | `purchases.id` (state = `started`) |
| client_secret | string | Stripe Embedded Checkout client_secret |
| checkout_session_id | string | persisted to `purchases.stripe_checkout_session_id` |

#### handleStripeWebhook
| Field | Type | Notes |
|---|---|---|
| ok | bool | true on successful processing OR duplicate (idempotent); false only on signature failure |

#### refundPurchase
| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| stripe_refund_id | string | from `stripe.refunds.create` |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| STRIPE_PAYMENT_FAILED | Card declined / 3DS failure / Stripe Radar reject; sourced from `payment_intent.payment_failed` event `decline_code` |
| STRIPE_SIGNATURE_INVALID | HMAC verification failed OR `Stripe-Signature` timestamp drift > 5 minutes |
| PURCHASE_NOT_FOUND | `purchase_id` not in `purchases` table |
| REFUND_FAILED | `stripe.refunds.create` exhausted retries (5 attempts, 30 s backoff per R71 §3.9) |

R71 §3.7 surfaces `STRIPE_PAYMENT_FAILED:<decline_code>` to the caller. `MJA_REQUIRED` and `LICENSE_REQUIRED` are esign concerns; `MONOGRAM_REQUIRED` is the build-trigger surface (per ADR-0001), not this module.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre (initCheckout) | `images.status='live'`; `owners` row exists; MJA + License Acceptance captured per INV-2 (caller responsibility -- esign) |
| Pre (handleStripeWebhook) | raw body byte stream + `Stripe-Signature` header preserved (`express.raw`) |
| Pre (refundPurchase) | `purchases.status` is `failed` OR upstream collapsed (`building` / `minting`) and the caller is runImageOps |
| Post (initCheckout) | `purchases` row inserted with `status='started'`; Stripe Checkout Session created; client_secret returned |
| Post (payment_intent.succeeded) | `purchases.status='paid'`; 90 / 10 net amounts persisted. **Does NOT spawn runImageOps** (ADR-0001) |
| Post (payment_intent.payment_failed) | `purchases.status='failed'`; `failure_reason='STRIPE_PAYMENT_FAILED:<decline_code>'`; no refund (no charge ever captured) |
| Post (charge.refunded) | `purchases.status='refunded'`; row excluded from creator-earnings aggregation |
| Post (refundPurchase) | `stripe.refunds.create` called with idempotency key = `purchase_id`; eventually `charge.refunded` arrives |
| Post (any webhook) | 200 returned (including duplicates); 400 only on signature failure |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image in `live`; MJA + License on file; owner exists | `initCheckout(image_id, owner_id)` | row with `status='started'`; Checkout Session created; client_secret returned |
| AC-02 | valid `payment_intent.succeeded` with matching signature | `handleStripeWebhook(...)` | `status='paid'`; 90 / 10 persisted; **no runImageOps spawn** (per ADR-0001) |
| AC-03 | duplicate `payment_intent.succeeded` (already `paid`) | `handleStripeWebhook(...)` | 200 returned; conditional UPDATE no-ops; no double-persist |
| AC-04 | invalid signature | `handleStripeWebhook(...)` | 400 returned; no DB write |
| AC-05 | `payment_intent.payment_failed` | `handleStripeWebhook(...)` | `status='failed'`; `failure_reason='STRIPE_PAYMENT_FAILED:<decline_code>'`; no refund |
| AC-06 | runImageOps terminal failure | `refundPurchase(purchase_id)` | `stripe.refunds.create` called with idempotency key; later `charge.refunded` arrives and sets `status='refunded'` |

## 2. Functional Requirements

### 2.1 Checkout Init (R71 §3.7 row 15; R71 §3.3 Stripe section)
At `POST /v1/purchases`:

| Step | Detail |
|---|---|
| Create row | `purchases.create({ image_id, owner_id, seller_user_id: image.creator_id, status: 'started' })` |
| Resolve customer | If `owners.stripe_customer_id` null → `stripe.customers.create({ email: users.email })` → persist; else reuse |
| Create Session | `stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], line_items: [{ price_data: image.listed_price }], customer: stripe_customer_id, metadata: { purchase_id } })` |
| Persist | `purchases.stripe_checkout_session_id` set |
| Return | client_secret for the Embedded Checkout component |

### 2.2 Webhook Signature Verification (R71 §3.3 Stripe webhook verification)
On every `POST /v1/webhooks/stripe`:

| Step | Detail |
|---|---|
| Body parsing | `express.raw({ type: 'application/json' })` -- HMAC operates on the exact byte stream; JSON re-serialization breaks signature |
| Verify | `stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)` -- throws on mismatch or timestamp drift > 5 min |
| Failure | catch → return 400 with `STRIPE_SIGNATURE_INVALID`; no DB write |

### 2.3 Webhook Event Routing
Four events (R71 §3.3 Stripe):

| Event | DB Action |
|---|---|
| `checkout.session.completed` | Conditional UPDATE: set `purchases.stripe_checkout_session_id` if not already set (idempotent confirmation) |
| `payment_intent.succeeded` | Conditional UPDATE `WHERE id = metadata.purchase_id AND status = 'started'`; on `updateCount === 1`: persist `amount_gross_cents` + 90 / 10 net split. **Does NOT spawn runImageOps** -- per ADR-0001, the buyer's `POST /v1/purchases/:id/start-build` (carrying `monogram_text`) is what spawns the async build |
| `payment_intent.payment_failed` | Conditional UPDATE `WHERE id = metadata.purchase_id AND status = 'started'`; set `status='failed'`, `failure_reason='STRIPE_PAYMENT_FAILED:<decline_code>'` |
| `charge.refunded` | Conditional UPDATE `WHERE id = metadata.purchase_id AND status IN ('failed', 'paid', 'building', 'minting')`; set `status='refunded'` |

(always) Return 200. On duplicate the conditional UPDATE no-ops (`updateCount = 0`); 400 only on signature failure. Internal handler errors are caught + logged via Pino with `requestId`; response is still 200 to avoid Stripe retry storms.

### 2.4 90 / 10 Net Split (R71 §2.4 step 10)
On `payment_intent.succeeded`, computed net of the Stripe processing fee:

| Field | Computation |
|---|---|
| `amount_gross_cents` | Stripe-reported `amount_received` |
| `stripe_fee_cents` | Stripe-reported `balance_transaction.fee` (see OI-03 for the async-arrival caveat) |
| `net_cents` | `amount_gross_cents - stripe_fee_cents` |
| `amount_creator_net_cents` | `Math.floor(net_cents * 0.9)` |
| `amount_platform_net_cents` | `net_cents - amount_creator_net_cents` (residual rounding to platform) |

Both retained in Elanoid's Stripe balance at MVP. Stripe Connect Express transfers to creators activate at the immediate post-launch buildout per R71 §2.1 (4-week payout cadence from launch).

### 2.5 Refund (R71 §3.9 `runStripeRefund`)
Triggered inline from runImageOps terminal failure (mint synchronous under self-mint cnft_dispatch per ADR-0008; the failure path is a thrown exception within runImageOps, not an asynchronous webhook):

| Step | Detail |
|---|---|
| Call | `stripe.refunds.create({ payment_intent: purchases.stripe_payment_intent_id, reason: 'requested_by_customer' }, { idempotencyKey: purchases.id })` |
| Retry | Up to 5 attempts with 30 s backoff inside the function |
| Webhook | Await `charge.refunded` (handled by §2.3) -- this flips `status` to `refunded` |
| Terminal failure | Append refund-failure suffix to `purchases.failure_reason`; page via Sentry; manual reconciliation required |

### 2.6 Stripe Radar (OFAC / SDN Screening)
Stripe Radar applies OFAC and SDN screening at the payment-instrument level (R71 §3.3). Platform performs no separate sanctions check. A reject surfaces as `payment_intent.payment_failed` with the relevant `decline_code`.

### 2.7 Idempotency Strategy (R71 §3.3)
- **Webhook idempotency**: conditional UPDATE keyed on `(purchase_id, expected_prior_status)`. SQLite row-level locking serializes concurrent duplicate webhooks. Handler proceeds only when `updateCount === 1`.
- **Refund idempotency**: `stripe.refunds.create` idempotencyKey = `purchases.id`. Re-invocation returns the existing refund.
- No separate idempotency table at MVP -- the existing row state IS the dedup token.

## 3. Architecture

### 3.1 Entry + Exit Owner; Middle Delegated (ADR-0001)
Payments owns these transitions:
- `(none) → started` (initCheckout)
- `started → paid` (`payment_intent.succeeded` webhook -- no spawn)
- `started → failed` (`payment_intent.payment_failed` webhook)
- `failed → refunded` (`charge.refunded` webhook)
- Refund call (refundPurchase)

Delegated transitions:
- `paid → building` (buyer's `POST /v1/purchases/:id/start-build` per ADR-0001)
- `building → minting` (runImageOps internal)
- `minting → confirmed | failed` (Registry cnft_dispatch synchronous mint inside runImageOps)
- `paid|building|minting → refunded` callback into `refundPurchase`

### 3.2 Webhook Body Stream Preservation
The Express route uses `express.raw({ type: 'application/json' })` -- the application-level body parser is registered AFTER the webhook route in middleware order, so the raw bytes survive for HMAC verification.

### 3.3 No Server-Side Card Storage
PAN is vaulted at Stripe; never touches the platform (INV-02 alignment). Card is re-entered on every purchase at MVP. Saved-card / `setup_future_usage` deferred to MMP per R71 §2.4 returning-buyer flow.

### 3.4 Webhook Is State Transition Only (ADR-0001)
On `payment_intent.succeeded`, the webhook handler returns 200 to Stripe after a single conditional UPDATE. **runImageOps is NOT spawned from the webhook** -- the buyer's subsequent `POST /v1/purchases/:id/start-build` (with `monogram_text` in body) is what spawns it. This decouples the async build from the Stripe webhook lifecycle and lets monogram be passed as an inline parameter rather than a persisted column.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Webhook latency | <= 500 ms p95 (signature verify + 1 DB UPDATE) |
| Webhook reliability | 200 on duplicate; 400 only on signature failure; internal errors caught + logged but still 200 to avoid Stripe retry storms |
| Refund retry | up to 5 attempts with 30 s backoff inside refundPurchase |
| Audit | Pino log lines: `stripe.checkout.init`, `stripe.webhook.<event_type>`, `stripe.refund.create` with `purchase_id`, op, `duration_ms` |
| Body parser | webhook route uses `express.raw`; integration-test verified |
| Secrets | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` -- never logged |

## 5. Dependencies

| Dependency | Role |
|---|---|
| Stripe Node SDK | checkout sessions, refunds, webhook construct/verify (R71 §3.2) |
| `purchases` table (Prisma) | source of truth for purchase state per R71 §3.8 |
| `owners.stripe_customer_id` (Prisma) | Stripe Customer handle |
| `images` table (Prisma) | read for `listed_price` + `creator_id` (→ `seller_user_id`) |
| Express `express.raw` middleware | byte-preserving body parser for webhook route |
| runImageOps (Commerce, TBD) | calls back into `refundPurchase` on terminal failure -- NOT spawned by payments per ADR-0001 |
| email subsystem (TBD) | optional Founder alert on refund failure |
| `process.env.STRIPE_SECRET_KEY` | server-side Stripe API auth |
| `process.env.STRIPE_WEBHOOK_SECRET` | HMAC verification for inbound webhooks |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Stripe Connect Express creator payouts -- deferred to immediate post-launch buildout per R71 §2.1. Activation adds a `payments.transfer` surface + 4-week payout cadence from launch |
| OI-02 | Saved-card / `setup_future_usage` for returning purchases -- deferred to MMP per R71 §2.4. payments would persist a Stripe `payment_method` reference |
| OI-03 | Processing-fee source -- `balance_transaction.fee` is canonical but arrives asynchronously after `payment_intent.succeeded`. At MVP we may read the fee from the `payment_intent.charges[0].balance_transaction` expansion in the event; reconcile in a nightly job if drift occurs |
| OI-04 | Test-mode vs live-mode keys -- env-config; rotation procedure when going live is straightforward but undocumented |
| OI-05 | Buyer-initiated refund (cancel within 30 days) -- R71 doesn't expose this surface at MVP; refundPurchase is system-triggered only |
| OI-06 | Webhook signing-secret rotation -- two-secret rolling window is the Stripe-recommended pattern; not implemented at MVP |
| OI-07 | High-volume webhook handling -- single conditional UPDATE per event is sufficient at MVP volume (~3 sales / day per R71 §3.9). At MMP scale, queue-based ingestion may be needed |
| OI-08 | **Resolved by ADR-0007 (2026-06-02).** Stale `paid` purchases split two ways: (a) `monogram_text` set + dispatch failed transiently -> stale-paid sweeper at `src/app/workers/stale_paid_sweeper.ts` retries `start-build` every 60s indefinitely using the persisted monogram, no buyer involvement; (b) `monogram_text` null (buyer never clicked Mark my image) -> system waits indefinitely, no auto-default, no auto-refund; recovery happens on next signed-in visit via `pending_purchase_id` in the image GET response, which auto-opens the BuyWizard at the monogram step. See /docs/divergences.md D-03, D-04, D-05 for the rationale; auto-default-from-billing-initials and auto-refund-after-N-hours both rejected in favor of buyer agency |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| **ADR-0001** | Buyer-triggered build / no monogram persistence -- the divergence shaping §2.3, §2.6 removal, and §3.4 |
| esign | MJA + License Acceptance precede checkout (INV-2); R71 §3.7 row 16 `sign-license` endpoint |
| image_gen | `monogram_text` flows from `purchases.monogram_text` (metadata-persisted per ADR-0002) via runImageOps to `generateShareCopy` |
| runImageOps | Triggered by buyer's `start-build` POST per ADR-0001; calls Registry's `arweave_master` + image_gen + Registry's `cnft_dispatch` (self-mint, synchronous, per ADR-0008); calls back into `refundPurchase` on terminal failure |
| renderer (TBD) | Not coupled to payments; serves the cached Share Copy via signed URL post-confirmation |
| Registry cnft_dispatch | Self-mint Bubblegum V2 entry point invoked synchronously by runImageOps (no webhook). Success returns `asset_id`; failure throws and runImageOps calls `refundPurchase` here |
| R71 §2.4 steps 5-10 | Buyer purchase flow (this module diverges at step 7 spawn -- see ADR-0001) |
| R71 §3.3 (Stripe) | Detailed vendor contract (events, body parsing, HMAC verification, idempotency) |
| R71 §3.7 rows 15, 18, 21 | API endpoints owned by payments (row 17 monogram endpoint dropped per ADR-0001) |
| R71 §3.8 (Purchase lifecycle) | State machine jointly owned by payments (entry/exit) + runImageOps (build → mint → confirmed) |
| R71 §3.9 | runImageOps + runStripeRefund (trigger source diverges per ADR-0001) |
| Constitution INV-02 | Platform MUST NOT hold buyer private keys (Stripe vaults PAN, not platform) |

---
*Last Updated: 26/06/10 14:30*
