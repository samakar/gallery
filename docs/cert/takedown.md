# Takedown Subsystem

Reactive content removal post-publication. At MVP per R71: public Report intake is a `mailto:` link (no operational module); the founder receives reports and, when justified, sets `images.status = 'taken_down'` with `images.takedown_reason` via an admin tool. Public surfaces (image page, OG / Twitter Card) return 451 / generic content after takedown. Post-mint deed-state mutation on either axis (legal_state to `disputed` / `void`, custody_state to `burned`) is gated by INV-06 (3-of-5 multi-sig for legal-axis transitions; sweeper-driven for `custody → burned` after the compliance hold expires; owner-signed for voluntary burn) and is deferred to MMP; the full per-regime takedown architecture (DMCA, Take It Down Act, RoP per R62 §4.9) is also deferred.

## 1. Interface

### 1.1 Inputs

#### recordTakedown

| Field | Type | Notes |
|---|---|---|
| image_id | TEXT(5) | -> `images.image_id` |
| reviewer_id | UUID | founder `users.user_id`; moderator role required (per auth) |
| takedown_reason | string | free-text at MVP (DMCA, RoP, ToS-violation, etc.); structured taxonomy deferred |

### 1.2 Outputs

`{ ok: true }` -- idempotent; re-takedown of an already taken-down image is a no-op.

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| IMAGE_NOT_FOUND | `image_id` does not exist |
| TAKEDOWN_REASON_REQUIRED | `takedown_reason` empty |
| ROLE_REQUIRED | caller is not the moderator (raised by auth upstream) |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `image_id` exists; reviewer is moderator (auth check upstream) |
| Post | `images.status = 'taken_down'`; `images.takedown_reason` populated; mutation logged via Pino |
| Post (idempotent) | already `'taken_down'` -> no-op; original reason preserved |
| Post (public surfaces) | renderer returns 451 / generic stub per R71 §3.8 |
| Post (out of scope at MVP) | on-chain `custody_state` + `legal_state` are NOT mutated; the deed remains in `custody=sealed/unsealed + legal=legit` on Solana |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image in `live` or `sold`; moderator records with reason | `recordTakedown(...)` | `status='taken_down'`; reason set; public page returns 451 |
| AC-02 | already taken-down image | `recordTakedown(...)` | no-op; original reason preserved |
| AC-03 | nonexistent `image_id` | `recordTakedown(...)` | `IMAGE_NOT_FOUND` |
| AC-04 | empty reason | `recordTakedown(...)` | `TAKEDOWN_REASON_REQUIRED` |
| AC-05 | non-moderator caller | request hits admin route | `ROLE_REQUIRED` (auth upstream) |

## 2. Functional Requirements

### 2.1 Report Intake (No Operational Module at MVP)
Public Report on every public image page is a `mailto:abuse@epimage.com?subject=Report%20<image-id>` link (R71 §3.4 routing notes; §2.7). Reports land in the founder's mailbox; no in-app submission endpoint, no `report_tickets` table.

### 2.2 Moderator Admin Tool
Moderator-only admin surface invokes `recordTakedown`, setting `images.status = 'taken_down'` with `images.takedown_reason`. Applies to both `live` (pre-sale) and `sold` (post-mint) images per R71 §3.8 state machine.

### 2.2.1 Encrypted-Master Store Side-Effect
On a successful takedown, `recordTakedown` calls `encryptedMasterStore.delete(image_id)` ([registry/arweave_master.md §2.7](../registry/arweave_master.md)). Pre-sale images had ciphertext in the store from Card 1; sold images were already cleaned up by the `arweave_ready_sweeper` post-Arweave-ready. Either way, retaining bytes for content the platform will not serve is operationally unwise (CSAM/DMCA cases especially). Best-effort: delete failures are logged inside the store helper, never thrown -- the takedown itself always succeeds.

### 2.3 Free-Text Reason at MVP
`images.takedown_reason` is free text (DMCA, RoP, ToS-violation, etc.). R62's structured per-regime taxonomy (§4.9) is deferred. The moderator records the rationale verbatim.

### 2.4 Public Surface Behavior
Post-takedown, the public image page renderer returns 451 with the listing suppressed (R71 §3.8); the OG / Twitter Card metadata renders generic Gallery branding. The render layer (gallery service) consumes `images.status` to gate.

### 2.5 No On-Chain Mutation at MVP
The deed remains valid on Solana after takedown. `deed_state` mutation to `disputed` / `void` / `burned` requires the 3-of-5 multi-sig authority per INV-06 (R62 §3.5.1), deferred to MMP. MVP takedown is platform-side only.

