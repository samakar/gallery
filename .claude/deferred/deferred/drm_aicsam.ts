// aicsam.ts
// Tier 1 AI-CSAM classifier gate (server-side, blocking).
// Spec: /docs/deferred/drm_aicsam.md
// Synthetic CSAM is treated identically to real CSAM under the PROTECT Act
// and state AI-CSAM statutes. Runs after Tier 0 (drm_csam) passes; before all
// non-CSAM downstream gates.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Public types (contract)
// -------------------------------------------------------------------

export type AiCsamErrorCode = "AI_CSAM_DETECTED" | "AICSAM_CLASSIFIER_UNAVAILABLE";

export interface AiCsamPass {
    ok: true;
    classifier_version: string;
    confidence: number;              // below threshold
}

export interface AiCsamReject {
    ok: false;
    error_code: AiCsamErrorCode;
    ncmec_ticket_id: string | null;  // populated iff AI_CSAM_DETECTED
}

export type AiCsamResult = AiCsamPass | AiCsamReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface ThornClient {
    // Returns null on scan failure; caller treats as fail-closed per §3 NFR.
    classify(bytes: Uint8Array): Promise<ThornVerdict | null>;
}

export interface ThornVerdict {
    confidence: number;              // [0, 1]
    classifier_version: string;
}

// §2258A reporting + downstream actions overlap with csam.ts. Kept as a
// parallel interface to preserve per-detector context; production wiring
// routes both Tier 0 and Tier 1 to the same incident-response service.
export interface AiCsamIncidentResponder {
    respond(ctx: AiCsamIncidentContext): Promise<AiCsamIncidentReceipt>;
}

export interface AiCsamIncidentContext {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    classifier_version: string;
    confidence: number;
    detected_at: string;             // ISO 8601
}

export interface AiCsamIncidentReceipt {
    ncmec_ticket_id: string;
}

export interface AiCsamAuditSink {
    record(event: AiCsamAuditEvent): void;
}

export interface AiCsamAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    classifier_version: string;
    confidence: number | null;
    matched: boolean;
    error_code: AiCsamErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters (deterministic; safe defaults)
// -------------------------------------------------------------------

export const stubThornClient: ThornClient = {
    async classify(_bytes) {
        // TODO: replace with Thorn Safer API (or self-hosted on Thorn's model).
        return { confidence: 0, classifier_version: "stub-0.0.0" };
    },
};

export const stubAiCsamIncidentResponder: AiCsamIncidentResponder = {
    async respond(_ctx) {
        // TODO: wire NCMEC CyberTipline + auth.suspend + storage.purge +
        // LE referral + auth.permanentlyRemove.
        return { ncmec_ticket_id: "stub-ncmec-ticket" };
    },
};

export const stubAiCsamAuditSink: AiCsamAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Calibration
// -------------------------------------------------------------------

// §3 NFR Threshold: conservative-toward-reject at the boundary. Exact value
// calibrated against the Thorn model in use; replay-tested per build.
const AI_CSAM_DETECTION_THRESHOLD = 0.5;

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface AiCsamGateDeps {
    thorn?: ThornClient;
    incident?: AiCsamIncidentResponder;
    audit?: AiCsamAuditSink;
}

export async function validateAiCsam(
    file: Uint8Array,
    upload_id: string,
    creator_id: string,
    deps: AiCsamGateDeps = {}
): Promise<AiCsamResult> {
    const thorn = deps.thorn ?? stubThornClient;
    const incident = deps.incident ?? stubAiCsamIncidentResponder;
    const audit = deps.audit ?? stubAiCsamAuditSink;

    const detected_at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    const verdict = await thorn.classify(file);

    // §3 NFR Availability: fail-closed.
    if (verdict === null) {
        audit.record({
            upload_id,
            creator_id,
            file_sha256,
            classifier_version: "",
            confidence: null,
            matched: false,
            error_code: "AICSAM_CLASSIFIER_UNAVAILABLE",
            at: detected_at,
        });
        return {
            ok: false,
            error_code: "AICSAM_CLASSIFIER_UNAVAILABLE",
            ncmec_ticket_id: null,
        };
    }

    const matched = verdict.confidence >= AI_CSAM_DETECTION_THRESHOLD;

    audit.record({
        upload_id,
        creator_id,
        file_sha256,
        classifier_version: verdict.classifier_version,
        confidence: verdict.confidence,
        matched,
        error_code: matched ? "AI_CSAM_DETECTED" : null,
        at: detected_at,
    });

    if (!matched) {
        return {
            ok: true,
            classifier_version: verdict.classifier_version,
            confidence: verdict.confidence,
        };
    }

    // §2.2 Blocking downstream sequence. Responder failure propagates so the
    // pipeline halts -- AI-CSAM never silently passes on infrastructure error.
    const receipt = await incident.respond({
        upload_id,
        creator_id,
        file_sha256,
        classifier_version: verdict.classifier_version,
        confidence: verdict.confidence,
        detected_at,
    });

    return {
        ok: false,
        error_code: "AI_CSAM_DETECTED",
        ncmec_ticket_id: receipt.ncmec_ticket_id,
    };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
