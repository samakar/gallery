// image_uniqueness.ts
// Content uniqueness gate (pHash + DINOv2 two-tier). Restored to MVP per
// ADR-0005 (was previously deferred).
// Spec: /docs/cert/image_uniqueness.md
// MVP wiring: Tier 1 (pHash, sharp-phash v3, 64-bit DCT) is active and
//   produces the value persisted to images.phash + embedded in deed
//   variant_hashes["M+00"].phash.
// MVP-deferred: Tier 2 (DINOv2 + vector store) ships as stubs; cross-creator
//   §7.1.7 review handoff is contract-only at MVP.
// Per-creator hit -> CREATOR_DUPLICATE reject.
// Cross-creator hit at platform-wide threshold -> gate to §7.1.7 Provenance
// and Rights Verification (handoff queue; activates at MMP).

import { createHash } from "node:crypto";
import phashImpl from "sharp-phash";
import { prisma } from "../db";

// -------------------------------------------------------------------
// Public output types (contract)
// -------------------------------------------------------------------

export type UniquenessErrorCode =
    | "CREATOR_DUPLICATE"
    | "CROSS_CREATOR_DUPLICATE_REVIEW"
    | "UNIQUENESS_BACKEND_UNAVAILABLE";

export interface CreatorNearest {
    master_id: string;
    distance: number;
}

export interface PlatformNearest {
    master_id: string;
    creator_id: string;
    distance: number;
}

export interface UniquenessPass {
    ok: true;
    phash: string;                          // 64-bit hex (16 chars)
    dino_vector_id: string;
    per_creator_nearest: CreatorNearest | null;
    platform_wide_nearest: PlatformNearest | null;
}

export interface UniquenessCreatorReject {
    ok: false;
    error_code: "CREATOR_DUPLICATE";
    conflicting_master_id: string;
    distance: number;
}

export interface UniquenessCrossReviewGate {
    ok: false;
    error_code: "CROSS_CREATOR_DUPLICATE_REVIEW";
    conflicting_master_id: string;
    conflicting_creator_id: string;
    review_ticket_id: string;
}

export interface UniquenessUnavailableReject {
    ok: false;
    error_code: "UNIQUENESS_BACKEND_UNAVAILABLE";
}

export type UniquenessResult =
    | UniquenessPass
    | UniquenessCreatorReject
    | UniquenessCrossReviewGate
    | UniquenessUnavailableReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface PHashComputer {
    // 64-bit pHash (Zauner 2010, DCT of luminance). Returns 16-char hex.
    // Throws on infra failure -> caller treats as backend unavailable.
    compute(bytes: Uint8Array): Promise<string>;
}

export interface DinoV2Embedder {
    // Dense feature vector from DINOv2 (Meta AI, ViT trained on 142M curated
    // images). Real ViT-L/14 produces 1024-dim float vectors.
    embed(bytes: Uint8Array): Promise<Float32Array>;
}

export interface UniquenessVectorStore {
    // Nearest match within the uploader's own minted Masters.
    queryPerCreator(
        creator_id: string,
        phash: string,
        dino: Float32Array
    ): Promise<NearestMatch | null>;

    // Nearest match across all creators EXCLUDING the uploader. Excluding
    // self prevents double-counting; per-creator query already covers that.
    queryPlatformWide(
        excluded_creator_id: string,
        phash: string,
        dino: Float32Array
    ): Promise<NearestPlatformMatch | null>;

    // Persist at gate-pass time, keyed by upload_id (rekeyed to master_id
    // at mint completion per drm_uniqueness §2.3).
    persist(args: PersistArgs): Promise<{ vector_id: string }>;
}

export interface NearestMatch {
    master_id: string;
    phash_hamming: number;       // [0, 64]
    dino_distance: number;       // 1 - cosine similarity, [0, 2]
}

export interface NearestPlatformMatch extends NearestMatch {
    creator_id: string;
}

export interface PersistArgs {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    phash: string;
    dino: Float32Array;
}

export interface RightsReviewQueue {
    // §7.1.7 Provenance and Rights Verification handoff. The §7.1.7 module is
    // forward-looking; this is the contract stub.
    enqueue(ctx: RightsReviewContext): Promise<{ review_ticket_id: string }>;
}

export interface RightsReviewContext {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    phash: string;
    conflicting_master_id: string;
    conflicting_creator_id: string;
    distance: number;
    enqueued_at: string;
}

export interface UniquenessAuditSink {
    record(event: UniquenessAuditEvent): void;
}

export interface UniquenessAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    phash: string | null;
    per_creator_nearest_distance: number | null;
    platform_wide_nearest_distance: number | null;
    error_code: UniquenessErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters
// -------------------------------------------------------------------

