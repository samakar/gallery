// authenticity.ts
// Content Authenticity Gate: synthetic-content detection + deepfake-of-real-
// person + origin declaration + reverse-image pre-check. Server-side.
// Spec: /docs/deferred/drm_authenticity.md
// C2PA manifest validation is delegated to image_spec §2.8; this module
// consumes validated fields for deed-page surfacing.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Origin declaration vocabulary
// -------------------------------------------------------------------

export type OriginDeclaration =
    | "Captured"
    | "Hand-produced"
    | "AI-assisted"
    | "AI-generated";

export type Tier2Confidence = "high" | "medium" | "low";

// -------------------------------------------------------------------
// C2PA fields (consumed from image_spec §2.8)
// -------------------------------------------------------------------

export interface C2paFields {
    signer: string;
    tool_chain: string[];
    action_chain: string[];        // c2pa.actions vocabulary entries
    ai_detected: boolean;
}

// -------------------------------------------------------------------
// Deepfake resolution evidence (input)
// -------------------------------------------------------------------

export type DeepfakeResolutionPath =
    | "consent_document"
    | "synthetic_disclosure"
    | "creator_as_subject";

export interface DeepfakeConsentEvidence {
    type: "consent_document";
    document_hash: string;
    signing_event_id: string;
}

export interface DeepfakeSyntheticDisclosureEvidence {
    type: "synthetic_disclosure";
    depicted_person_name: string;
    jurisdictional_basis: string;       // parody / satire / commentary
}

export interface DeepfakeCreatorAsSubjectEvidence {
    type: "creator_as_subject";
    // No fields; resolution computed from creator identity chain.
}

export type DeepfakeResolutionEvidence =
    | DeepfakeConsentEvidence
    | DeepfakeSyntheticDisclosureEvidence
    | DeepfakeCreatorAsSubjectEvidence;

// -------------------------------------------------------------------
// Reverse-image hits + Tier-1 forensics
// -------------------------------------------------------------------

export interface ReverseImageHit {
    url: string;
    corpus_match: boolean;              // true iff inside creator's verified-portfolio corpus
}

export interface Tier1ForensicsSummary {
    ela_anomaly: boolean;
    prnu_inconsistent: boolean;
    quant_table_inconsistent: boolean;
}

// -------------------------------------------------------------------
// Public output types (contract)
// -------------------------------------------------------------------

export type AuthenticityErrorCode =
    | "ORIGIN_DECLARATION_MISMATCH"
    | "UNDISCLOSED_SYNTHETIC"
    | "DEEPFAKE_GATED"
    | "DEEPFAKE_RESOLUTION_INVALID"
    | "REVERSE_IMAGE_REVIEW"
    | "AUTHENTICITY_CLASSIFIER_UNAVAILABLE";

export interface AuthenticityPass {
    ok: true;
    c2pa_present: boolean;
    c2pa_action_chain: string[];
    tier1_forensics: Tier1ForensicsSummary;
    tier2_confidence: Tier2Confidence;
    origin_declaration: OriginDeclaration;
    origin_badge: OriginDeclaration;   // 1:1 with declaration
    deepfake_detected: boolean;
    deepfake_resolution_path: DeepfakeResolutionPath | null;
    reverse_image_hits: ReverseImageHit[];
}

export interface AuthenticityReject {
    ok: false;
    error_code:
        | "ORIGIN_DECLARATION_MISMATCH"
        | "UNDISCLOSED_SYNTHETIC"
        | "DEEPFAKE_RESOLUTION_INVALID"
        | "AUTHENTICITY_CLASSIFIER_UNAVAILABLE";
    evidence: AuthenticityEvidence;
}

export interface AuthenticityDeepfakeGate {
    ok: false;
    error_code: "DEEPFAKE_GATED";
    permitted_resolution_paths: DeepfakeResolutionPath[];
}

export interface AuthenticityReverseImageReview {
    ok: false;
    error_code: "REVERSE_IMAGE_REVIEW";
    review_ticket_id: string;
}

export type AuthenticityResult =
    | AuthenticityPass
    | AuthenticityReject
    | AuthenticityDeepfakeGate
    | AuthenticityReverseImageReview;

