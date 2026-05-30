// rop.ts
// Right-of-Publicity gate (server-side).
// Spec: /docs/deferred/drm_rop.md
// Day-1 hard requirement. Addresses NY Civil Rights Law §§50-51, California
// Civil Code §3344, and post-ELVIS-Act state regimes. Three resolution paths:
// model release, editorial-use exemption, creator-as-subject.
// BIPA / SB-1001: no facial-image bytes retained -- dependencies operate on
// hashed embeddings only.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Resolution evidence (input)
// -------------------------------------------------------------------

export type ResolutionPath =
    | "model_release"
    | "editorial_declaration"
    | "creator_as_subject";

export interface ModelReleaseEvidence {
    type: "model_release";
    document_hash: string;
    depicted_person_legal_name: string;
    dob: string;                       // ISO date
    signing_event_id: string;          // from esign subsystem
    scope_of_grant: string;
    governing_law: string;             // "DE" default; state code per depicted-person residency override
}

export interface EditorialDeclarationEvidence {
    type: "editorial_declaration";
    document_hash: string;
    event_basis: string;
    date: string;
    location: string;
    category: string;
}

export interface CreatorAsSubjectEvidence {
    type: "creator_as_subject";
    // No fields; resolution is computed from the creator identity chain.
}

export type ResolutionEvidence =
    | ModelReleaseEvidence
    | EditorialDeclarationEvidence
    | CreatorAsSubjectEvidence;

// -------------------------------------------------------------------
// Public output types (contract)
// -------------------------------------------------------------------

export type RopErrorCode =
    | "ROP_RESOLUTION_REQUIRED"
    | "ROP_RESOLUTION_INVALID"
    | "ROP_FACE_INDEX_UNAVAILABLE";

export interface DeedBinding {
    document_hash: string;
    on_chain_pointer: string;
}

export interface RopPass {
    ok: true;
    face_presence: boolean;
    public_figure_match: boolean;
    resolution_path: ResolutionPath | null;   // null iff face_presence === false
    deed_binding: DeedBinding | null;         // populated iff resolution_path requires it
}

export interface RopGate {
    ok: false;
    error_code: "ROP_RESOLUTION_REQUIRED";
    permitted_resolution_paths: ResolutionPath[];
}

export interface RopReject {
    ok: false;
    error_code: "ROP_RESOLUTION_INVALID" | "ROP_FACE_INDEX_UNAVAILABLE";
}

export type RopResult = RopPass | RopGate | RopReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface FacePresenceDetector {
    // Binary detection: is an identifiable person depicted?
    // Returns null on infra failure -> fail-closed.
    detect(bytes: Uint8Array): Promise<FacePresenceVerdict | null>;
}

export interface FacePresenceVerdict {
    face_presence: boolean;
    detector_version: string;
}

export interface PublicFigureIndex {
    // Face-embedding similarity against hashed public-figure index.
    // NO facial-image bytes stored (BIPA / SB-1001).
    // Returns null on infra failure -> fail-closed.
    query(bytes: Uint8Array): Promise<PublicFigureVerdict | null>;
}

export interface PublicFigureVerdict {
    matched: boolean;
    match_score: number;               // [0, 1]
    index_version: string;
}

export interface CreatorIdentityFaceMatch {
    // Match face against creator's three-layer identity chain (R62 §3.1).
    // Returns null on infra failure.
    match(bytes: Uint8Array, creator_id: string): Promise<CreatorMatchVerdict | null>;
}

export interface CreatorMatchVerdict {
    matched: boolean;
    confidence: number;                // above calibrated threshold -> matched
    chain_version: string;
}

export interface ModelReleaseValidator {
    // Verify scope, signature, and ESIGN signing-event linkage.
    validate(evidence: ModelReleaseEvidence): Promise<DocumentValidation>;
}

export interface EditorialDeclarationValidator {
    // Verify editorial-context declaration fields.
    validate(evidence: EditorialDeclarationEvidence): Promise<DocumentValidation>;
}

export interface DocumentValidation {
    valid: boolean;
    on_chain_pointer: string | null;   // populated iff valid
}

export interface RopAuditSink {
    record(event: RopAuditEvent): void;
}

export interface RopAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    face_presence: boolean | null;
    public_figure_match: boolean | null;
    match_score: number | null;
    resolution_path: ResolutionPath | null;
    error_code: RopErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters
// -------------------------------------------------------------------

export const stubFacePresenceDetector: FacePresenceDetector = {
    async detect(_bytes) {
        return { face_presence: false, detector_version: "stub-0.0.0" };
    },
};

export const stubPublicFigureIndex: PublicFigureIndex = {
    async query(_bytes) {
        // TODO: replace with PimEyes-class (or self-hosted) hashed-embedding lookup.
        return { matched: false, match_score: 0, index_version: "stub-0.0.0" };
    },
};

export const stubCreatorIdentityFaceMatch: CreatorIdentityFaceMatch = {
    async match(_bytes, _creator_id) {
        // TODO: wire against R62 §3.1 three-layer identity chain.
        return { matched: false, confidence: 0, chain_version: "stub-0.0.0" };
    },
};

export const stubModelReleaseValidator: ModelReleaseValidator = {
    async validate(_e) {
        // TODO: verify ESIGN signing-event + scope-of-grant sufficiency.
        return { valid: true, on_chain_pointer: "stub-onchain-release" };
    },
};

export const stubEditorialDeclarationValidator: EditorialDeclarationValidator = {
    async validate(_e) {
        // TODO: schema validate + hash + on-chain bind.
        return { valid: true, on_chain_pointer: "stub-onchain-editorial" };
    },
};

