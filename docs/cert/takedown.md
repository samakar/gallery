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

### 2.3 Free-Text Reason at MVP
`images.takedown_reason` is free text (DMCA, RoP, ToS-violation, etc.). R62's structured per-regime taxonomy (§4.9) is deferred. The moderator records the rationale verbatim.

### 2.4 Public Surface Behavior
Post-takedown, the public image page renderer returns 451 with the listing suppressed (R71 §3.8); the OG / Twitter Card metadata renders generic Gallery branding. The render layer (gallery service) consumes `images.status` to gate.

### 2.5 No On-Chain Mutation at MVP
The deed remains valid on Solana after takedown. `deed_state` mutation to `disputed` / `void` / `burned` requires the 3-of-5 multi-sig authority per INV-06 (R62 §3.5.1), deferred to MMP. MVP takedown is platform-side only.

### 2.6 Tier 0 Path Handled Elsewhere
CSAM-driven takedown at moderator-review time (Tier 0) flows through moderation (sets `images.status = 'taken_down'` with `takedown_reason = 'tier0_violation_ncmec_reported'`). The Report-driven post-publication path is the other surface; both write to the same column.

## 3. Non-Functional Requirements

| Property | Specification |
|---|---|
| Idempotency | re-takedown is a no-op; original reason preserved |
| Audit | mutation logged via Pino (R71 §3.6 mutation-logging middleware) |
| Latency | manual / admin-driven; not a hot path |
| Public-surface propagation | CDN purge for the public image page on takedown; <= 60s convergence |

## 4. Dependencies

| Dependency | Role |
|---|---|
| `images` table (Prisma) | `status` and `takedown_reason` updates |
| identity | moderator-role enforcement |
| gallery service (render layer) | consumes `images.status` to serve 451 / suppress |
| email subsystem | optional creator notification on takedown -- post-MVP |
| Pino mutation middleware | audit trail |

## 5. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Report-volume monitoring: a noisy mailbox at scale needs a triage queue. At MVP, founder mailbox is sufficient |
| OI-02 | Counter-notice / appeals flow: R62 §4.9 specifies DMCA counter-notice, RoP appeals, Take It Down Act response. All deferred at MVP; founder handles ad-hoc |
| OI-03 | Outbound infringement response (DMCA dispatch to third-party hosts per R62 §2.1): deferred entirely; out of MVP scope |
| OI-04 | Buyer-refund on takedown of sold image: R62 §4.9 specifies refunds on `void` adjudication. At MVP the deed stays valid on-chain; refund policy undecided |
| OI-05 | Structured `takedown_reason` taxonomy (DMCA / RoP / ToS / CSAM / NCII / etc.) vs current free-text: defer to MMP unless founder review volume forces earlier |

## 6. Cross-References

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
*Last Updated: 05/27/26 18:00*
