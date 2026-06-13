# Moderation (Manual Two-Checkbox Review at MVP)

MVP content-moderation gate. The moderator (founder at MVP) submits a two-checkbox decision against a `pending_review` image; the decision drives the `images.status` transition, side-effects (staging purge / preserve, account suspend, NCMEC handoff, creator notify), and the `image_reviews` audit row. The module is named for the role, not the current incumbent: MMP delegation is a route-layer authorization change, not a rename. Supersedes the automated PhotoDNA (drm_csam) and Hive (drm_adult) gates, which are deferred to MMP. Tier 2 (AI authenticity, RoP, sole-copy) is carried by the creator ESIGN warranty, not this gate.

## 1. Interface

### 1.1 Inputs

#### image_id
5-char base-36 image handle. Must reference an `images` row in `pending_review` (R71 §3.8).

#### reviewer_id
Moderator `users.user_id` (founder at MVP). Authorization gate enforced upstream by the admin route (R71 §3.7 row 6b).

#### creator_id
`users.user_id` of the image's creator (notification + suspension target).

#### checks
Two-checkbox payload:

| Field | Type | Meaning (R71 §2.2 step 5) |
|---|---|---|
| tier0_clean | bool | No CSAM, no NCII |
| tier1_clean | bool | No adult / NSFW, no violence-against-persons, no hate symbols, no drug promotion |

The unchecked box IS the rejection reason; no free-text field is collected.

### 1.2 Outputs

#### Approve

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| decision | enum | "approved" |
| image_review_id | UUID | `image_reviews.id` (R71 §3.6) |

#### Reject

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| decision | enum | "rejected_tier1" or "rejected_tier0" |
| error_code | enum | one of §1.3 |
| image_review_id | UUID | |
| ncmec_ticket_id | string or null | present iff decision = "rejected_tier0" |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| REVIEW_TIER1_VIOLATION | tier1_clean = false AND tier0_clean = true |
| REVIEW_TIER0_VIOLATION | tier0_clean = false (regardless of tier1_clean) |

Fixed taxonomy per R71 §3.7 "Error conventions". Adding a code is a contract change.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | `images.status = 'pending_review'` |
| Pre | reviewer authenticated as moderator (founder at MVP) |
| Post (approve) | `images.status = 'draft'`; `image_reviews` row inserted; creator emailed resume-listing link |
| Post (reject_tier1) | `images.status = 'taken_down'`; `images.takedown_reason = 'tier1_violation'`; staging upload deleted; `image_reviews` row inserted; creator emailed Tier 1 rejection |
| Post (reject_tier0) | `images.status = 'taken_down'`; `images.takedown_reason = 'tier0_violation_ncmec_reported'`; staging hash + metadata PRESERVED (90-day minimum for §2258A); `users.status = 'suspended'` for creator; `image_reviews` row inserted with `ncmec_report_filed_at` stamped on NCMEC submission |
| Post (always) | mutation logged via Prisma middleware (R71 §3.6) |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | image in `pending_review`; checks = {tier0:true, tier1:true} | moderator submits | decision = "approved"; status → `draft`; creator notified |
| AC-02 | image in `pending_review`; checks = {tier0:true, tier1:false} | moderator submits | error_code = REVIEW_TIER1_VIOLATION; status → `taken_down` (tier1_violation); staging purged; creator notified |
| AC-03 | image in `pending_review`; checks = {tier0:false, tier1:true} | moderator submits | error_code = REVIEW_TIER0_VIOLATION; status → `taken_down` (tier0_violation_ncmec_reported); staging preserved; creator suspended; NCMEC checklist opens |
| AC-04 | image in `pending_review`; checks = {tier0:false, tier1:false} | moderator submits | Tier 0 precedence applies: same as AC-03 |
| AC-05 | image NOT in `pending_review` | moderator submits | precondition rejected upstream by admin route; no `image_reviews` row written |
| AC-06 | NCMEC handoff fails after Tier 0 decision | moderator submits | `image_reviews` row + status transition + suspension already committed; NCMEC ticket retried; `ncmec_report_filed_at` stamped on success |