export const stubRopAuditSink: RopAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface RopGateDeps {
    face_presence?: FacePresenceDetector;
    public_figure?: PublicFigureIndex;
    creator_match?: CreatorIdentityFaceMatch;
    model_release?: ModelReleaseValidator;
    editorial?: EditorialDeclarationValidator;
    audit?: RopAuditSink;
}

const PERMITTED_PATHS: ResolutionPath[] = [
    "model_release",
    "editorial_declaration",
    "creator_as_subject",
];

export async function validateRop(
    file: Uint8Array,
    upload_id: string,
    creator_id: string,
    resolution_evidence: ResolutionEvidence | null,
    deps: RopGateDeps = {}
): Promise<RopResult> {
    const face_presence_detector = deps.face_presence ?? stubFacePresenceDetector;
    const public_figure_index = deps.public_figure ?? stubPublicFigureIndex;
    const creator_match = deps.creator_match ?? stubCreatorIdentityFaceMatch;
    const model_release_validator = deps.model_release ?? stubModelReleaseValidator;
    const editorial_validator = deps.editorial ?? stubEditorialDeclarationValidator;
    const audit = deps.audit ?? stubRopAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    // §2.1 Face-presence (binary; general population).
    const presence = await face_presence_detector.detect(file);
    if (presence === null) {
        audit.record({
            upload_id, creator_id, file_sha256,
            face_presence: null, public_figure_match: null, match_score: null,
            resolution_path: null, error_code: "ROP_FACE_INDEX_UNAVAILABLE", at,
        });
        return { ok: false, error_code: "ROP_FACE_INDEX_UNAVAILABLE" };
    }

    // No identifiable person -> gate passes automatically.
    if (!presence.face_presence) {
        audit.record({
            upload_id, creator_id, file_sha256,
            face_presence: false, public_figure_match: false, match_score: null,
            resolution_path: null, error_code: null, at,
        });
        return {
            ok: true,
            face_presence: false,
            public_figure_match: false,
            resolution_path: null,
            deed_binding: null,
        };
    }

    // §2.1 Public-figure index (informational on this branch -- resolution
    // is required regardless of public-figure status when a face is present).
    const pf = await public_figure_index.query(file);
    if (pf === null) {
        audit.record({
            upload_id, creator_id, file_sha256,
            face_presence: true, public_figure_match: null, match_score: null,
            resolution_path: null, error_code: "ROP_FACE_INDEX_UNAVAILABLE", at,
        });
        return { ok: false, error_code: "ROP_FACE_INDEX_UNAVAILABLE" };
    }

    // §2.2 Creator-as-Subject auto-resolution. Attempted whenever no evidence
    // is supplied OR evidence type is "creator_as_subject".
    if (resolution_evidence === null || resolution_evidence.type === "creator_as_subject") {
        const cm = await creator_match.match(file, creator_id);
        if (cm !== null && cm.matched) {
            audit.record({
                upload_id, creator_id, file_sha256,
                face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
                resolution_path: "creator_as_subject", error_code: null, at,
            });
            return {
                ok: true,
                face_presence: true,
                public_figure_match: pf.matched,
                resolution_path: "creator_as_subject",
                deed_binding: null,
            };
        }

        // Auto-match failed. If the creator explicitly supplied creator_as_subject
        // evidence, that's INVALID; otherwise gate to require resolution.
        if (resolution_evidence?.type === "creator_as_subject") {
            audit.record({
                upload_id, creator_id, file_sha256,
                face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
                resolution_path: null, error_code: "ROP_RESOLUTION_INVALID", at,
            });
            return { ok: false, error_code: "ROP_RESOLUTION_INVALID" };
        }

        audit.record({
            upload_id, creator_id, file_sha256,
            face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
            resolution_path: null, error_code: "ROP_RESOLUTION_REQUIRED", at,
        });
        return {
            ok: false,
            error_code: "ROP_RESOLUTION_REQUIRED",
            permitted_resolution_paths: [...PERMITTED_PATHS],
        };
    }

    // §2.2 Model release path.
    if (resolution_evidence.type === "model_release") {
        const v = await model_release_validator.validate(resolution_evidence);
        if (!v.valid || v.on_chain_pointer === null) {
            audit.record({
                upload_id, creator_id, file_sha256,
                face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
                resolution_path: null, error_code: "ROP_RESOLUTION_INVALID", at,
            });
            return { ok: false, error_code: "ROP_RESOLUTION_INVALID" };
        }
        audit.record({
            upload_id, creator_id, file_sha256,
            face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
            resolution_path: "model_release", error_code: null, at,
        });
        return {
            ok: true,
            face_presence: true,
            public_figure_match: pf.matched,
            resolution_path: "model_release",
            deed_binding: {
                document_hash: resolution_evidence.document_hash,
                on_chain_pointer: v.on_chain_pointer,
            },
        };
    }

    // §2.2 Editorial-use exemption path (default tier triggers downstream
    // manual review per §2.2; this gate emits Pass with the declaration bound).
    const v = await editorial_validator.validate(resolution_evidence);
    if (!v.valid || v.on_chain_pointer === null) {
        audit.record({
            upload_id, creator_id, file_sha256,
            face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
            resolution_path: null, error_code: "ROP_RESOLUTION_INVALID", at,
        });
        return { ok: false, error_code: "ROP_RESOLUTION_INVALID" };
    }
    audit.record({
        upload_id, creator_id, file_sha256,
        face_presence: true, public_figure_match: pf.matched, match_score: pf.match_score,
        resolution_path: "editorial_declaration", error_code: null, at,
    });
    return {
        ok: true,
        face_presence: true,
        public_figure_match: pf.matched,
        resolution_path: "editorial_declaration",
        deed_binding: {
            document_hash: resolution_evidence.document_hash,
            on_chain_pointer: v.on_chain_pointer,
        },
    };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
