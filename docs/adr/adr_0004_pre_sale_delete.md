# ADR-0004: Pre-sale delete, post-sale immutable

## Status
Accepted -- 2026-05-29.

## Context

R71 §3.4 row 6 originally deferred image deletion to MMP. [ADR-0003](adr_0003_unlist_before_edit.md) resolved the pre-sale **edit** half of that OI via unlist-then-edit. The pre-sale **delete** half remained open.

Creators reasonably need to drop work that turned out wrong: a typo'd upload, a duplicate, an image they decided against publishing. Forcing them to leave abandoned drafts in their grid (or to contact support to remove rows) is wrong for a creator-first product.

The deed-as-receipt model still requires that anything **sold** is permanent -- the buyer's deed cryptographically references the image, and the creator cannot retroactively erase what was sold (INV-01). `taken_down` is also permanent: it's a moderator-owned state that requires the row to survive for audit and regulatory purposes.

## Decision

**Deletable in `pending_review` and `draft`. Never in `sold` or `taken_down`. `live` requires unlist-first (same two-step gate as ADR-0003 edits).** Three rules:

1. The `DELETE /v1/images/:imageId` endpoint accepts requests only when `images.status ∈ {pending_review, draft}` and the caller is `images.creator_id`. Anything else returns 409 `IMMUTABLE_STATUS` or 403 `FORBIDDEN`.
2. Deletion cascades at MVP: `image_reviews` rows (FK to image) are removed first, then the `images` row, then the Cloudinary asset (best-effort -- DB is authoritative).
3. `live` images cannot be deleted directly. The creator must first call `unlistListing` (which moves the row to `draft`) -- then the regular delete path applies. No "force delete from live."

No soft-delete at MVP. No `deleted_at` column. No trash bin. Cancelled work disappears entirely.

## Consequences

**Positive:**

- Creators can clean up their grid without contacting support
- "Deletable iff not sold and not moderator-locked" is the same status partition as the edit rule (ADR-0003): `pending_review | draft` are mutable, `live` is two-step, `sold | taken_down` are terminal
- No new state, no new column -- reuses the existing status partition
- Cloudinary storage stays bounded (orphan assets cleaned up on delete)

**Negative:**

- No undo. A creator who clicks "Delete" and confirms loses the row permanently
- `image_reviews` rows are deleted alongside the image -- the moderator-decision audit trail on draft images is lost. Acceptable at MVP (these reviews exist only to gate the `draft` transition; once the image is gone there's nothing to audit)
- Cloudinary destroy is best-effort; a network blip leaves an orphan asset. The DB is authoritative and orphan assets are tolerable (cleanup sweeper can be added later)
- Hard delete diverges from data-engineering norms (soft-delete + sweeper). Acceptable for creator-controlled rows where the creator is the only legitimate audit consumer pre-sale

## R71 reconciliation

| R71 | Status after ADR-0004 |
|---|---|
| §3.4 row 6 OI "Edit / Delete of listing post-publish deferred to MMP" | **Fully resolved at MVP for pre-sale**: edit via [ADR-0003](adr_0003_unlist_before_edit.md), delete via this ADR. Post-sale (`sold`) remains immutable. |
| §3.6 `images` table | No schema change -- existing status partition gates the new endpoint |
| §3.8 image lifecycle | Adds terminal `{pending_review, draft} → ∅` (row removed) transitions to the state machine |

## Affected files

| File | Change |
|---|---|
| `src/commerce/image_gen.ts` | New `deleteAsset(image_id)` -- best-effort Cloudinary destroy |
| `src/app/api/server.ts` | New `DELETE /v1/images/:imageId` route; cascade-deletes `image_reviews` then `images`, then async Cloudinary destroy |
| `src/ui/Image.tsx` | "Delete" button on owner-editable view with `window.confirm` gate; navigates to `/creator` on success. Owner-listed view's CTA copy updated to "Take off sale to edit or delete" |
| `docs/commerce/metadata.md` | Add `deleteImage` to interface + ACs |
| `docs/workflows/list_wsd.md` | Mark OI-01 fully resolved (edit + delete) for pre-sale |

## Cross-references

| Doc | Purpose |
|---|---|
| [ADR-0003](adr_0003_unlist_before_edit.md) | Sister ADR -- same two-step gate for `live → draft` |
| [commerce/metadata.md](../commerce/metadata.md) | Owns the new `deleteImage` surface |
| [workflows/list_wsd.md](../workflows/list_wsd.md) | OI-01 update |
| R71 §3.4 row 6 OI | The deferred edit-AND-delete-post-publish OI this fully resolves for pre-sale |
| R71 §3.8 | Image lifecycle (now includes row-removal terminals per this ADR) |

---
*Last Updated: 05/29/26 16:45*
