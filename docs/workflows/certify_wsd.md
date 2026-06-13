# Card 1: Certify (Workflow Sequence)

Per-asset workflow that gates a creator-uploaded image through the Certification function. Begins at file-select on the creator dashboard; ends when the Original is encrypted at rest and ready for the Card 2 Image Creation hand-off. Pre-Journey Identity Verification (creator onboarding per R71 §2.1) must have completed first. Authoritative MVP steps per R71 §2.2.

## 1. Preconditions

| Condition | Source |
|---|---|
| Creator role granted (`creators` row exists) | identity (creator_onboarding_wsd complete) -- implies authenticated user_id, CMA on file, and wallet provisioned (all set in the same flow per identity.md §2.6-2.8) |

## 2. Step Sequence

| # | Step | Surface | Subsystem call | Write / Side-effect | Failure |
|---|---|---|---|---|---|
| 1 | File select | Web App | (UI) | File handle held client-side | -- |
| 2 | Client-side image-spec check | Web App | image_spec.validateClientSide(file) | None (pre-upload) | INGESTION_* -> show failing parameter; no upload |
| 3 | Upload | `POST /v1/images` (multipart `file=`) | image_spec.validateServerSide(bytes) + image_uniqueness.validateUniqueness + `encryptMaster(buffer)` + `encryptedMasterStore.write(image_id, ciphertext)` + `uploadOriginal(image_id, buffer)` → Cloudinary (type:'private' per image_gen.md §2.10) | `images` row with `status='pending_review'`, `dek_wrapped`, `sha256`, `phash`, `width_px`/`height_px`; encrypted Master at `data/encrypted_masters/<image_id>.bin`; Cloudinary public_id=`<image_id>` (cleartext, signed-URL-gated) | INGESTION_* / CREATOR_DUPLICATE / CLOUDINARY_UPLOAD_FAILED / ENCRYPTED_MASTER_STORE_WRITE_FAILED -> 4xx/5xx; no row inserted |
| 4 | Image enters moderator review queue | (no call; `status='pending_review'` IS the queue) | -- | Visible at GET /v1/admin/reviews (R71 §3.7 row 6a) | -- |
| 5 | Moderator submits two-checkbox review | Web App (admin) at POST /v1/admin/reviews/:imageId (R71 §3.7 row 6b) | moderation.submitModeration({tier0_clean, tier1_clean}) | `image_reviews` row + `images.status` transition | REVIEW_TIER0_VIOLATION / REVIEW_TIER1_VIOLATION |
| 6 | (On approve) Creator notified | Email subsystem (TBD) | -- | Creator dashboard surfaces resume-listing link | -- |
| 7 | Creator ESIGN affirmation (ISA) -- **parallel to steps 4-5 per [ADR-0006](../adr/adr_0006_isa_decoupled_from_moderation.md)**: may execute any time after step 3, while `status ∈ {pending_review, draft}` | `POST /v1/images/:imageId/sign-affirmation` (R71 §3.7 row 7) | esign.captureSignature(ISA) | `signatures` row + `images.signing_event_id_authorship` stamped | ESIGN_DOCUMENT_REQUIRED if precondition fails; IMMUTABLE_STATUS if image is `live`/`sold`/`taken_down` |

**Card 2 Image Creation operations** -- per the architecture in image_gen.md §2.9 (Card-1 Encryption) + arweave_master.md §2.7 (EncryptedMasterStore), the Master encryption + FS persistence + Cloudinary cleartext upload all happen **inline at step 3** (`POST /v1/images`), NOT at a separate post-moderation Card 2 endpoint. Listing-preview / thumbnail / share-copy variants are Cloudinary URL transformations on the same `<image_id>` asset (not separate uploads) and are constructed lazily at render time via `buildListingPreviewUrl` / `buildThumbnailUrl` / `buildShareCopyUrl`.

**Ordering note (per [ADR-0006](../adr/adr_0006_isa_decoupled_from_moderation.md)):** step 7 ISA may execute in parallel with steps 4-5-6. The creator can sign the affirmation immediately after upload while moderation runs; the synchronization point is the Card 3 List endpoint (`POST /v1/images/:imageId/list`) which requires BOTH `status='draft'` (moderator-approved) AND `signing_event_id_authorship` non-null (ISA signed). Order between the two is not constrained.

