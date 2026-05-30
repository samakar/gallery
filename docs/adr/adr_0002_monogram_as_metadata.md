# ADR-0002: Monogram Persistence as Metadata

## Status
Accepted -- 2026-05-29. **Partially supersedes [ADR-0001](adr_0001_buyer_triggered_build.md)** -- re-instates `purchases.monogram_text` persistence. The build-trigger decision from ADR-0001 (buyer POST, not Stripe webhook) is preserved.

## Context
ADR-0001 dropped `purchases.monogram_text` on the reasoning that monogram is "input to a build, not durable purchase data."

Subsequent consolidation (listings + share_flow + monogram into one `metadata` module) reframes monogram as **per-purchase metadata** that belongs alongside other persisted row state. Additional benefits over the inline-only approach:

- One module owns all per-image / per-purchase row writes (cleaner Commerce boundary)
- Audit trail of buyer's choice independent of the Share Copy bytes
- FS-loss recovery -- Share Copy can be rebuilt from Original + persisted monogram
- Optional future surfaces (e.g., deed-content page) can render "Monogram: \<text\>" as a metadata field

## Decision
Restore `purchases.monogram_text`. The buyer's `POST /v1/purchases/:id/start-build` (per ADR-0001):

1. Calls `metadata.captureMonogram(purchase_id, monogram_text)` → persists to `purchases.monogram_text`
2. Spawns `runImageOps(purchase_id)`
3. `runImageOps` reads `purchases.monogram_text` and passes it inline to `image_gen.generateShareCopy`

`image_gen` still receives monogram as an inline parameter (DB-agnostic). The DB read lives in `runImageOps`. The Cloudinary boundary stays intact.

## Consequences

**Positive:**
- Metadata module gets clean ownership of monogram alongside listing CRUD and visibility
- Buyer's choice survives FS-only failures
- Cleaner audit trail
- Simpler future surfaces (deed-content page can display monogram as metadata)

**Negative:**
- One column restored in the schema
- `runImageOps` does one extra Prisma read per build (negligible)
- ADR-0001 is partially superseded (must be marked)

## What ADR-0001 still owns (preserved)

- Build trigger: buyer's `POST /v1/purchases/:id/start-build`, NOT Stripe webhook
- `payment_intent.succeeded` webhook only transitions `purchases.status='paid'`; no `runImageOps` spawn from webhook
- R71 §3.7 row 17 (`POST /v1/purchases/:id/monogram`) stays dropped -- the start-build endpoint subsumes the capture step

## R71 reconciliation

| R71 | Status after ADR-0001 + ADR-0002 |
|---|---|
| §2.4 step 7 (`payment_intent.succeeded` → spawn runImageOps) | Diverges per ADR-0001 (webhook just transitions) |
| §2.4 step 9 (monogram persisted to `purchases`) | **Re-aligned** per ADR-0002 (persisted) |
| §3.7 row 17 (`POST /v1/purchases/:id/monogram` capture-only endpoint) | Diverges per ADR-0001 (no separate endpoint; start-build subsumes) |
| §3.9 runImageOps trigger | Diverges per ADR-0001 (buyer POST, not webhook) |

## Affected files

| File | Change |
|---|---|
| `prisma/schema.prisma` | Restore `Purchase.monogram_text String?` |
| `docs/commerce/metadata.md` (new) | Owns `captureMonogram` alongside listings + visibility |
| `docs/commerce/image_gen.md` | `monogram_text` input is still inline to `generateShareCopy`; source is now `purchases.monogram_text` (read by `runImageOps`) |
| `docs/commerce/payments.md` | Update cross-ref note for monogram |
| `docs/sad.md` §2.2 | Update ADR pointer to mention both ADRs |
| `docs/adr/adr_0001_buyer_triggered_build.md` | Mark partial supersession |

---
*Last Updated: 05/29/26 15:30*
