# ADR-0005: phash in deed + image uniqueness gate restored to MVP

## Status
Accepted -- 2026-05-29.

## Context

R62 §4.3 (Deed-content field-state schema, line 493) lists perceptual hash as a **Firm** authentication field in the deed:

> | Authentication | Content hash (sha256), perceptual hash | Firm | Card 2 ingestion |

R62 §7.1.2 / §7.1.7 specify a content-uniqueness gate at Card 1 ingestion that produces this phash plus a DINOv2 neural embedding for cross-creator duplicate detection.

R71 (MVP spec) dropped both: phash is absent from the deed-metadata schema in [deed.md](../registry/deed.md), absent from the `images` table, and the uniqueness gate was wholesale-deferred to MMP. The R71 ingestion window keeps only format / dimensions / megapixels / aspect / quality gates from [image_spec.md](../cert/image_spec.md).

Two consequences of the drop:

1. **Deed verification gap.** sha256 (file-byte hash) on the deed can only confirm an exact-byte match. A re-saved JPEG of the same image produces a different sha256, so the deed cannot verify "this image is the asset" against any commonly-encountered variant. phash closes that gap by anchoring perceptual identity.
2. **Duplicate-upload surface.** Without the uniqueness gate, a creator can re-upload the same image and get two separate listings -- observed in MVP testing.

Bringing both back aligns MVP with R62 and closes both gaps with a single mechanism: the uniqueness gate computes phash at upload, persists it, and the deed embeds it at mint.

## Decision

**Image uniqueness gate is active at Card 1 ingestion; phash is embedded in the deed at Card 5 mint.** Five rules:

1. **Gate location.** [cert/image_uniqueness.ts](../cert/image_uniqueness.ts) runs server-side after the image_spec window gates pass and before the image row is persisted (i.e. between multer buffering and `prisma.image.create` in `POST /v1/images`). Spec: [cert/image_uniqueness.md](../cert/image_uniqueness.md).
2. **Algorithms.**
   - **phash**: 64-bit DCT perceptual hash via `sharp-phash` v3 (32×32 luminance DCT, low-frequency 8×8 block, median-thresholded). Hex-encoded, 16 chars. Algorithm choice pinned in this ADR so future verifiers can re-implement without owning the codebase.
   - **DINOv2** (Tier 2): deferred to MMP in code (stub adapter ships at MVP) -- the spec contract is honored, the neural-embedding implementation is not. Cross-creator manual-review (§7.1.7) is consequently also stubbed at MVP.
3. **Per-creator hard-reject only at MVP.** Tier 1 (phash, Hamming ≤ 6) blocks `CREATOR_DUPLICATE` re-uploads by the same creator -- the directly user-visible duplicate-upload symptom. Tier 2 (DINOv2 + platform-wide query) is wired through the contract but returns pass via stubs; cross-creator gating activates at MMP without an API break.
4. **Persistence.** New column `images.phash String?` populated at the uniqueness gate (Card 1). DINOv2 vector storage waits for the real vector store (pgvector / Qdrant) at MMP.
5. **Deed embedding.** [arweave_master](../registry/arweave_master.md) reads `images.phash` at Card 5 and surfaces it; [cnft_dispatch](../registry/deed.md) embeds it in deed metadata as `variant_hashes["M+00"].phash`. The phash that was computed at upload is the phash that goes on-chain -- single source of truth, no recomputation drift.

## Consequences

**Positive:**

- MVP deed matches R62 §4.3's Firm-authentication schema -- no more deed-spec divergence on this field
- Creator double-upload is hard-rejected at Card 1 (the actual reported symptom resolved)
- Deed verification works against modified copies (re-saves, format conversions) -- phash similarity is decidable in 10 years from the on-chain anchor alone
- Algorithm pinning (sharp-phash v3 / 64-bit DCT) means independent verifiers can re-implement without our code
- Cross-creator gate is contract-ready at MMP without API or schema changes -- only stubs swap
- Adds nothing to the deed's on-chain payload size beyond 16 hex chars

**Negative:**