## 2. Functional Requirements

### 2.1 Two-Checkbox Decision
The `checks` payload is the sole input to the decision; the decision function is pure on `(tier0_clean, tier1_clean)`:

| tier0_clean | tier1_clean | Decision |
|---|---|---|
| true | true | approved |
| true | false | rejected_tier1 |
| false | * | rejected_tier0 |

### 2.2 Tier-0 Precedence
An unchecked Tier 0 always produces `rejected_tier0` regardless of Tier 1, because the Tier 0 side-effect chain (account suspension + NCMEC report + staging preservation) is the most severe and supersedes the Tier 1 path. A combined violation is reported as Tier 0 in the audit row; both checkbox states are preserved verbatim in `image_reviews.checks` for forensic reconstruction.

### 2.3 Side-Effect Sequence

**On `approved`:**
| Step | Action |
|---|---|
| 1 | `image_reviews` row insert (decision = approved; checks JSON) |
| 2 | `images.status = 'draft'` |
| 3 | Creator email: approval + resume-listing link |

**On `rejected_tier1`:**
| Step | Action |
|---|---|
| 1 | `image_reviews` row insert (decision = rejected_tier1) |
| 2 | `images.status = 'taken_down'`; `takedown_reason = 'tier1_violation'` |
| 3 | Staging upload deleted (storage subsystem) |
| 4 | Creator email: parametric Tier 1 rejection |

**On `rejected_tier0`:**
| Step | Action |
|---|---|
| 1 | `image_reviews` row insert (decision = rejected_tier0) |
| 2 | `images.status = 'taken_down'`; `takedown_reason = 'tier0_violation_ncmec_reported'` |
| 3 | `users.status = 'suspended'` for creator (identity subsystem) |
| 4 | Staging NOT purged: hash + metadata preserved 90-day minimum for §2258A |
| 5 | NCMEC CyberTipline checklist opens to moderator; on submission, `image_reviews.ncmec_report_filed_at` stamped |

### 2.4 Tier-2 Coverage Note
AI authenticity, right-of-publicity, and sole-copy obligations are carried by the creator ESIGN Image Signing Affirmation at upload + CMA at onboarding per R71 §2.2 step 6. They are NOT enforced by this gate -- a contractual warranty, not an operational check.

### 2.5 Idempotency
Re-submission against an `images` row already past `pending_review` is rejected upstream (precondition fails). The gate itself does not deduplicate; each successful invocation writes a new `image_reviews` row. The schema (R71 §3.6 -- `image_reviews.image_id` is NOT unique) supports forward-compat re-review on resubmission; activation policy is OI-02.

## 3. Architecture

### 3.1 Surface
Moderator-only admin route at `POST /v1/admin/reviews/:imageId` (R71 §3.7 row 6b), reachable from the queue at `GET /v1/admin/reviews` (R71 §3.7 row 6a). The route is the only caller of `submitModeration`; the entry point itself is transport-agnostic. The moderator role is held by the founder at MVP; MMP delegation (see OI-05) extends the role to additional `users` rows without changing this module.

### 3.2 Atomicity
Step 1 (`image_reviews` row insert) and step 2 (`images.status` transition) occur in a single Prisma transaction. Steps 3+ (staging purge, account suspend, NCMEC open, email) are post-commit side effects: a partial failure leaves the audit row + status transition committed and the residual subsystem call is retried out-of-band. The NCMEC ticket id is stamped on completion (step 5 of the Tier 0 path), so an in-flight or failed NCMEC handoff is observable by `image_reviews.ncmec_report_filed_at IS NULL`.

### 3.3 Subsystem Calls (No DI at MVP)
The entry point takes only `ModerationInput`. Calls to the DB, storage, identity, email, and NCMEC subsystems live inline in the function body as `// TODO` comments until those subsystems exist. The decision branch logic on `input.checks` is the load-bearing testable surface today; per-subsystem dependency-injection abstraction is deferred until a real second implementation needs to coexist with the first. The §5 Dependencies table enumerates the subsystem operations the future wiring will perform.