export interface AuthenticityEvidence {
    tier1?: Tier1ForensicsSummary;
    tier2_confidence?: Tier2Confidence;
    deepfake_match_score?: number;
    failed_check?: string;
}

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface Tier1ForensicsAnalyzer {
    // ELA + PRNU + JPEG quant-table consistency. Best-effort; null is non-fatal.
    analyze(bytes: Uint8Array): Promise<Tier1ForensicsSummary | null>;
}

export interface Tier2SyntheticClassifier {
    // Generative-model fingerprint detection (Sensity-class).
    // Returns null on infra failure -> fail-closed.
    classify(bytes: Uint8Array): Promise<Tier2Verdict | null>;
}

export interface Tier2Verdict {
    confidence: Tier2Confidence;
    classifier_version: string;
}

export interface DeepfakePublicFigureIndex {
    // Shared infrastructure with drm_rop's public-figure index (drm_authenticity OI-07).
    // Returns null on infra failure -> fail-closed.
    query(bytes: Uint8Array): Promise<DeepfakeFaceVerdict | null>;
}

export interface DeepfakeFaceVerdict {
    matched: boolean;
    match_score: number;
    index_version: string;
}

export interface CreatorIdentityFaceMatch {
    // Match against R62 §3.1 three-layer identity chain (overlap with drm_rop).
    match(bytes: Uint8Array, creator_id: string): Promise<CreatorMatchVerdict | null>;
}

export interface CreatorMatchVerdict {
    matched: boolean;
    confidence: number;
    chain_version: string;
}

export interface DeepfakeConsentValidator {
    validate(evidence: DeepfakeConsentEvidence): Promise<{ valid: boolean }>;
}

export interface DeepfakeSyntheticDisclosureValidator {
    validate(evidence: DeepfakeSyntheticDisclosureEvidence): Promise<{ valid: boolean }>;
}

export interface ReverseImageIndex {
    // Major public image indices (web image search, public stock-photo databases).
    query(phash: string): Promise<ReverseImageQueryResult>;
}

export interface ReverseImageQueryResult {
    hits: { url: string }[];
}

export interface CreatorPortfolioCorpus {
    // R62 §3.1 verified-portfolio domains + OAuth-bound social handles.
    isInCorpus(creator_id: string, url: string): Promise<boolean>;
}

export interface RightsReviewQueue {
    // §7.1.7 Provenance and Rights Verification handoff (shared module with
    // drm_uniqueness; forward-looking, not MVP scope).
    enqueue(ctx: ReverseImageReviewContext): Promise<{ review_ticket_id: string }>;
}

export interface ReverseImageReviewContext {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    phash: string;
    out_of_corpus_hits: { url: string }[];
    enqueued_at: string;
}

export interface AuthenticityAuditSink {
    record(event: AuthenticityAuditEvent): void;
}

export interface AuthenticityAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    origin_declaration: OriginDeclaration;
    tier1?: Tier1ForensicsSummary;
    tier2_confidence?: Tier2Confidence;
    deepfake_detected?: boolean;
    deepfake_resolution_path?: DeepfakeResolutionPath;
    reverse_image_hit_count?: number;
    error_code: AuthenticityErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters
// -------------------------------------------------------------------

export const stubTier1ForensicsAnalyzer: Tier1ForensicsAnalyzer = {
    async analyze(_bytes) {
        return { ela_anomaly: false, prnu_inconsistent: false, quant_table_inconsistent: false };
    },
};

export const stubTier2SyntheticClassifier: Tier2SyntheticClassifier = {
    async classify(_bytes) {
        return { confidence: "high", classifier_version: "stub-0.0.0" };
    },
};

export const stubDeepfakePublicFigureIndex: DeepfakePublicFigureIndex = {
    async query(_bytes) {
        return { matched: false, match_score: 0, index_version: "stub-0.0.0" };
    },
};

export const stubAuthenticityCreatorIdentityFaceMatch: CreatorIdentityFaceMatch = {
    async match(_bytes, _id) {
        return { matched: false, confidence: 0, chain_version: "stub-0.0.0" };
    },
};

