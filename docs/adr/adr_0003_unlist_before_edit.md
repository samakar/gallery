# ADR-0003: Listings editable until first sale, via unlist-then-edit

## Status
Accepted -- 2026-05-29.

## Context

R71 §3.8 implies the listing snapshot is **immutable once `status='live'`** -- the price, title, description, and creation date that the public discovers are the ones the buyer will receive. The original protocol treats listing publication as a one-way pin.

In MVP testing, this was too rigid. Creators reasonably expect to fix typos, adjust pricing, or refine descriptions on listings that haven't sold yet. Forcing them to take down + re-upload + re-moderate just to fix a comma is wrong for a creator-first product.

At the same time, we cannot allow a `'live'` listing to mutate **while still being on sale** -- buyers browsing or clicking "Own this" between save and re-render would see one set of terms while another set sits in the DB. The deed-as-receipt mental model requires that what was listed at the moment of purchase is what the deed mirrors.

## Decision

**Editable until first sale, but only via an explicit unlist step.** Three rules:

1. `status='live'` is **read-only** for the creator. The owner-editable form is not rendered. The creator sees an `owner-listed` view: read-only summary + a single "Take off sale to edit" CTA.
2. The unlist action (`POST /v1/images/:imageId/unlist`) is the only way to leave `'live'`. It transitions `status='live' → 'draft'` and `visibility='public' → 'private'`. Idempotent on already-draft.
3. Once edits are complete, the creator must re-invoke `POST /v1/images/:imageId/list` to publish again. The Card 3 List workflow path is identical to the first publication, including the metadata-completeness checklist on the UI.

`status='sold'` remains immutable (the deed has already minted). `status='taken_down'` remains immutable (separate concern owned by `cert/takedown.md`).

There is no "live + mutating" state at any point. The DB only ever sees `'live'` rows that match what the public last saw.

## Consequences

**Positive:**

- Creators can iterate on pre-sale listings without contacting support or re-doing certification
- No mid-listing mutation race -- the public never observes a stale snapshot
- "Editable iff not sold" is a clean two-rule policy: status `∈ {pending_review, draft}` → editable; `∈ {live, sold, taken_down}` → not. Live is special-cased only via the unlist transition
- Card 3 publication path is reused for re-listing -- no second-publish code branch

**Negative:**

- One new endpoint (`POST /v1/images/:imageId/unlist`) and one new render state (`owner-listed`)
- Two-click unlist-then-edit costs a beat of latency vs. inline editing
- A creator who unlists without re-listing leaves a stranded draft -- adds a "stale draft" surface to the dashboard (see metadata.md OI-03)

## R71 reconciliation

| R71 | Status after ADR-0003 |
|---|---|
| §3.8 listing snapshot immutable post-publish | **Diverges** -- editable via unlist transition while not sold |
| §3.4 row 6 OI "Edit / Delete of listing post-publish deferred to MMP" | **Resolved at MVP** for pre-sale via unlist; post-sale remains immutable |
| §2.2 step 9 publishListing | Unchanged -- re-list goes through the same publish path |

## Affected files

| File | Change |
|---|---|
| `src/app/api/server.ts` | New `POST /v1/images/:imageId/unlist` route |
| `src/ui/Image.tsx` | New `owner-listed` render state + `OwnerListedView` component; `deriveState` routes `is_creator && status='live'` → owner-listed |
| `docs/commerce/metadata.md` | Add `unlistListing` to interface; update visibility state machine to include `live → draft` transition |
| `docs/workflows/list_wsd.md` | Add unlist sub-workflow; update state transitions table |

## Cross-references

| Doc | Purpose |
|---|---|
| [commerce/metadata.md](../commerce/metadata.md) | Owns the new `unlistListing` surface |
| [workflows/list_wsd.md](../workflows/list_wsd.md) | Card 3 List workflow + unlist sub-flow |
| R71 §3.4 row 6 OI | The deferred edit-post-publish open issue this resolves for pre-sale |
| R71 §3.8 | Image lifecycle (now includes `live → draft` per this ADR) |

---
*Last Updated: 05/29/26 16:30*