### 3.4 Determinism
The gate is structurally deterministic on `(tier0_clean, tier1_clean)`. Human variability lives upstream of the input (the moderator's perceptual judgment); the gate's decision function and side-effect sequence are total and replay-equivalent given the same inputs. INV-03's ML-determinism clause does not apply (no classifier).

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Determinism | gate is pure on `(tier0_clean, tier1_clean)`; same inputs → same decision + same side-effect sequence |
| Atomicity | image_reviews insert + images.status transition in one DB transaction (§3.2) |
| Audit | every invocation produces an `image_reviews` row and a Pino `db.mutation` log line (R71 §3.6 mutation-logging middleware); the unchecked box IS the rejection reason -- no free-text |
| Authorization | moderator role enforced by the admin route; gate fails closed if `reviewer_id` is not authorized as a moderator (upstream check) |
| NCMEC SLA | 24h operational target; 64-day statutory ceiling per §2258A; tracking via `image_reviews.ncmec_report_filed_at` |
| Latency | Manual; not a hot path. Decision-submit round-trip <= 1 s p95 (DB + side-effect dispatch only; NCMEC handoff is out-of-band) |
| Privacy | Tier 0 path retains the staging hash + metadata; no other Tier 0 file content leaves the platform except via the NCMEC submission |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `image_reviews` table (Prisma) | audit row insert + `ncmec_report_filed_at` stamp |
| `images` table (Prisma) | `status` and `takedown_reason` updates |
| `users` table (Prisma) | creator account suspension (Tier 0) |
| Storage subsystem | staging upload purge (Tier 1) |
| Email subsystem | creator notification (approve, Tier 1) |
| NCMEC CyberTipline checklist UI | Tier 0 report submission handoff (moderator-driven) |
| Pino mutation-logging middleware | audit trail via stdout to Render log aggregation (R71 §3.6) |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Appeals path for Tier 1 false-positives (art-context nudity, classical reproductions, medical imagery); operational owner + SLA |
| OI-02 | Re-review policy: does a Tier 1 rejection permit creator resubmission of the same image with appended evidence, or is `taken_down` terminal? Schema permits, policy undecided |
| OI-03 | Moderator review-queue SLA -- R71 surfaces "typically <24h" to the creator but does not pin it; operational target needs to be confirmed against creator-NPS impact |
| OI-04 | NCMEC ticket-id capture: moderator pastes back after submitting on the NCMEC portal, or scraped via NCMEC API when one is available; current spec assumes the manual paste-back path |
| OI-05 | Multi-moderator / delegation at MMP -- schema permits (`reviewer_id` FK is open to any `users` row), but the moderator-only restriction is currently enforced at the route layer; need a Trust & Safety role on `users` when delegation extends beyond the founder |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| drm | parent subsystem |
| image_spec | upstream gate (the only other active MVP DRM module); a `pending_review` image has already cleared this |
| image_report | upstream surface for THIRD-PARTY reports on already-published images; this module reviews `image_reports` rows alongside the initial pending_review queue |
| /docs/deferred/drm_csam.md | MMP successor for automated Tier 0 CSAM (PhotoDNA) |
| /docs/deferred/drm_adult.md | MMP successor for automated Tier 1 (Hive) |
| /docs/deferred/drm_ncii.md | MMP successor for automated Tier 0 NCII |
| R71 §2.2 step 5 | MVP workflow spec (two-checkbox founder/moderator review) |
| R71 §3.6 `image_reviews` | data model |
| R71 §3.7 rows 6a / 6b | admin queue + decision endpoints |
| R71 §3.8 image lifecycle | `pending_review` -> `draft` / `taken_down` state machine |
| Constitution INV-09 | server-side gates may call vetted external APIs (NCMEC handoff permitted) |

---
*Last Updated: 26/05/27 17:00*
