# Image Uniqueness Gate

Two-tier gate (pHash + DINOv2) at Card 1 ingestion. Restored to MVP per [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md). Tier 1 (pHash) is active and produces the perceptual hash that gets persisted to `images.phash` and embedded in the deed `variant_hashes["M+00"].phash` at Card 5. Tier 2 (DINOv2 + vector store) ships as stubs at MVP; cross-creator §7.1.7 review handoff is contract-only until the real vector store and review module are wired.

## 1. Interface

### 1.1 Inputs

#### file

#### upload_id

#### creator_id

### 1.2 Outputs

#### Pass

| Field | Type | Notes |
|---|---|---|
| ok | bool | true |
| phash | string | 64-bit hex |
| dino_vector_id | string | reference to stored embedding |
| per_creator_nearest | object or null | {master_id, distance} for nearest within creator, if any |
| platform_wide_nearest | object or null | {master_id, creator_id, distance} for nearest platform-wide, if any |

#### Reject (per-creator)

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | CREATOR_DUPLICATE |
| conflicting_master_id | string | from same creator |
| distance | float | sub-threshold distance |

#### Gate (platform-wide)

| Field | Type | Notes |
|---|---|---|
| ok | bool | false |
| error_code | enum | CROSS_CREATOR_DUPLICATE_REVIEW |
| conflicting_master_id | string | |
| conflicting_creator_id | string | |
| review_ticket_id | string | §7.1.7 Provenance and Rights Verification handoff |

### 1.3 Error Codes

| Code | Trigger |
|---|---|
| CREATOR_DUPLICATE | per-creator threshold hit |
| CROSS_CREATOR_DUPLICATE_REVIEW | platform-wide threshold hit; gate to §7.1.7 |
| UNIQUENESS_BACKEND_UNAVAILABLE | vector store unavailable; fail-closed |

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Pre | file passed drm_csam, drm_aicsam, drm_ncii, drm_adult |
| Post (pass) | phash + DINOv2 vector persisted, keyed by future master_id (not yet minted) |
| Post (reject) | upload terminated; vector not persisted |
| Post (gate) | review_ticket_id created; vector held pending §7.1.7 decision |
| Post (always) | per-creator and platform-wide nearest distances logged |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | unique image | gate runs | ok=true; vector persisted |
| AC-02 | near-duplicate of creator's own prior Master (Hamming < 10, DINOv2 similarity above threshold) | gate runs | error_code=CREATOR_DUPLICATE; conflicting_master_id surfaced |
| AC-03 | near-duplicate of another creator's Master | gate runs | error_code=CROSS_CREATOR_DUPLICATE_REVIEW; review_ticket_id issued |
| AC-04 | vector store unreachable | gate runs | error_code=UNIQUENESS_BACKEND_UNAVAILABLE |

## 2. Functional Requirements

### 2.1 Tier 1: Perceptual Hash (active at MVP)
Compute 64-bit pHash via `sharp-phash` v3 (Zauner 2010, DCT-of-luminance: 32×32 luminance grid, 2D DCT, low-frequency 8×8 block, median-thresholded). Visually similar images produce similar hashes regardless of compression, scaling, or minor color shifts. Hamming distance < 10 indicates high similarity. Algorithm choice pinned in [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md) so deed verifiers can re-implement without owning the codebase. **The phash computed here is the value persisted to `images.phash` and embedded in the deed at Card 5** -- single source of truth, no recomputation.

### 2.2 Tier 2: Neural Embedding (deferred to MMP; stubbed at MVP)
Compute DINOv2 dense feature vector (Oquab et al. 2024, Meta AI; ViT trained on 142M curated images). Captures compositional / stylistic similarity that pHash misses. **At MVP, the `DinoV2Embedder` adapter returns a zero vector** (`stubDinoV2Embedder`); platform-wide queries return `null`; cross-creator review handoff is contract-only. Activates at MMP when the real embedder + vector store are wired -- no API change required.

### 2.3 Storage
Per-Master pHash and DINOv2 vectors are stored at mint completion. Vector store is queried at every new ingestion.

### 2.4 Two-Level Comparison

| Level | Threshold | Action on hit |
|---|---|---|
| Per-creator | Calibrated to allow stylistic consistency across creator's body of work | Reject (CREATOR_DUPLICATE); feedback identifies the conflicting Master |
| Platform-wide | Stricter; intended to detect cross-creator duplication | Gate to §7.1.7 Provenance and Rights Verification (downstream module, not MVP) |

### 2.5 Reverse-Image Pre-Check (handoff)
The pHash from §2.1 is also surfaced to drm_authenticity §2.5 for reverse-image pre-check against public image indices. Computation is shared; second-tier downstream routing is the authenticity module's concern.

### 2.6 Adversarial Manipulation Penalties
Repeated attempts to circumvent uniqueness via adversarial perturbation -> graduated penalties (warn -> temporary suspension -> permanent removal).

## 3. Architecture