export const stubDeepfakeConsentValidator: DeepfakeConsentValidator = {
    async validate(_e) { return { valid: true }; },
};

export const stubDeepfakeSyntheticDisclosureValidator: DeepfakeSyntheticDisclosureValidator = {
    async validate(_e) { return { valid: true }; },
};

export const stubReverseImageIndex: ReverseImageIndex = {
    async query(_phash) { return { hits: [] }; },
};

export const stubCreatorPortfolioCorpus: CreatorPortfolioCorpus = {
    async isInCorpus(_id, _url) { return false; },
};

export const stubAuthenticityRightsReviewQueue: RightsReviewQueue = {
    async enqueue(_ctx) { return { review_ticket_id: "stub-reverse-image-review" }; },
};

export const stubAuthenticityAuditSink: AuthenticityAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface AuthenticityGateInputs {
    file: Uint8Array;
    upload_id: string;
    creator_id: string;
    origin_declaration: OriginDeclaration;
    ai_tool_disclosure?: string[];          // required iff AI-X declaration
    deepfake_resolution_evidence?: DeepfakeResolutionEvidence;
    phash?: string;                          // from drm_uniqueness handoff
    c2pa?: C2paFields;                       // from image_spec §2.8 handoff
}

export interface AuthenticityGateDeps {
    tier1?: Tier1ForensicsAnalyzer;
    tier2?: Tier2SyntheticClassifier;
    public_figure?: DeepfakePublicFigureIndex;
    creator_match?: CreatorIdentityFaceMatch;
    consent_validator?: DeepfakeConsentValidator;
    synthetic_disclosure_validator?: DeepfakeSyntheticDisclosureValidator;
    reverse_image?: ReverseImageIndex;
    portfolio_corpus?: CreatorPortfolioCorpus;
    rights_review?: RightsReviewQueue;
    audit?: AuthenticityAuditSink;
}

const PERMITTED_DEEPFAKE_PATHS: DeepfakeResolutionPath[] = [
    "consent_document",
    "synthetic_disclosure",
    "creator_as_subject",
];

