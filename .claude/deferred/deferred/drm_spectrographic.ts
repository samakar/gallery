// spectrographic.ts
// Self-hosted deep-watermark embedder + extractor (StegaStamp-class).
// Spec: /docs/deferred/drm_spectrographic.md (DEFERRED to MMP per revised R71: no invisible watermark at MVP)
// Two layers: Creator watermark at ingestion, Owner watermark at personalization.
// Same backend; different payload schemas; both layers coexist on Edition / Copy.

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Public types (contract per §1)
// -------------------------------------------------------------------

export type WatermarkLayer = "creator" | "owner";

export type SpectrographicErrorCode =
    | "WATERMARK_EMBED_FAILED"
    | "WATERMARK_EXTRACT_FAILED"
    | "INVALID_INPUT_FORMAT"
    | "IMPERCEPTIBILITY_FAILURE"
    | "PAYLOAD_TOO_LARGE";

export interface CreatorPayload {
    master_id: string;
    creator_id: string;
    ingestion_timestamp: string;        // ISO 8601
}

export interface OwnerPayload {
    deed_id: string;
    owner_wallet: string;
    edition_number: number;
}

// §2.9 c2pa.watermarked action descriptor; caller forwards to drm_c2pa.
export interface C2paActionDescriptor {
    action: "c2pa.watermarked";
    softBinding: {
        alg: string;                    // embedder identifier, e.g., "elanoid-stegastamp-v1"
        value: string;                  // hex-encoded payload bits
    };
    parameters: {
        layer: WatermarkLayer;
    };
    timestamp: string;
}

export interface EmbedPass {
    ok: true;
    watermarked_file: Uint8Array;       // §2.8: only pixel coefficients modified; metadata preserved
    psnr: number;
    payload_bits: number;
    embedder_version: string;
    c2pa_action: C2paActionDescriptor;
}

export interface EmbedReject {
    ok: false;
    error_code: SpectrographicErrorCode;
    message: string;
}

export type EmbedResult = EmbedPass | EmbedReject;

export interface DetectedWatermark {
    layer: WatermarkLayer;
    payload: Uint8Array;                 // raw bits; caller decodes per §2.3 schema
    confidence: number;                  // [0, 1]
}

export interface ExtractResult {
    ok: true;
    detected: DetectedWatermark[];       // empty array when no watermark found
    extractor_version: string;
}

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface StegaStampEmbedder {
    readonly version: string;
    embed(
        bytes: Uint8Array,
        payload_bits: Uint8Array,
        layer: WatermarkLayer
    ): Promise<EmbeddedOutput | null>;
}

export interface EmbeddedOutput {
    bytes: Uint8Array;                   // metadata preserved byte-identical per §2.8
    psnr: number;
}

export interface StegaStampExtractor {
    readonly version: string;
    extract(bytes: Uint8Array): Promise<DetectedWatermark[]>;
}

export interface SpectrographicAuditSink {
    record(event: SpectrographicAuditEvent): void;
}

export interface SpectrographicAuditEvent {
    operation: "embedCreator" | "embedOwner" | "extract";
    file_sha256: string;
    layer: WatermarkLayer | null;
    embedder_version: string | null;
    extractor_version: string | null;
    psnr: number | null;
    payload_bits: number | null;
    detected_count: number | null;
    error_code: SpectrographicErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters
// -------------------------------------------------------------------

export const stubStegaStampEmbedder: StegaStampEmbedder = {
    version: "elanoid-stegastamp-v1",
    async embed(bytes, _payload, _layer) {
        // TODO: replace with real StegaStamp inference. Stub returns input
        // unchanged with high PSNR -- simulating successful imperceptible embed.
        return { bytes: new Uint8Array(bytes), psnr: 60.0 };
    },
};

export const stubStegaStampExtractor: StegaStampExtractor = {
    version: "elanoid-stegastamp-v1",
    async extract(_bytes) {
        // TODO: replace with real StegaStamp decoder.
        return [];
    },
};

export const stubSpectrographicAuditSink: SpectrographicAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const MIN_PSNR_DB = 40.0;                // §2.6 imperceptibility floor
const PAYLOAD_CAPACITY_BITS = 100;       // §2.3 per-layer capacity

// -------------------------------------------------------------------
// Entry points
// -------------------------------------------------------------------

export interface SpectrographicDeps {
    embedder?: StegaStampEmbedder;
    extractor?: StegaStampExtractor;
    audit?: SpectrographicAuditSink;
}

export async function embedCreator(
    file: Uint8Array,
    payload: CreatorPayload,
    deps: SpectrographicDeps = {}
): Promise<EmbedResult> {
    return embedInternal(file, "creator", encodeCreatorPayload(payload), deps);
}

export async function embedOwner(
    file: Uint8Array,
    payload: OwnerPayload,
    deps: SpectrographicDeps = {}
): Promise<EmbedResult> {
    return embedInternal(file, "owner", encodeOwnerPayload(payload), deps);
}

export async function extract(
    file: Uint8Array,
    deps: SpectrographicDeps = {}
): Promise<ExtractResult> {
    const extractor = deps.extractor ?? stubStegaStampExtractor;
    const audit = deps.audit ?? stubSpectrographicAuditSink;
    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    const detected = await extractor.extract(file);

    audit.record({
        operation: "extract",
        file_sha256,
        layer: null,
        embedder_version: null,
        extractor_version: extractor.version,
        psnr: null,
        payload_bits: null,
        detected_count: detected.length,
        error_code: null,
        at,
    });

    return { ok: true, detected, extractor_version: extractor.version };
}

// -------------------------------------------------------------------
// Shared embed implementation
// -------------------------------------------------------------------

async function embedInternal(
    file: Uint8Array,
    layer: WatermarkLayer,
    payload_bytes: Uint8Array,
    deps: SpectrographicDeps
): Promise<EmbedResult> {
    const embedder = deps.embedder ?? stubStegaStampEmbedder;
    const audit = deps.audit ?? stubSpectrographicAuditSink;
    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);
    const op = layer === "creator" ? "embedCreator" : "embedOwner";

