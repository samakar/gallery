// csam.ts
// Tier 0 CSAM hash-match gate (server-side, blocking).
// Spec: /docs/deferred/drm_csam.md (DEFERRED to MMP per revised R71:
// moderator manual review supersedes automated PhotoDNA at MVP per R71 §2.2 step 5;
// see /src/cert/moderation.ts).
// Hard floor. When re-activated at MMP, runs synchronously before drm_adult.
// Operates under 18 U.S.C. §2258B good-faith immunity.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Public types (contract)
// -------------------------------------------------------------------

export type CsamErrorCode = "CSAM_HASH_MATCH" | "PHOTODNA_UNAVAILABLE";

export interface CsamPass {
    ok: true;
    api_version: string;
}

export interface CsamReject {
    ok: false;
    error_code: CsamErrorCode;
    ncmec_ticket_id: string | null;  // populated iff error_code === "CSAM_HASH_MATCH"
}

export type CsamResult = CsamPass | CsamReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface PhotoDnaClient {
    // Hash + lookup against NCMEC CyberTipline + Tech Coalition corpus.
    // Returns null on scan failure; caller treats as fail-closed per §3 NFR.
    scan(bytes: Uint8Array): Promise<PhotoDnaScan | null>;
}

export interface PhotoDnaScan {
    matched: boolean;
    api_version: string;
}

export interface CsamIncidentResponder {
    // Synchronous downstream sequence per §2.2:
    //   §2258A NCMEC CyberTipline report (SLA 24h, statutory ceiling 60 days),
    //   creator account suspension, staging purge, LE referral,
    //   permanent platform removal + royalty forfeit.
    respond(ctx: CsamIncidentContext): Promise<CsamIncidentReceipt>;
}

export interface CsamIncidentContext {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    photodna_api_version: string;
    detected_at: string;          // ISO 8601
}

export interface CsamIncidentReceipt {
    ncmec_ticket_id: string;
}

export interface CsamAuditSink {
    record(event: CsamAuditEvent): void;
}

export interface CsamAuditEvent {
    upload_id: string;
    creator_id: string;
    file_sha256: string;
    api_version: string;
    matched: boolean;
    error_code: CsamErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters (deterministic; safe defaults)
// -------------------------------------------------------------------

export const stubPhotoDnaClient: PhotoDnaClient = {
    async scan(_bytes) {
        // TODO: replace with Microsoft PhotoDNA + Tech Coalition lookup.
        return { matched: false, api_version: "stub-0.0.0" };
    },
};

export const stubCsamIncidentResponder: CsamIncidentResponder = {
    async respond(_ctx) {
        // TODO: wire NCMEC CyberTipline report + auth.suspend + storage.purge
        // + LE referral + auth.permanentlyRemove.
        return { ncmec_ticket_id: "stub-ncmec-ticket" };
    },
};

export const stubCsamAuditSink: CsamAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

export interface CsamGateDeps {
    photodna?: PhotoDnaClient;
    incident?: CsamIncidentResponder;
    audit?: CsamAuditSink;
}

export async function validateCsam(
    file: Uint8Array,
    upload_id: string,
    creator_id: string,
    deps: CsamGateDeps = {}
): Promise<CsamResult> {
    const photodna = deps.photodna ?? stubPhotoDnaClient;
    const incident = deps.incident ?? stubCsamIncidentResponder;
    const audit = deps.audit ?? stubCsamAuditSink;

    const detected_at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    const scan = await photodna.scan(file);

    // §3 NFR Availability: fail-closed. Any PhotoDNA failure halts ingestion;
    // no fail-open path.
    if (scan === null) {
        audit.record({
            upload_id,
            creator_id,
            file_sha256,
            api_version: "",
            matched: false,
            error_code: "PHOTODNA_UNAVAILABLE",
            at: detected_at,
        });
        return { ok: false, error_code: "PHOTODNA_UNAVAILABLE", ncmec_ticket_id: null };
    }

    audit.record({
        upload_id,
        creator_id,
        file_sha256,
        api_version: scan.api_version,
        matched: scan.matched,
        error_code: scan.matched ? "CSAM_HASH_MATCH" : null,
        at: detected_at,
    });

    if (!scan.matched) {
        return { ok: true, api_version: scan.api_version };
    }

    // §2.2 Blocking downstream sequence. A responder failure propagates so
    // the pipeline halts -- CSAM never silently passes on infrastructure error.
    const receipt = await incident.respond({
        upload_id,
        creator_id,
        file_sha256,
        photodna_api_version: scan.api_version,
        detected_at,
    });

    return {
        ok: false,
        error_code: "CSAM_HASH_MATCH",
        ncmec_ticket_id: receipt.ncmec_ticket_id,
    };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