### 2.6 Tier 0 Path Handled Elsewhere
CSAM-driven takedown at moderator-review time (Tier 0) flows through moderation (sets `images.status = 'taken_down'` with `takedown_reason = 'tier0_violation_ncmec_reported'`). The Report-driven post-publication path is the other surface; both write to the same column.

## 3. Architecture

Single column drives both intake paths. `images.status` and `images.takedown_reason` are the only persistent state. Whether the takedown originated from a moderator processing a `mailto:abuse@` report, a Tier-0 CSAM hit during pre-publication moderation, or a future structured intake endpoint, the result is the same: `status='taken_down'` + free-text reason. Downstream consumers (public render gate, encrypted-master cleanup, audit log) read only this column, so adding new intake paths is purely an UPSTREAM concern.

Free-text reason at MVP, structured taxonomy deferred. R62 §4.9 prescribes a per-regime enum (DMCA / RoP / ToS / CSAM / court-order / etc.), but MVP records the moderator's free-text rationale verbatim. This trades downstream analytics for shipping speed; the column already accepts both shapes. Migrating to a structured enum is mechanical (read existing rows, classify, backfill) and lands when the PM-09 audit-metadata work begins.

Side-effect on cleanup, not on render. The expensive side-effect is `encryptedMasterStore.delete(image_id)` -- removing the platform's local ciphertext copy so retained bytes don't outlast the takedown decision. Pre-sale images have ciphertext in the store from Card 1; sold images were already swept post-Arweave-ready, so the delete is a no-op. Failure is logged but never thrown -- the takedown record itself always succeeds. Arweave bytes are out of platform control by design and survive the takedown; the public-render gate (status='taken_down' → 451) is what makes the image inaccessible via platform channels.

No on-chain mutation at MVP. The cNFT deed leaf remains exactly as minted. Per INV-06, deed `legal_state` transitions (`legit → disputed → void`) require the 3-of-5 procedural multi-sig (PM-03 in deed.md), and deferred-to-burn (`custody_state → burned`) requires the destruction sweeper (PM-10). Both are deferred to MMP. MVP takedown is platform-state only -- the deed still verifies trustlessly off-chain, but the platform refuses to serve the image. This is intentional: takedown decisions made before the multi-sig governance is operational must not be irreversible on-chain.

Two intake surfaces share the admin tool. The Tier-0 CSAM path flows through the `moderation` subsystem (which calls `recordTakedown` with a fixed reason) at pre-publication review time. The third-party Report path flows through `mailto:abuse@` → moderator inbox → admin-tool entry. Both surfaces share the same admin tool implementation (`recordTakedown` function), differing only in caller context. This keeps the on-platform takedown machinery single-source-of-truth regardless of how the decision was reached.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Idempotency | re-takedown is a no-op; original reason preserved |
| Audit | mutation logged via Pino (R71 §3.6 mutation-logging middleware) |
| Latency | manual / admin-driven; not a hot path |
| Public-surface propagation | CDN purge for the public image page on takedown; <= 60s convergence |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `images` table (Prisma) | `status` and `takedown_reason` updates |
| identity | moderator-role enforcement |
| gallery service (render layer) | consumes `images.status` to serve 451 / suppress |
| email subsystem | optional creator notification on takedown -- post-MVP |
| Pino mutation middleware | audit trail |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Report-volume monitoring: a noisy mailbox at scale needs a triage queue. At MVP, founder mailbox is sufficient |
| OI-02 | Counter-notice / appeals flow: R62 §4.9 specifies DMCA counter-notice, RoP appeals, Take It Down Act response. All deferred at MVP; founder handles ad-hoc |
| OI-03 | Outbound infringement response (DMCA dispatch to third-party hosts per R62 §2.1): deferred entirely; out of MVP scope |
| OI-04 | Buyer-refund on takedown of sold image: R62 §4.9 specifies refunds on `void` adjudication. At MVP the deed stays valid on-chain; refund policy undecided |
| OI-05 | Structured `takedown_reason` taxonomy (DMCA / RoP / ToS / CSAM / NCII / etc.) vs current free-text: defer to MMP unless founder review volume forces earlier |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| moderation | Tier 0 pre-publication takedown path (writes the same `images.status` / `takedown_reason`) |
| identity | moderator-role enforcement |
| R71 §2.7 | public Report mailto link |
| R71 §3.4 routing notes | site-wide footer report link |
| R71 §3.6 `images.takedown_reason` | data model |
| R71 §3.8 image lifecycle | `live` / `sold` -> `taken_down` transitions |
| R62 §4.9 | full takedown architecture (per-regime dispatch, refunds, multi-sig) -- MMP |
| Constitution INV-06 | 3-of-5 multi-sig for `deed_state` mutation -- MMP |
| Constitution INV-08 | C2PA append-only -- N/A at MVP (no manifests) |

---
*Last Updated: 26/06/12 18:00*
