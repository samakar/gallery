// adult.ts
// Content classification gate (single-classifier Hive Moderation).
// Spec: /docs/deferred/drm_adult.md (DEFERRED to MMP per revised R71:
// moderator manual two-checkbox review supersedes automated Hive at MVP per
// R71 §2.2 step 5; see /src/cert/moderation.ts).
// When re-activated at MMP: hard reject on Suggestive or above. The pre-R71
// three-classifier ensemble (Hive + Google SafeSearch + Rekognition) and the
// Suggestive-with-restrictions disposition remain out of scope.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Public types (contract)
// -------------------------------------------------------------------

export type Classification = "G" | "Suggestive" | "Adult" | "Prohibited";

export type AdultErrorCode =
    | "CONTENT_REJECTED"
    | "PROHIBITED_CONTENT_REJECTED"
    | "HIVE_CLASSIFIER_UNAVAILABLE";

export interface ClassifierScores {
    adult: number;             // [0, 1]
    racy: number;
    violence: number;
    violence_against_persons: number;
    exploitation: number;
}

export interface AdultPass {
    ok: true;
    classification: "G";
    classifier_version: string;
    scores: ClassifierScores;
}

export interface AdultReject {
    ok: false;
    classification: "Suggestive" | "Adult" | "Prohibited" | null;  // null when error_code = HIVE_CLASSIFIER_UNAVAILABLE
    error_code: AdultErrorCode;
    classifier_version: string | null;
    scores: ClassifierScores | null;
    review_ticket_id: string | null;  // populated iff classification = Prohibited
}

export type AdultResult = AdultPass | AdultReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface HiveModerationClient {
    // Returns null on infra failure; caller treats as fail-closed.
    classify(bytes: Uint8Array): Promise<HiveVerdict | null>;
}

export interface HiveVerdict {
    classification: Classification;
    classifier_version: string;
    scores: ClassifierScores;
}

export interface ProhibitedManualReviewQueue {
    enqueue(ctx: ProhibitedReviewContext): Promise<{ review_ticket_id: string }>;
}

export interface ProhibitedReviewContext {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    classifier_version: string;
    scores: ClassifierScores;
    enqueued_at: string;
}

export interface AdultAuditSink {
    record(event: AdultAuditEvent): void;
}

export interface AdultAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    classifier_version: string | null;
    scores: ClassifierScores | null;
    classification: Classification | null;
    error_code: AdultErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters
// -------------------------------------------------------------------

export const stubHiveModerationClient: HiveModerationClient = {
    async classify(_bytes) {
        // TODO: replace with Hive Moderation REST API.
        return {
            classification: "G",
            classifier_version: "stub-0.0.0",
            scores: {
                adult: 0, racy: 0, violence: 0,
                violence_against_persons: 0, exploitation: 0,
            },
        };
    },
};

export const stubProhibitedManualReviewQueue: ProhibitedManualReviewQueue = {
    async enqueue(_ctx) {
        // TODO: route to platform manual-review subsystem.
        return { review_ticket_id: "stub-prohibited-review" };
    },
};

export const stubAdultAuditSink: AdultAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface AdultGateDeps {
    hive?: HiveModerationClient;
    manual_review?: ProhibitedManualReviewQueue;
    audit?: AdultAuditSink;
}

export async function validateAdult(
    file: Uint8Array,
    upload_id: string,
    creator_id: string,
    deps: AdultGateDeps = {}
): Promise<AdultResult> {
    const hive = deps.hive ?? stubHiveModerationClient;
    const manualReview = deps.manual_review ?? stubProhibitedManualReviewQueue;
    const audit = deps.audit ?? stubAdultAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    const verdict = await hive.classify(file);

    // §3 NFR Availability: fail-closed.
    if (verdict === null) {
        audit.record({
            upload_id, creator_id, file_sha256,
            classifier_version: null,
            scores: null,
            classification: null,
            error_code: "HIVE_CLASSIFIER_UNAVAILABLE",
            at,
        });
        return {
            ok: false,
            classification: null,
            error_code: "HIVE_CLASSIFIER_UNAVAILABLE",
            classifier_version: null,
            scores: null,
            review_ticket_id: null,
        };
    }

    const { classification, classifier_version, scores } = verdict;

    audit.record({
        upload_id, creator_id, file_sha256,
        classifier_version,
        scores,
        classification,
        error_code: classification === "G"
            ? null
            : (classification === "Prohibited" ? "PROHIBITED_CONTENT_REJECTED" : "CONTENT_REJECTED"),
        at,
    });

    if (classification === "G") {
        return {
            ok: true,
            classification: "G",
            classifier_version,
            scores,
        };
    }

    if (classification === "Prohibited") {
        const { review_ticket_id } = await manualReview.enqueue({
            upload_id, creator_id, file_sha256,
            classifier_version, scores,
            enqueued_at: at,
        });
        return {
            ok: false,
            classification: "Prohibited",
            error_code: "PROHIBITED_CONTENT_REJECTED",
            classifier_version, scores,
            review_ticket_id,
        };
    }

    // Suggestive or Adult -- hard reject per R71 §2.2 step 6.
    return {
        ok: false,
        classification,
        error_code: "CONTENT_REJECTED",
        classifier_version, scores,
        review_ticket_id: null,
    };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
