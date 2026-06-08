# ADR-0007 - Buyer-Friendly Retry Model for Deed Issuance

## Status

Accepted (2026-06-02).

**Dispatch target updated (2026-06-03):** per [ADR-0008](adr_0008_self_mint_bubblegum_v2.md), the dispatch the sweeper retries is now the self-mint dispatcher at [deed.md](../registry/deed.md), not the Crossmint API. Retry semantics unchanged; only the dispatch target shifts. References to "Crossmint" throughout this ADR's narrative should be read as "the mint dispatcher" -- the rest of the buyer-friendly retry model applies identically.

## Context

The buyer's purchase journey at R71 §2.4 has three parts:

1. **Buyer-active**: discover, sign in, sign contracts, pay, choose monogram. The buyer is interactively driving each step in a UI session.
2. **Platform-active**: image ops (decrypt Original, build canonical Master, upload to Arweave, generate Share Copy) and deed mint (Crossmint API). The buyer's role is "wait".
3. **Buyer-passive**: confirmation, Collection availability, post-mint render swap.

ADR-0001 separated payment from build by routing the build through a buyer-initiated `POST /v1/purchases/:id/start-build`. This kept the slow Arweave + Crossmint calls out of the Stripe webhook handler. But it left ambiguous what happens when that build call fails: does the buyer see the failure? Does the buyer retry? Does the platform retry?

In practice we found three failure modes:

- **Transient infrastructure**: Arweave Turbo bundler returns 402 (out of credit), Crossmint times out, Cloudinary drops a request.
- **Buyer abandonment mid-wizard**: buyer pays, then closes the tab before clicking the monogram-confirm button. `Purchase.status='paid'`, no `monogram_text`, no `start-build` ever called.
- **Buyer abandonment after marking**: buyer pays, picks a monogram, clicks Mark my image, then closes the tab while the dispatch fails silently. `Purchase.status='paid'` (rolled back), `monogram_text` set.

Three failures, three possible responses, and the spec at payments.md OI-08 explicitly leaves the choice open ("auto-default monogram to billing initials + spawn build" or "auto-refund after N hours"; "Owner TBD").

## Decision

Implement a **buyer-friendly retry model** that treats the build pipeline as a platform responsibility once the buyer has marked the image, and that respects buyer agency when they haven't.

### Three rules

**Rule 1 - Buyer marks intent at one point: clicking Mark my image.** This click is the only buyer-initiated action that triggers the build pipeline. The button text is deliberately "Mark my image" (not "Issue deed") to frame the click as a customer marker, not a blockchain transaction the buyer is launching.

**Rule 2 - Once marked, the platform owns retry.** If the dispatch fails for any infrastructure reason (Arweave 402, Crossmint outage, Cloudinary blip, transient network), the server's stale-paid sweeper retries every 60 seconds, indefinitely, using the buyer's persisted `monogram_text`. The buyer never sees a Retry button. The action stack shows "Issuing your deed..." through every retry attempt.

**Rule 3 - Until marked, the platform waits.** If the buyer pays but never clicks Mark my image (tab closed during monogram step), the system makes no decision on their behalf. The `Purchase` row sits at `status='paid', monogram_text=null` indefinitely. Recovery happens on the next signed-in visit to the image page: `GET /v1/images/:id` surfaces a `pending_purchase_id` field for the viewer, and the client auto-opens the BuyWizard at the monogram step. The buyer picks their letters whenever they get back.

### What we explicitly rejected

- **Auto-default monogram from billing initials** (payments.md OI-08 option A). Substitutes platform judgment for buyer choice.
- **Auto-refund after N hours** (payments.md OI-08 option B). Forces a decision (cancellation) the buyer may not have made.
- **Buyer-facing Retry button** (the obvious-looking fix). Makes the buyer feel responsible for platform infrastructure failures they cannot diagnose.

## Consequences

### Positive

- The buyer's mental model is simple: "I marked it, I'll get it." No matter how many Arweave retries the sweeper performs, the buyer's experience is monotone improvement (Issuing -> Issued).
- Operational headroom: when Turbo wallets run out of credit or Crossmint has a bad afternoon, the buyer experience does not degrade. The platform team sees a backlog in Pino logs and tops up / works around without involving the buyer.
- Buyer agency on monogram preserved. Buyers who change their mind mid-flow are not auto-charged into a deed they don't want.