- One new column (`images.phash`) and one schema migration
- New native dep (`sharp` + `sharp-phash`, ~30 MB) -- sharp is broadly useful (Share Copy variants, watermarking, future image ops) so the cost is amortized
- DINOv2 + vector store are spec'd but stubbed -- platform-wide gate inactive at MVP. The `CROSS_CREATOR_DUPLICATE_REVIEW` path exists structurally but never fires until adapters are real
- Algorithm-lock to sharp-phash v3 means a future library swap requires either re-anchoring deeds (impossible -- they're on-chain) or maintaining backward-compat verification code
- Per-creator threshold calibration (`PER_CREATOR_PHASH_THRESHOLD = 6`) is heuristic; false positives possible for creators with stylistically consistent series. OI-01 in image_uniqueness.md tracks this

## R71 reconciliation

| R71 | Status after ADR-0005 |
|---|---|
| §1.3 ingestion window (format / dimensions / megapixels / aspect / quality) | **Extends**: uniqueness gate (per-creator phash hard-reject) added as a sixth tier between image_spec and moderation |
| §3.6 `images` table | **Schema change**: `phash String?` column added; populated at Card 1 |
| §3.7 row 4 `POST /v1/images` | **Behavior change**: uniqueness gate runs after multer buffer + before `prisma.image.create`. Adds `CREATOR_DUPLICATE` to error responses |
| §3.7 row 22 deed metadata | **Schema change**: `variant_hashes["M+00"]` adds `phash` alongside `sha256` and `anchored_at` |
| §3.9 runImageOps step b (arweave_master) | **Behavior change**: reads and surfaces `images.phash`; does not recompute |
| Original "uniqueness deferred to MMP" decision | **Partially superseded**: per-creator Tier 1 active at MVP; Tier 2 + cross-creator review remain deferred |

## Affected files

| File | Change |
|---|---|
| `docs/cert/image_uniqueness.md` | Already authored; ADR confirms it as active MVP spec (was previously read as deferred) |
| `src/cert/image_uniqueness.ts` | Already authored as stubbed; header comment pointed at deferred path -- corrected to `/docs/cert/image_uniqueness.md` |
| `prisma/schema.prisma` | `Image.phash String?` column added |
| `docs/registry/arweave_master.md` | Outputs + post-conditions + §2.1 mention phash; deps add `images.phash` read |
| `docs/registry/deed.md` | Inputs + variant_hashes JSON example + cross-refs include phash |
| `docs/workflows/deed_wsd.md` | Step 1 side-effect mentions phash anchoring; step 4 input list adds phash |
| `src/app/api/server.ts` | (Pending implementation) -- `POST /v1/images` calls `validateUniqueness` after multer buffer, before image row create; rejects `CREATOR_DUPLICATE` with `409` |
| `src/registry/arweave_master.ts` | (Pending implementation) -- include `phash` read in the output payload to `cnft_dispatch` |
| `src/registry/cnft_dispatch.ts` | (Pending implementation) -- include `phash` in `variant_hashes["M+00"]` mint metadata |
| `package.json` | (Pending) add `sharp`, `sharp-phash` |

## Library choice rationale

`sharp-phash` over `imghash` (pure JS) or Cloudinary's built-in phash:

| Option | Why not picked |
|---|---|
| `imghash` (pure JS pHash) | ~200-500 ms per image vs sharp-phash's 5-20 ms; sharp is needed anyway for watermarks / variants |
| Cloudinary's `phash` resource flag | Algorithm undocumented; verifier in 10 years has no way to recompute without Cloudinary access; ties on-chain anchor to a vendor |

`sharp-phash` v3 implements the standard 64-bit DCT pHash (Zauner 2010) -- documented, re-implementable, deterministic across machines.

## Cross-references

| Doc | Purpose |
|---|---|
| [cert/image_uniqueness.md](../cert/image_uniqueness.md) | Owns the gate's interface + Tier 1/2 contract |
| [registry/arweave_master.md](../registry/arweave_master.md) | Reads `images.phash` at Card 5; updated by this ADR |
| [registry/deed.md](../registry/deed.md) | Embeds phash in deed; updated by this ADR |
| R62 §4.3 line 493 | Original deed-schema requirement that motivated this ADR |
| R62 §7.1.2 / §7.1.7 | Uniqueness gate + cross-creator review architecture |
| R71 §1.3, §3.6, §3.7, §3.8, §3.9 | Sections this ADR diverges from / extends |

---
*Last Updated: 26/06/10 15:00*
