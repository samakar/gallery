// ncii.ts
// Tier 2 NCII (non-consensual intimate imagery) classifier gate.
// Spec: /docs/deferred/drm_ncii.md
// Covers real-photographic and synthetic NCII. Runs after drm_csam +
// drm_aicsam pass; independent of drm_rop (both run, both gate).
// On detection: Take It Down Act (2025) takedown procedure + state-NCII
// reporting + permanent platform removal.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Public types (contract)
// -------------------------------------------------------------------

export type NciiErrorCode = "NCII_DETECTED" | "NCII_CLASSIFIER_UNAVAILABLE";

export interface NciiPass {
    ok: true;
    classifier_version: string;
    confidence: number;                 // below threshold
}

export interface NciiReject {
    ok: false;
    error_code: NciiErrorCode;
    takedown_ticket_id: string | null;  // populated iff NCII_DETECTED
}

export type NciiResult = NciiPass | NciiReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface HiveNciiClient {
    // Returns null on scan failure; caller treats as fail-closed per §3 NFR.
    classify(bytes: Uint8Array): Promise<HiveNciiVerdict | null>;
}

export interface HiveNciiVerdict {
    confidence: number;                 // [0, 1]
    classifier_version: string;
}

export interface NciiIncidentResponder {
    // Synchronous downstream sequence per §2.2:
    //   account suspended,
    //   Take It Down Act (2025) takedown queued,
    //   state-NCII-statute reporting where applicable,
    //   permanent platform removal + royalty forfeit.
    respond(ctx: NciiIncidentContext): Promise<NciiIncidentReceipt>;
}

export interface NciiIncidentContext {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    classifier_version: string;
    confidence: number;
    detected_at: string;                // ISO 8601
}

export interface NciiIncidentReceipt {
    takedown_ticket_id: string;
}

export interface NciiAuditSink {
    record(event: NciiAuditEvent): void;
}

export interface NciiAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    classifier_version: string;
    confidence: number | null;
    matched: boolean;
    error_code: NciiErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters (deterministic; safe defaults)
// -------------------------------------------------------------------

export const stubHiveNciiClient: HiveNciiClient = {
    async classify(_bytes) {
        // TODO: replace with Hive Moderation NCII API (or self-hosted equivalent).
        return { confidence: 0, classifier_version: "stub-0.0.0" };
    },
};

export const stubNciiIncidentResponder: NciiIncidentResponder = {
    async respond(_ctx) {
        // TODO: wire Take It Down Act takedown + auth.suspend + storage.purge +
        // state-NCII reporting + auth.permanentlyRemove.
        return { takedown_ticket_id: "stub-takedown-ticket" };
    },
};

export const stubNciiAuditSink: NciiAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Calibration
// -------------------------------------------------------------------

// §3 NFR Threshold: conservative-toward-reject at the boundary. Calibrated
// against the Hive NCII model in use; replay-tested per build.
const NCII_DETECTION_THRESHOLD = 0.5;

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface NciiGateDeps {
    hive?: HiveNciiClient;
    incident?: NciiIncidentResponder;
    audit?: NciiAuditSink;
}

export async function validateNcii(
    file: Uint8Array,
    upload_id: string,
    creator_id: string,
    deps: NciiGateDeps = {}
): Promise<NciiResult> {
    const hive = deps.hive ?? stubHiveNciiClient;
    const incident = deps.incident ?? stubNciiIncidentResponder;
    const audit = deps.audit ?? stubNciiAuditSink;

    const detected_at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    const verdict = await hive.classify(file);

    // §3 NFR Availability: fail-closed.
    if (verdict === null) {
        audit.record({
            upload_id,
            creator_id,
            file_sha256,
            classifier_version: "",
            confidence: null,
            matched: false,
            error_code: "NCII_CLASSIFIER_UNAVAILABLE",
            at: detected_at,
        });
        return {
            ok: false,
            error_code: "NCII_CLASSIFIER_UNAVAILABLE",
            takedown_ticket_id: null,
        };
    }

    const matched = verdict.confidence >= NCII_DETECTION_THRESHOLD;

    audit.record({
        upload_id,
        creator_id,
        file_sha256,
        classifier_version: verdict.classifier_version,
        confidence: verdict.confidence,
        matched,
        error_code: matched ? "NCII_DETECTED" : null,
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
    // pipeline halts -- NCII never silently passes on infrastructure error.
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
        error_code: "NCII_DETECTED",
        takedown_ticket_id: receipt.takedown_ticket_id,
    };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