### Negative

- **Orphan paid rows**: a buyer who never returns leaves `Purchase.status='paid'` in the database indefinitely. No on-chain footprint, but a row in the platform balance reconciliation. Operationally cheap; finance team can sweep monthly if desired.
- **Hidden failure visibility**: a class of failures that affects many builds (e.g. Arweave permanently down) might not be visible to operations until a buyer reports the slow state. Mitigated by the sweeper's `[sweep.stale-paid] retry queued` Pino logs and by Sentry / alerting on the underlying error code.
- **Diverges from spec literal**: payments.md OI-08 expected a yes/no answer to auto-default vs auto-refund. We chose "neither and instead wait + recovery on return". Captured in /docs/divergences.md D-03.

### Operational obligations

- Pino log line per failed sweeper attempt: must be monitored. Pattern: `[sweep.stale-paid] retry queued for <purchase_id> : <error_message>`.
- A separate alarm threshold ("more than N concurrent paid purchases stuck for >1 hour") should trigger paging when the broader infrastructure has a real problem.
- Finance reconciliation: a quarterly report of paid-but-never-marked purchases lets the finance team decide whether to issue goodwill refunds to abandoned buyers. The system does not automate this.

## Boundary conditions

| Condition | Outcome |
|---|---|
| Buyer marks, sweeper succeeds first try | Standard flow. ~10-30 seconds from Mark to Deed issued. |
| Buyer marks, Arweave down for an hour | Sweeper retries every 60 seconds for the duration. Buyer sees "Issuing your deed..." for that hour. Eventually succeeds. |
| Buyer marks, Crossmint cannot mint at all (config error, account suspended) | Sweeper retries indefinitely. Operations alerted via Pino logs. Manual intervention required (refund or fix the upstream). |
| Buyer pays, never marks, returns in 1 hour | Pending-purchase recovery fires. Wizard opens at monogram step. Buyer completes. |
| Buyer pays, never marks, returns in 6 months | Same. Pending-purchase lookup is not time-bounded. |
| Buyer pays, never marks, never returns | Paid purchase sits indefinitely. Finance team's call when / whether to refund. |
| Buyer marks twice (e.g. clicks Mark, dispatch fails, manually retriggers) | start-build is idempotent on monogram (no-op once `status='building' OR 'minting' OR 'confirmed'`). Sweeper handles it. |

## Implementation pointers

| Surface | File | Function |
|---|---|---|
| BuyWizard (single-modal flow) | `src/ui/BuyWizard.tsx` | `BuyWizard`, `MonogramStep` |
| Mark my image button + fire-and-forget dispatch | `src/ui/BuyWizard.tsx` | `MonogramStep.onConfirm` |
| Sweeper | `src/app/workers/stale_paid_sweeper.ts` | `sweepStalePaid`, `startStalePaidSweeper` |
| Pending-purchase recovery on image page | `src/ui/Image.tsx` | `ListingPage` useEffect with `recoveredRef` |
| Pending-purchase lookup | `src/app/api/server.ts` | `GET /v1/images/:imageId` response includes `pending_purchase_id` |
| Buyer-facing "Still issuing your deed..." state | `src/ui/Image.tsx` | `PostPurchaseActions` `mintStage === 'failed'` branch |

## Related

| Doc | Why |
|---|---|
| ADR-0001 | Decoupled build from Stripe webhook. This ADR extends that separation into the buyer-friendly retry model. |
| ADR-0002 | Monogram captured at start-build (this ADR re-affirms the placement; the monogram lives on `Purchase.monogram_text`). |
| payments.md OI-08 | Open issue closed by this ADR. |
| /docs/divergences.md D-03, D-04, D-05 | Records this ADR's choices as deliberate spec divergences for traceability. |
| R71 §2.4 step 9 / 12 | Updated to reference the BuyWizard + Mark my image (see surgical edit). |

---

*Last Updated: 26/06/02 14:00*