Two-tier detector composition. Tier 1 (perceptual hash) is fast, deterministic, and pinned in [ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md) so off-platform verifiers can re-implement. Tier 2 (DINOv2 neural embedding) catches stylistic / compositional similarity that pHash misses but requires a vector store and GPU-resident embedder. Tier 1 is active at MVP; Tier 2 ships at MMP with the adapter interface (`DinoV2Embedder`) already in place returning zero-vectors so platform-wide query paths stay wired. Activation flips one adapter binding -- no API change.

Single-compute, multi-consumer pHash. The 64-bit pHash computed at ingestion is the canonical value: written to `images.phash`, embedded in the deed metadata JSON at Card 5, surfaced to `drm_authenticity` §2.5 for reverse-image pre-check, and reused by the uniqueness comparator. No subsystem recomputes it. This collapses both the determinism surface (one algorithm, one input → one output) and the latency budget (one ~100ms compute amortized across four downstream uses).

Two-level comparison axis. Each new ingestion's pHash is queried against (a) the candidate creator's own prior Masters with a relaxed threshold (allowing stylistic consistency across a body of work), and (b) the platform-wide pHash index with a stricter threshold (cross-creator duplication detection). Per-creator hits reject outright with `CREATOR_DUPLICATE`. Platform-wide hits route to the downstream Provenance and Rights Verification module (deferred MVP; the contract is present, the queue handler is a stub). Thresholds are configuration, not code -- tuning happens post-launch on observed false-positive rates.

Storage is column-resident, not table-resident at MVP. `images.phash` (16-char hex) is queried via SQLite SELECT scans at MVP scale (<100k rows; full scan <50ms). At MMP the column promotes to a dedicated index table (`phash_index` with bk-tree or similar Hamming-distance structure) when scan latency exceeds budget. The DINOv2 vector store is a separate concern (Qdrant or pgvector candidate; not selected at MVP because the embedder is stubbed).

Adversarial-manipulation surface is administrative, not algorithmic. The detector does not attempt to be robust against deliberate perturbation attacks (small targeted noise additions designed to escape pHash distance bounds). Instead, repeated submission attempts from the same creator account that trip uniqueness gates trigger graduated penalties (warn → temporary suspension → permanent removal) handled by the moderation subsystem. The detector's role is correctness on honest inputs; abuse handling is the moderation subsystem's role.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| pHash compute latency | <= 100 ms p95 |
| DINOv2 embedding latency | <= 800 ms p95 |
| Per-creator vector-store query | <= 50 ms p95 |
| Platform-wide vector-store query | <= 200 ms p95 |
| Determinism | pHash deterministic; DINOv2 deterministic within model_version |
| Storage | pHash 8 bytes per Master; DINOv2 768- or 1024-dim float vector |

## 5. Dependencies

| Dependency | Role | MVP status |
|---|---|---|
| `sharp` + `sharp-phash` v3 | 64-bit DCT pHash computation | **active** (pinned by ADR-0005) |
| `images` table (Prisma) | `phash` write at Card 1; read-through by `arweave_master` at Card 5 | **active** |
| DINOv2 (Meta AI) model | Tier 2 embedding generation | stubbed (zero vector) |
| Vector store (pgvector / Qdrant) | per-creator + platform-wide ANN queries | stubbed (returns null) |
| `RightsReviewQueue` (§7.1.7) | cross-creator review handoff | stubbed (returns `stub-rights-review`) |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | Per-creator threshold calibration: balance stylistic consistency vs duplicate detection |
| OI-02 | Platform-wide threshold value: ROC curve target |
| OI-03 | DINOv2 model_version bump: vector reindex policy |
| OI-04 | Server-side pHash check independent re-run vs trust client-side batch result (server is authoritative per image_spec §3.3) |
| OI-05 | Vector-store backend choice (pgvector vs dedicated ANN service) |
| OI-06 | §7.1.7 manual-review module scope: not MVP; gate hand-off contract still required |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| **[ADR-0005](../adr/adr_0005_phash_in_deed_and_uniqueness_gate.md)** | Restores this gate + phash-in-deed to MVP per R62 §4.3 / §7.1.2 |
| [cert/image_spec.md](image_spec.md) | predecessor: format / dimensions / quality gates run before uniqueness |
| [cert/moderation.md](moderation.md) | successor: runs after uniqueness gate passes |
| [registry/arweave_master.md](../registry/arweave_master.md) | downstream Card 5 consumer: reads `images.phash` for deed anchoring |
| [registry/deed.md](../registry/deed.md) | embeds `phash` in deed `variant_hashes["M+00"]` via cnft_dispatch |
| [workflows/certify_wsd.md](../workflows/certify_wsd.md) | calling workflow (Card 1) |
| R62 §4.3 | Firm deed-content fields (sha256 + phash dual anchors) |
| R62 §7.1.2 / §7.1.7 | reference architecture: uniqueness gate + cross-creator review |
| Constitution INV-03 | determinism |

---
*Last Updated: 26/06/12 18:00*