export const stubPHashComputer: PHashComputer = {
    async compute(bytes) {
        // Deterministic placeholder: first 16 hex chars of SHA-256.
        // TODO: replace with real DCT-based pHash (shared with client-side
        // batch pre-check from image_spec §3.1).
        return sha256Hex(bytes).slice(0, 16);
    },
};

export const stubDinoV2Embedder: DinoV2Embedder = {
    async embed(_bytes) {
        // TODO: replace with DINOv2 ViT-L/14 inference (1024-dim output).
        return new Float32Array(1024);
    },
};

export const stubUniquenessVectorStore: UniquenessVectorStore = {
    async queryPerCreator(_c, _p, _d) { return null; },
    async queryPlatformWide(_c, _p, _d) { return null; },
    async persist(_args) { return { vector_id: "stub-vector-id" }; },
};

export const stubRightsReviewQueue: RightsReviewQueue = {
    async enqueue(_ctx) { return { review_ticket_id: "stub-rights-review" }; },
};

export const stubUniquenessAuditSink: UniquenessAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// MVP real adapters (per ADR-0005)
// -------------------------------------------------------------------

// Real pHash via sharp-phash v3 (64-bit DCT). sharp-phash returns a 64-char
// binary string of '0'/'1'; we convert to 16-char hex for consistent storage
// and on-chain anchoring.
export const sharpPhashComputer: PHashComputer = {
    async compute(bytes) {
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        const binary = await phashImpl(buf);
        return binaryToHex(binary);
    },
};

// Per-creator Prisma-backed store. Tier 1 phash only -- queries `images.phash`
// for the creator and returns the nearest by Hamming distance. Tier 2
// platform-wide query is stubbed (returns null) per ADR-0005 MMP scope.
//
// persist() is a no-op: the phash is written by the route handler onto the
// `images` row at create time. We don't keep a separate vector store at MVP.
export const prismaPerCreatorStore: UniquenessVectorStore = {
    async queryPerCreator(creator_id, phash, _dino) {
        const rows = await prisma.image.findMany({
            where: { creator_id, phash: { not: null } },
            select: { image_id: true, phash: true },
        });
        let nearest: NearestMatch | null = null;
        for (const row of rows) {
            if (!row.phash) continue;
            const d = hammingHex(phash, row.phash);
            if (nearest === null || d < nearest.phash_hamming) {
                nearest = {
                    master_id: row.image_id,
                    phash_hamming: d,
                    // Tier 2 stubbed -> set 0 so the AND-gate in hitPerCreator
                    // falls back to phash-only at MVP. Activates with real
                    // values once DinoV2Embedder + vector store are wired.
                    dino_distance: 0,
                };
            }
        }
        return nearest;
    },
    async queryPlatformWide(_excluded, _phash, _dino) {
        return null;
    },
    async persist(_args) {
        return { vector_id: "image-row-phash" };
    },
};

function binaryToHex(binary: string): string {
    let hex = "";
    for (let i = 0; i < binary.length; i += 4) {
        hex += parseInt(binary.slice(i, i + 4), 2).toString(16);
    }
    return hex;
}

function hammingHex(a: string, b: string): number {
    let d = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
        d += popcount(x);
    }
    return d;
}

function popcount(n: number): number {
    let c = 0;
    while (n) { c += n & 1; n >>>= 1; }
    return c;
}

// -------------------------------------------------------------------
// Calibration
// -------------------------------------------------------------------

// drm_uniqueness OI-01 (per-creator threshold) + OI-02 (platform-wide
// threshold ROC). Both pairs must trip for a hit: pHash AND DINOv2 below
// their respective distance thresholds. Stubs ship placeholder values;
// calibrated per build and replay-tested.
//
// Per-creator threshold is intentionally TIGHT so a creator's stylistically
// similar pieces don't false-trip. Platform-wide threshold is LOOSER, since
// cross-creator near-duplicates warrant manual review even at moderate
// similarity.

const PER_CREATOR_PHASH_THRESHOLD = 6;     // Hamming distance
const PER_CREATOR_DINO_THRESHOLD = 0.10;   // 1 - cosine similarity

const PLATFORM_WIDE_PHASH_THRESHOLD = 10;
const PLATFORM_WIDE_DINO_THRESHOLD = 0.20;

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface UniquenessGateDeps {
    phash?: PHashComputer;
    dino?: DinoV2Embedder;
    store?: UniquenessVectorStore;
    rights_review?: RightsReviewQueue;
    audit?: UniquenessAuditSink;
}

