# ADR-0006: ISA decoupled from moderation

## Status
Accepted -- 2026-05-29.

## Context

[docs/workflows/certify_wsd.md](../workflows/certify_wsd.md) step 7 places the **Image Signing Affirmation** (ISA) after **moderator review** (step 5). The implicit sequencing rule has been: a creator cannot sign the ISA until a moderator has approved the image (i.e. `images.status` has transitioned `pending_review → draft`).

The rationale at the time was clean linearity -- ISA "follows" moderation in time and in the workflow diagram. But the two concerns are independent:

- **Moderation** answers: *does this image violate Tier 0 / Tier 1 policy?* (abuse, rights).
- **ISA** answers: *does the creator legally affirm "I am the creator and have the right to sell this image"?*

A creator's claim of authorship doesn't depend on whether a moderator has finished reviewing the content. Forcing the order created idle round-trips: upload → wait for review → come back → click → wait → put on sale. The "come back" step is invisible work imposed on the creator for no compensating benefit.

In MVP testing this surfaced as a UX complaint: the affirmation row showed "Affirmation unlocks after moderator approval" and creators reasonably asked why.

## Decision

**ISA is available throughout the pre-sale window. Moderation and affirmation are independent gates on `POST /v1/images/:imageId/list`; neither blocks the other.** Three rules:

1. `POST /v1/images/:imageId/sign-affirmation` accepts requests when `images.status ∈ {pending_review, draft}` and the caller is `images.creator_id`. Returns `409 IMMUTABLE_STATUS` on `{live, sold, taken_down}`.
2. `POST /v1/images/:imageId/list` (Put on Sale) requires **both** `images.status = 'draft'` (moderator-approved) AND `images.signing_event_id_authorship` non-null (ISA signed). Order of completion doesn't matter.
3. The certify workflow diagram (step 7) is re-cast as parallel-to-moderation rather than after-moderation. The creator may sign the ISA at any point post-upload; the "Put on sale" gate is the synchronization point.

INV-2 ("ESIGN precedes the entity it admits") is preserved at the level it actually binds: the ISA still precedes the entity it admits, which is the on-chain deed (Card 5 mint), not the moderator-approved status. The earlier `pending_review → draft → ISA` reading conflated "the entity ISA admits" with "the status transition that precedes ISA in the workflow diagram." This ADR disentangles them.

## Consequences

**Positive:**

- Creators can complete affirmation immediately after upload while moderation runs (often hours apart for human review)
- One fewer return-visit in the certification flow -- the only blocking dependency that remains is moderation itself, which inherently requires creator-external time
- The UI's "ISA row" copy simplifies from three states (locked / unsigned / signed) to two (unsigned / signed) -- the locked-with-explanation state is gone
- Independent gates compose more cleanly than ordered ones: the listing-readiness checklist now reads as `Need: signed affirmation, profile (...), moderator approval` (commutative); previously the affirmation step couldn't even appear in the checklist while moderation was pending

**Negative:**

- A creator may sign the ISA on an image that later gets rejected by moderation. The signature row stays in the `signatures` table for an image whose `status` ends at `taken_down`. Acceptable -- it's evidence the creator affirmed something they shouldn't have, which is a feature for fraud / TOS-violation cases, not a defect. The "stale signature for rejected content" is exactly the audit trail you want
- INV-2's reading changes from "ISA precedes draft" to "ISA precedes deed mint" -- the latter is what the constitution actually says, but anyone holding the former interpretation needs to re-anchor

## R71 reconciliation

| R71 / WSD reference | Status after ADR-0006 |
|---|---|
| certify_wsd.md step 7 ordering (after step 5 / step 6) | **Recast as parallel**: step 7 may execute at any time after step 3, gated only by `status ∈ {pending_review, draft}` |
| R71 §3.7 row 7 (`POST /v1/creator/uploads/:imageId/sign-affirmation`) | Endpoint contract unchanged; precondition relaxed from `status='draft'` to `status ∈ {pending_review, draft}` |
| Constitution INV-2 | **Preserved**: ISA still precedes the entity it admits (deed mint at Card 5). The earlier reading (ISA precedes draft transition) was incorrect attribution to INV-2 |
| R71 §3.8 image lifecycle | Unchanged -- no new states |

## Affected files

| File | Change |
|---|---|
| `src/app/api/server.ts` | Sign-affirmation precondition relaxed from `status='draft'` to `status ∈ {pending_review, draft}`; rejection code renamed `NOT_DRAFT → IMMUTABLE_STATUS` for symmetry with edit/delete gates |
| `src/ui/Image.tsx` | `IsaRow` collapses to two states (unsigned / signed); `moderated` prop dropped; the "locked" copy is removed |
| `docs/workflows/certify_wsd.md` | Step 7 description + step-sequence note flag ISA as parallel to steps 5-6; cross-refs add ADR-0006 |

## Cross-references

| Doc | Purpose |
|---|---|
| [workflows/certify_wsd.md](../workflows/certify_wsd.md) | Workflow updated to reflect the parallel ordering |
| [cert/esign.md](../cert/esign.md) | ISA interface contract -- unchanged |
| Constitution INV-2 | Reinterpreted (was: ISA → draft; now: ISA → deed mint); no constitution edit required since the original wording supports the new reading |
| R71 §3.7 row 7 | Endpoint contract unchanged; precondition relaxed |

---
*Last Updated: 05/29/26 18:00*
