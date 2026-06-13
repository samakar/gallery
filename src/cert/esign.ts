// esign.ts
// MVP ESIGN clickwrap capture for the four signature artifacts per INV-2:
// CMA, MJA, ISA, License Acceptance. Each signature precedes the entity it
// admits.
// Spec: /docs/cert/esign.md
//
// ESIGN does not template -- the caller supplies fully-rendered text (CMA
// personalized with legal identity; License Acceptance personalized per-image
// via rights). This module hashes, records the click, returns the
// signing_event_id.

import { createHash } from 'node:crypto';
import { prisma } from '../db';

export type DocumentType =
    | "CMA"   // Creator Master Agreement -- creator-platform, signed at sign-cma
    | "MJA"   // Master Joint Agreement -- buyer-platform, signed at first purchase
    | "COA"   // Certificate of Authenticity -- per-image creator attestation (was IMAGE_SIGNING_AFFIRMATION pre-MVP)
    | "SAL"   // Sales Agreement -- per-image bilateral sale + use license (was LICENSE_ACCEPTANCE pre-MVP)
    | "DLN";  // Master Download Notice -- buyer's pre-download consent, gates sealed -> unsealed

export type EsignErrorCode =
    | "ESIGN_DOCUMENT_REQUIRED"
    | "ESIGN_BUNDLE_PARTIAL_FAILURE";

export interface ClickEvent {
    ip_address: string;
    session_token_hash: string;       // sha256 of the DID token used to authorize
    clicked_at: string;               // ISO 8601 UTC; server-time at insert
}

export interface SignatureInput {
    user_id: string;                  // identity-verified
    document_type: DocumentType;
    document_text: string;            // fully rendered; sha256 -> document_version_hash
    document_version_label: string;   // e.g., "CMA-v1.0"
    image_id: string | null;          // required for COA + SAL + DLN (per-image documents)
    click: ClickEvent;
}

export interface SignatureRow {
    signing_event_id: string;         // UUID; signatures.id (R71 §3.6)
    document_version_hash: string;    // sha256 hex of document_text
}

export type CaptureResult =
    | { ok: true; row: SignatureRow }
    | { ok: false; error_code: EsignErrorCode; message: string };

export type BundleResult =
    | { ok: true; mja: SignatureRow; license: SignatureRow }
    | { ok: false; error_code: EsignErrorCode; message: string };

// Single-document capture (R71 §3.7 rows 4, 7, 16). Optional `client` lets
// a caller pass a Prisma transaction client (`prisma.$transaction(async tx
// => ...)`) so the signature write participates in the caller's transaction
// instead of competing for the DB connection on its own. Defaults to the
// global client for standalone captures.
type SignatureClient = { signature: { create: (args: any) => Promise<any> } };
export async function captureSignature(
    input: SignatureInput,
    client: SignatureClient = prisma,
): Promise<CaptureResult> {
    const hash = sha256Hex(input.document_text);
    const row = await client.signature.create({ data: toSignatureData(input, hash) });
    // INV-2: wallet provisioning fires post-CMA/MJA via identity.provisionWalletIfMissing
    // (TODO: wire when Magic admin SDK is in; identity.ts is still TODO on that surface).
    return { ok: true, row: { signing_event_id: row.id, document_version_hash: hash } };
}

// Atomic MJA + License Acceptance bundle for first-purchase (R71 §2.4 step 4).
// Both rows commit under one Prisma transaction or neither -- partial failure
// rolls both back.
export async function bundleSign(mja: SignatureInput, license: SignatureInput): Promise<BundleResult> {
    const mjaHash = sha256Hex(mja.document_text);
    const licenseHash = sha256Hex(license.document_text);
    try {
        const [mjaRow, licenseRow] = await prisma.$transaction([
            prisma.signature.create({ data: toSignatureData(mja, mjaHash) }),
            prisma.signature.create({ data: toSignatureData(license, licenseHash) }),
        ]);
        // TODO: identity.provisionWalletIfMissing(mja.user_id) post-commit (INV-2)
        return {
            ok: true,
            mja: { signing_event_id: mjaRow.id, document_version_hash: mjaHash },
            license: { signing_event_id: licenseRow.id, document_version_hash: licenseHash },
        };
    } catch {
        return {
            ok: false,
            error_code: 'ESIGN_BUNDLE_PARTIAL_FAILURE',
            message: 'Bundle transaction rolled back.',
        };
    }
}

function toSignatureData(input: SignatureInput, document_version_hash: string) {
    return {
        user_id: input.user_id,
        document_type: input.document_type,
        document_version_hash,
        document_version_label: input.document_version_label,
        image_id: input.image_id,
        clicked_at: new Date(input.click.clicked_at),
        ip_address: input.click.ip_address,
        session_token_hash: input.click.session_token_hash,
    };
}

function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}