export async function validateAuthenticity(
    inputs: AuthenticityGateInputs,
    deps: AuthenticityGateDeps = {}
): Promise<AuthenticityResult> {
    const tier1Analyzer = deps.tier1 ?? stubTier1ForensicsAnalyzer;
    const tier2Classifier = deps.tier2 ?? stubTier2SyntheticClassifier;
    const publicFigureIndex = deps.public_figure ?? stubDeepfakePublicFigureIndex;
    const creatorMatch = deps.creator_match ?? stubAuthenticityCreatorIdentityFaceMatch;
    const consentValidator = deps.consent_validator ?? stubDeepfakeConsentValidator;
    const disclosureValidator = deps.synthetic_disclosure_validator ?? stubDeepfakeSyntheticDisclosureValidator;
    const reverseImageIndex = deps.reverse_image ?? stubReverseImageIndex;
    const portfolioCorpus = deps.portfolio_corpus ?? stubCreatorPortfolioCorpus;
    const rightsReview = deps.rights_review ?? stubAuthenticityRightsReviewQueue;
    const audit = deps.audit ?? stubAuthenticityAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(inputs.file);

    // §3.1 Pipeline: steps 2-4 run in parallel.
    const [tier1, tier2, deepfaceVerdict] = await Promise.all([
        tier1Analyzer.analyze(inputs.file),
        tier2Classifier.classify(inputs.file),
        publicFigureIndex.query(inputs.file),
    ]);

    // §4 NFR Availability: Tier 2 + deepfake check are fail-closed; Tier 1 best-effort.
    if (tier2 === null || deepfaceVerdict === null) {
        audit.record({
            upload_id: inputs.upload_id, creator_id: inputs.creator_id, file_sha256,
            origin_declaration: inputs.origin_declaration,
            tier1: tier1 ?? undefined,
            tier2_confidence: tier2?.confidence,
            error_code: "AUTHENTICITY_CLASSIFIER_UNAVAILABLE",
            at,
        });
        return {
            ok: false,
            error_code: "AUTHENTICITY_CLASSIFIER_UNAVAILABLE",
            evidence: {
                tier1: tier1 ?? undefined,
                tier2_confidence: tier2?.confidence,
                failed_check: tier2 === null ? "tier2_synthetic_classifier" : "deepfake_public_figure_index",
            },
        };
    }

    const tier1Result: Tier1ForensicsSummary = tier1 ?? {
        ela_anomaly: false, prnu_inconsistent: false, quant_table_inconsistent: false,
    };

    // §2.4 Origin-declaration validation against Tier 2 confidence.
    const originCheck = checkOriginAgainstTier2(inputs.origin_declaration, tier2.confidence);
    if (originCheck !== "ok") {
        const error_code: AuthenticityErrorCode =
            originCheck === "undisclosed_synthetic" ? "UNDISCLOSED_SYNTHETIC" : "ORIGIN_DECLARATION_MISMATCH";
        audit.record({
            upload_id: inputs.upload_id, creator_id: inputs.creator_id, file_sha256,
            origin_declaration: inputs.origin_declaration,
            tier1: tier1Result, tier2_confidence: tier2.confidence,
            deepfake_detected: deepfaceVerdict.matched,
            error_code, at,
        });
        return {
            ok: false,
            error_code: error_code as "UNDISCLOSED_SYNTHETIC" | "ORIGIN_DECLARATION_MISMATCH",
            evidence: { tier1: tier1Result, tier2_confidence: tier2.confidence },
        };
    }

    // §2.3 Deepfake-of-Real-Person gate.
    let deepfake_resolution_path: DeepfakeResolutionPath | null = null;
    if (deepfaceVerdict.matched) {
        const resolved = await resolveDeepfake({
            file: inputs.file,
            creator_id: inputs.creator_id,
            evidence: inputs.deepfake_resolution_evidence ?? null,
            creatorMatch,
            consentValidator,
            disclosureValidator,
        });

        if (resolved.kind === "gated") {
            audit.record({
                upload_id: inputs.upload_id, creator_id: inputs.creator_id, file_sha256,
                origin_declaration: inputs.origin_declaration,
                tier1: tier1Result, tier2_confidence: tier2.confidence,
                deepfake_detected: true,
                error_code: "DEEPFAKE_GATED", at,
            });
            return {
                ok: false,
                error_code: "DEEPFAKE_GATED",
                permitted_resolution_paths: [...PERMITTED_DEEPFAKE_PATHS],
            };
        }
        if (resolved.kind === "invalid") {
            audit.record({
                upload_id: inputs.upload_id, creator_id: inputs.creator_id, file_sha256,
                origin_declaration: inputs.origin_declaration,
                tier1: tier1Result, tier2_confidence: tier2.confidence,
                deepfake_detected: true,
                error_code: "DEEPFAKE_RESOLUTION_INVALID", at,
            });
            return {
                ok: false,
                error_code: "DEEPFAKE_RESOLUTION_INVALID",
                evidence: {
                    deepfake_match_score: deepfaceVerdict.match_score,
                    tier2_confidence: tier2.confidence,
                },
            };
        }
        deepfake_resolution_path = resolved.path;
    }

    // §2.5 Reverse-image pre-check. Skipped if no pHash provided.
    const reverse_image_hits: ReverseImageHit[] = [];
    const out_of_corpus_hits: { url: string }[] = [];
    if (inputs.phash) {
        const rev = await reverseImageIndex.query(inputs.phash);
        for (const hit of rev.hits) {
            const corpus_match = await portfolioCorpus.isInCorpus(inputs.creator_id, hit.url);
            reverse_image_hits.push({ url: hit.url, corpus_match });
            if (!corpus_match) out_of_corpus_hits.push({ url: hit.url });
        }
    }

    if (out_of_corpus_hits.length > 0) {
        const { review_ticket_id } = await rightsReview.enqueue({
            upload_id: inputs.upload_id,
            creator_id: inputs.creator_id,
            file_sha256,
            phash: inputs.phash!,
            out_of_corpus_hits,
            enqueued_at: at,
        });
        audit.record({
            upload_id: inputs.upload_id, creator_id: inputs.creator_id, file_sha256,
            origin_declaration: inputs.origin_declaration,
            tier1: tier1Result, tier2_confidence: tier2.confidence,
            deepfake_detected: deepfaceVerdict.matched,
            deepfake_resolution_path: deepfake_resolution_path ?? undefined,
            reverse_image_hit_count: reverse_image_hits.length,
            error_code: "REVERSE_IMAGE_REVIEW", at,
        });
        return {
            ok: false,
            error_code: "REVERSE_IMAGE_REVIEW",
            review_ticket_id,
        };
    }

    audit.record({
        upload_id: inputs.upload_id, creator_id: inputs.creator_id, file_sha256,
        origin_declaration: inputs.origin_declaration,
        tier1: tier1Result, tier2_confidence: tier2.confidence,
        deepfake_detected: deepfaceVerdict.matched,
        deepfake_resolution_path: deepfake_resolution_path ?? undefined,
        reverse_image_hit_count: reverse_image_hits.length,
        error_code: null, at,
    });

    return {
        ok: true,
        c2pa_present: inputs.c2pa !== undefined,
        c2pa_action_chain: inputs.c2pa?.action_chain ?? [],
        tier1_forensics: tier1Result,
        tier2_confidence: tier2.confidence,
        origin_declaration: inputs.origin_declaration,
        origin_badge: inputs.origin_declaration,
        deepfake_detected: deepfaceVerdict.matched,
        deepfake_resolution_path,
        reverse_image_hits,
    };
}