export async function validateUniqueness(
    file: Uint8Array,
    upload_id: string,
    creator_id: string,
    deps: UniquenessGateDeps = {}
): Promise<UniquenessResult> {
    const phasher = deps.phash ?? stubPHashComputer;
    const dinoer = deps.dino ?? stubDinoV2Embedder;
    const store = deps.store ?? stubUniquenessVectorStore;
    const rights_review = deps.rights_review ?? stubRightsReviewQueue;
    const audit = deps.audit ?? stubUniquenessAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    // §2.1 + §2.2 Compute pHash and DINOv2 vector.
    let phash: string;
    let dino: Float32Array;
    try {
        [phash, dino] = await Promise.all([phasher.compute(file), dinoer.embed(file)]);
    } catch {
        audit.record({
            upload_id, creator_id, file_sha256,
            phash: null,
            per_creator_nearest_distance: null,
            platform_wide_nearest_distance: null,
            error_code: "UNIQUENESS_BACKEND_UNAVAILABLE",
            at,
        });
        return { ok: false, error_code: "UNIQUENESS_BACKEND_UNAVAILABLE" };
    }

    // §2.4 Parallel two-level vector-store query.
    let perCreator: NearestMatch | null;
    let platformWide: NearestPlatformMatch | null;
    try {
        [perCreator, platformWide] = await Promise.all([
            store.queryPerCreator(creator_id, phash, dino),
            store.queryPlatformWide(creator_id, phash, dino),
        ]);
    } catch {
        audit.record({
            upload_id, creator_id, file_sha256,
            phash,
            per_creator_nearest_distance: null,
            platform_wide_nearest_distance: null,
            error_code: "UNIQUENESS_BACKEND_UNAVAILABLE",
            at,
        });
        return { ok: false, error_code: "UNIQUENESS_BACKEND_UNAVAILABLE" };
    }

    // §2.4 Per-creator hit -> reject.
    if (perCreator !== null && hitPerCreator(perCreator)) {
        audit.record({
            upload_id, creator_id, file_sha256,
            phash,
            per_creator_nearest_distance: perCreator.phash_hamming,
            platform_wide_nearest_distance: platformWide?.phash_hamming ?? null,
            error_code: "CREATOR_DUPLICATE",
            at,
        });
        return {
            ok: false,
            error_code: "CREATOR_DUPLICATE",
            conflicting_master_id: perCreator.master_id,
            distance: perCreator.phash_hamming,
        };
    }

    // §2.4 Platform-wide hit -> gate to §7.1.7 (manual review).
    if (platformWide !== null && hitPlatformWide(platformWide)) {
        const { review_ticket_id } = await rights_review.enqueue({
            upload_id, creator_id, file_sha256,
            phash,
            conflicting_master_id: platformWide.master_id,
            conflicting_creator_id: platformWide.creator_id,
            distance: platformWide.phash_hamming,
            enqueued_at: at,
        });
        audit.record({
            upload_id, creator_id, file_sha256,
            phash,
            per_creator_nearest_distance: perCreator?.phash_hamming ?? null,
            platform_wide_nearest_distance: platformWide.phash_hamming,
            error_code: "CROSS_CREATOR_DUPLICATE_REVIEW",
            at,
        });
        return {
            ok: false,
            error_code: "CROSS_CREATOR_DUPLICATE_REVIEW",
            conflicting_master_id: platformWide.master_id,
            conflicting_creator_id: platformWide.creator_id,
            review_ticket_id,
        };
    }

    // Pass: persist vectors keyed by upload_id (rekeyed to master_id at mint).
    const { vector_id } = await store.persist({
        upload_id, creator_id, file_sha256, phash, dino,
    });

    audit.record({
        upload_id, creator_id, file_sha256,
        phash,
        per_creator_nearest_distance: perCreator?.phash_hamming ?? null,
        platform_wide_nearest_distance: platformWide?.phash_hamming ?? null,
        error_code: null,
        at,
    });

    return {
        ok: true,
        phash,
        dino_vector_id: vector_id,
        per_creator_nearest: perCreator !== null
            ? { master_id: perCreator.master_id, distance: perCreator.phash_hamming }
            : null,
        platform_wide_nearest: platformWide !== null
            ? {
                master_id: platformWide.master_id,
                creator_id: platformWide.creator_id,
                distance: platformWide.phash_hamming,
            }
            : null,
    };
}

// A hit requires BOTH pHash and DINOv2 to trip below their thresholds.
function hitPerCreator(m: NearestMatch): boolean {
    return m.phash_hamming <= PER_CREATOR_PHASH_THRESHOLD
        && m.dino_distance <= PER_CREATOR_DINO_THRESHOLD;
}

function hitPlatformWide(m: NearestPlatformMatch): boolean {
    return m.phash_hamming <= PLATFORM_WIDE_PHASH_THRESHOLD
        && m.dino_distance <= PLATFORM_WIDE_DINO_THRESHOLD;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
