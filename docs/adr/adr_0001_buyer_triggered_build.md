# ADR-0001: Buyer-Triggered Build (Monogram Inline, No Persistence)

## Status
Accepted -- 2026-05-29. **Partially superseded by [ADR-0002](adr_0002_monogram_as_metadata.md)**: the "drop `purchases.monogram_text`" decision is reversed -- monogram is persisted as metadata. The build-trigger decision (webhook → buyer POST) **remains accepted**. **Diverges from R71** §2.4 step 7 / §3.7 row 17 / §3.9 `runImageOps` spawn point.

**Dispatch target updated (2026-06-03):** per [ADR-0008](adr_0008_self_mint_bubblegum_v2.md), `runImageOps` step (e) now targets the self-mint dispatcher at [cnft_dispatch.md](../registry/cnft_dispatch.md) (Bubblegum V2 `mint_v1` signed by HOT_MINT_KEY) rather than the Crossmint API. The buyer-triggered build trigger is unchanged; only the downstream mint mechanism shifts.

## Context

R71's purchase flow (§2.4 steps 7-13 + §3.9 `runImageOps`) is async-triggered-by-webhook:

- Step 7: `payment_intent.succeeded` webhook fires; handler spawns `runImageOps`.
- Step 9: buyer enters monogram in the UI; persisted to `purchases.monogram_text` via `POST /v1/purchases/:id/monogram` (R71 §3.7 row 17).
- Steps 11-13: `runImageOps` reads `purchases.monogram_text` to build the Share Copy.

This requires:

- A nullable column `purchases.monogram_text` that exists solely as an async handoff slot.
- A capture-only endpoint.
- An implicit waiting / polling mechanism for `runImageOps` to know when the monogram is present (the webhook fires BEFORE the buyer enters monogram).

The monogram is needed only at Share Copy build (R71 §2.4 step 13). The buyer enters it **after** payment is complete (R71 §2.4 step 7 → 9), on the post-payment confirmation surface, while still in the UI session.

## Decision

Move the build trigger from the Stripe webhook to a buyer-initiated POST. The webhook becomes a pure state transition; the build is launched by the buyer's monogram POST with `monogram_text` inline.

```
payment_intent.succeeded webhook → purchases.status='paid' + 90/10 split persist
                                  (no spawn)
buyer POST /v1/purchases/:id/start-build → runImageOps(purchase_id, monogram_text)
                                          purchases.status → 'building'
```

Specifically:

- `payment_intent.succeeded` webhook handler stops spawning `runImageOps`. Only state transitions to `paid` and persists the 90/10 net split.
- New endpoint `POST /v1/purchases/:id/start-build` takes `monogram_text` in the body and spawns `runImageOps` with monogram inline.
- `purchases.monogram_text` column is **dropped**.
- `POST /v1/purchases/:id/monogram` capture-only endpoint is **dropped**.
- `MONOGRAM_REQUIRED` error code moves from payments to the build-trigger surface (runImageOps / start-build endpoint).
- `runImageOps` reads monogram from its spawn parameters, not from the DB.

## Consequences

**Positive:**
- Schema is simpler (one less nullable column).
- API surface is narrower (one less endpoint).
- Monogram flows as a **parameter**, matching its nature -- it's an input to a build, not durable purchase data.
- State machine is cleaner: `paid → building` is driven by explicit user action, not by an async webhook.
- No race condition between webhook firing and buyer entering monogram.
- Honest about the data flow -- monogram is post-payment authoring, not part of the transaction record.

**Negative:**
- Diverges from R71 §2.4 step 9, §3.7 row 17, and §3.9 runImageOps spawn point.
- New endpoint `POST /v1/purchases/:id/start-build` is not in R71 §3.7.
- Edge case: buyer closes tab before entering monogram → `purchases.status` sits at `paid` indefinitely (no build triggered). Recovery options: grace-period sweeper auto-defaults monogram to billing initials and triggers build; or auto-refund after N hours. Out of MVP scope; tracked as OI in payments.

## Affected files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Drop `Purchase.monogram_text` |
| `docs/commerce/payments.md` | Drop `setMonogram` interface + §2.6 + `MONOGRAM_REQUIRED`; webhook no longer spawns runImageOps |
| `docs/commerce/image_gen.md` | `monogram_text` arrives from the build-trigger caller, not from `purchases.monogram_text` |
| `docs/sad.md` §2.2 | Drop "monogram capture" from the Transaction bullet |
| `docs/commerce/runImageOps.md` (TBD) | Trigger source = buyer POST; spawn signature accepts `monogram_text` |

## R71 sections explicitly diverged

| R71 | This decision |
|---|---|
| §2.4 step 7 (`payment_intent.succeeded` → spawn runImageOps) | webhook only transitions to `paid`; no spawn |
| §2.4 step 9 (capture monogram → persist on purchases) | capture monogram → pass inline to build trigger; no persist |
| §3.7 row 17 (`POST /v1/purchases/:id/monogram`) | endpoint removed; replaced by `POST /v1/purchases/:id/start-build` |
| §3.9 runImageOps "Triggered by: payment_intent.succeeded handler" | triggered by buyer's start-build POST |

---
*Last Updated: 05/29/26 14:30*