// -------------------------------------------------------------------
// Origin-declaration vs Tier 2 confidence
// -------------------------------------------------------------------
//
// Tier 2 confidence semantics: high = authentic; medium = uncertain;
// low = synthetic. §2.4 acceptance rules:
//   Captured        -> Tier 2 must be high
//   Hand-produced   -> Tier 2 high or medium
//   AI-assisted     -> any Tier 2 acceptable; high contradicts
//   AI-generated    -> any Tier 2 acceptable; high contradicts

type OriginCheck = "ok" | "mismatch" | "undisclosed_synthetic";

function checkOriginAgainstTier2(decl: OriginDeclaration, tier2: Tier2Confidence): OriginCheck {
    if (decl === "Captured" || decl === "Hand-produced") {
        if (tier2 === "low") return "undisclosed_synthetic";
        if (decl === "Captured" && tier2 === "medium") return "mismatch";
        return "ok";
    }
    // AI-assisted or AI-generated
    if (tier2 === "high") return "mismatch";
    return "ok";
}

// -------------------------------------------------------------------
// Deepfake resolution
// -------------------------------------------------------------------

type DeepfakeResolution =
    | { kind: "resolved"; path: DeepfakeResolutionPath }
    | { kind: "gated" }
    | { kind: "invalid" };

async function resolveDeepfake(args: {
    file: Uint8Array;
    creator_id: string;
    evidence: DeepfakeResolutionEvidence | null;
    creatorMatch: CreatorIdentityFaceMatch;
    consentValidator: DeepfakeConsentValidator;
    disclosureValidator: DeepfakeSyntheticDisclosureValidator;
}): Promise<DeepfakeResolution> {
    // Auto-attempt creator-as-subject when no evidence OR creator-as-subject evidence.
    if (args.evidence === null || args.evidence.type === "creator_as_subject") {
        const cm = await args.creatorMatch.match(args.file, args.creator_id);
        if (cm !== null && cm.matched) return { kind: "resolved", path: "creator_as_subject" };
        if (args.evidence?.type === "creator_as_subject") return { kind: "invalid" };
        return { kind: "gated" };
    }

    if (args.evidence.type === "consent_document") {
        const v = await args.consentValidator.validate(args.evidence);
        return v.valid ? { kind: "resolved", path: "consent_document" } : { kind: "invalid" };
    }

    // synthetic_disclosure
    const v = await args.disclosureValidator.validate(args.evidence);
    return v.valid ? { kind: "resolved", path: "synthetic_disclosure" } : { kind: "invalid" };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