    // §1.4 Pre: JPEG or TIFF only
    if (detectMimeByMagicBytes(file) === null) {
        const err = rejectEmbed("INVALID_INPUT_FORMAT", "Input is not JPEG or TIFF.");
        audit.record(auditFail(op, file_sha256, layer, null, embedder.version, err.error_code, at));
        return err;
    }

    // §1.3 Pre: payload <= 100 bits (§2.3)
    const payload_bits = payload_bytes.length * 8;
    if (payload_bits > PAYLOAD_CAPACITY_BITS) {
        const err = rejectEmbed(
            "PAYLOAD_TOO_LARGE",
            `Payload ${payload_bits} bits exceeds ${PAYLOAD_CAPACITY_BITS}-bit capacity.`
        );
        audit.record(auditFail(op, file_sha256, layer, null, embedder.version, err.error_code, at));
        return err;
    }

    let output: EmbeddedOutput | null;
    try {
        output = await embedder.embed(file, payload_bytes, layer);
    } catch {
        const err = rejectEmbed("WATERMARK_EMBED_FAILED", "Embedder threw.");
        audit.record(auditFail(op, file_sha256, layer, null, embedder.version, err.error_code, at));
        return err;
    }

    if (output === null) {
        const err = rejectEmbed("WATERMARK_EMBED_FAILED", "Embedder returned null.");
        audit.record(auditFail(op, file_sha256, layer, null, embedder.version, err.error_code, at));
        return err;
    }

    // §2.6 Imperceptibility envelope
    if (output.psnr < MIN_PSNR_DB) {
        const err = rejectEmbed(
            "IMPERCEPTIBILITY_FAILURE",
            `PSNR ${output.psnr.toFixed(2)} dB below minimum ${MIN_PSNR_DB} dB.`
        );
        audit.record(auditFail(op, file_sha256, layer, output.psnr, embedder.version, err.error_code, at));
        return err;
    }

    audit.record({
        operation: op,
        file_sha256,
        layer,
        embedder_version: embedder.version,
        extractor_version: null,
        psnr: output.psnr,
        payload_bits,
        detected_count: null,
        error_code: null,
        at,
    });

    return {
        ok: true,
        watermarked_file: output.bytes,
        psnr: output.psnr,
        payload_bits,
        embedder_version: embedder.version,
        c2pa_action: {
            action: "c2pa.watermarked",
            softBinding: {
                alg: embedder.version,
                value: bytesToHex(payload_bytes),
            },
            parameters: { layer },
            timestamp: at,
        },
    };
}

function rejectEmbed(error_code: SpectrographicErrorCode, message: string): EmbedReject {
    return { ok: false, error_code, message };
}

function auditFail(
    operation: "embedCreator" | "embedOwner",
    file_sha256: string,
    layer: WatermarkLayer,
    psnr: number | null,
    embedder_version: string,
    error_code: SpectrographicErrorCode,
    at: string
): SpectrographicAuditEvent {
    return {
        operation,
        file_sha256,
        layer,
        embedder_version,
        extractor_version: null,
        psnr,
        payload_bits: null,
        detected_count: null,
        error_code,
        at,
    };
}

// -------------------------------------------------------------------
// Payload encoding (§2.3 schemas; placeholder bit-packing)
// -------------------------------------------------------------------
//
// §2.3 calls for 96 bits of payload + 4 bits FEC = 100 bits per layer.
// The stub here uses a SHA-256 truncation as a placeholder; real implementation
// uses calibrated bit-field allocation + Reed-Solomon FEC (drm_spectrographic OI-09).

function encodeCreatorPayload(p: CreatorPayload): Uint8Array {
    const concat = `creator|${p.master_id}|${p.creator_id}|${p.ingestion_timestamp}`;
    return sha256Bytes(new TextEncoder().encode(concat)).slice(0, 13);  // 13 bytes = 104 bits, rounded
}

function encodeOwnerPayload(p: OwnerPayload): Uint8Array {
    const concat = `owner|${p.deed_id}|${p.owner_wallet}|${p.edition_number}`;
    return sha256Bytes(new TextEncoder().encode(concat)).slice(0, 13);
}

// -------------------------------------------------------------------
// Byte helpers
// -------------------------------------------------------------------

function detectMimeByMagicBytes(bytes: Uint8Array): "image/jpeg" | "image/tiff" | null {
    if (bytes.length < 4) return null;
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
    if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2A && bytes[3] === 0x00) return "image/tiff";
    if (bytes[0] === 0x4D && bytes[1] === 0x4D && bytes[2] === 0x00 && bytes[3] === 0x2A) return "image/tiff";
    return null;
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