## 3. State Transitions

`images.status` lifecycle within this workflow (R71 §3.8):

| From | To | Trigger |
|---|---|---|
| (none) | pending_review | step 3 -- server image_spec accepts |
| pending_review | draft | step 5 -- moderation approve |
| pending_review | taken_down | step 5 -- moderation reject (tier0 or tier1) |
| draft | live | Card 3 publish (out of this workflow) |

## 4. Failure Modes

| Step | Behavior |
|---|---|
| 2 (client gate) | Pure pre-upload reject; no DB / network state |
| 3 (server gate) | Image not persisted; no `images` row written |
| 5 (Tier 1 reject) | `images.status='taken_down'`, `takedown_reason='tier1_violation'`; staging purged; creator emailed |
| 5 (Tier 0 reject) | `images.status='taken_down'`, `takedown_reason='tier0_violation_ncmec_reported'`; creator account suspended; NCMEC subflow opens; staging PRESERVED 90-day min for §2258A |
| 7 (ESIGN fail) | `images` row stays in `draft`; creator can retry sign-affirmation |
| 3 (encryption / store write) | `ENCRYPTED_MASTER_STORE_WRITE_FAILED` -- Cloudinary asset already uploaded; orphan cleanup is a separate ops task. No `images` row inserted; creator retries upload. |
| 3 (Cloudinary upload) | `CLOUDINARY_UPLOAD_FAILED` -- no `images` row inserted; nothing persisted; creator retries upload. |

## 5. Subsystems Invoked

| Subsystem | Step |
|---|---|
| identity | precondition (DID + role + wallet + single-role + allowlist); upstream gate on every authed step |
| image_spec | steps 2 + 3 (client + server) |
| image_uniqueness | step 3 (tier-1 phash; tier-2 stubbed) |
| moderation | step 5 |
| esign | step 7 |
| cert/crypto.encryptMaster | step 3 (per-image DEK + AES-256-GCM ciphertext) |
| registry/arweave_master (EncryptedMasterStore) | step 3 (`encryptedMasterStore.write`; FS at MVP) |
| commerce/image_gen (uploadOriginal + URL builders) | step 3 (Cloudinary cleartext upload, type:'private', signed-URL gate per image_gen.md §2.10) |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Email notification after moderator approve (step 6): email subsystem not yet specified; mechanism is TBD |
| OI-02 | If image_spec server re-check rejects an already-passed client-side check (proxy tampering, file mutation in flight), discrepancy logging for fraud detection is not in MVP scope |
| OI-03 | Workflow scope boundary: R62 Card 1 ended at ESIGN with a separate Card 2 endpoint for encryption + variant builds. The shipped architecture (image_gen.md §2.9 + arweave_master.md §2.7) folds encryption + Cloudinary upload into step 3 (`POST /v1/images`). The "Card 2" surface is no longer a separate endpoint; this WSD covers the full pre-list lifecycle. |
| OI-04 | Step 6 → step 7 timing: per [ADR-0006](../adr/adr_0006_isa_decoupled_from_moderation.md) creator no longer has to come back specifically for ISA -- they may sign during the upload session while moderation runs. Stale `draft` images (metadata + ISA in, moderator approved, never published) still need a TTL policy at MMP |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| R71 §2.2 | Creator Upload and Listing (authoritative MVP spec) |
| R71 §3.7 rows 6, 6a, 6b, 7 | endpoint contracts for upload / review queue / review submit / sign-affirmation |
| R71 §3.8 image lifecycle | `status` state machine |
| R62 §3.1 Card 1 Certify | reference architecture for the Certify card |
| identity | session + role + allowlist precondition |
| image_spec | §1.3 ingestion-window gate (client + server) |
| moderation | two-checkbox review |
| esign | ISA capture |
| Constitution INV-2 | ESIGN precedes the entity it admits -- per [ADR-0006](../adr/adr_0006_isa_decoupled_from_moderation.md), "the entity ISA admits" is the deed mint at Card 5, not the moderator-approved status transition |
| **ADR-0006** | ISA decoupled from moderation -- step 7 is parallel to steps 4-5 |
| Constitution INV-9 | client-side gate is deterministic, no network; server gate may call vetted APIs (NCMEC handoff) |

---
*Last Updated: 26/06/10 18:30*
