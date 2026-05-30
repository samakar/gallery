// c2pa.ts
// C2PA L1 manifest parse / verify / sign / append.
// Spec: /docs/deferred/drm_c2pa.md (DEFERRED to MMP per revised R71: no C2PA at MVP)
// INV-08: manifest is append-only; nothing is rewritten or removed.
//
// Production runtime: stubC2paToolkit is replaced by a c2pa-node binding
// (Content Authenticity Initiative canonical SDK; wraps c2pa-rs Rust core).
// Repo: https://github.com/contentauth/c2pa-rs
// Dev / test: c2patool CLI for inspection (https://opensource.contentauthenticity.org/docs/c2patool/);
//             c2pa-attacks for tamper testing (https://github.com/contentauth/c2pa-attacks).
// Platform signer registered via the CAI Conformance Program (https://github.com/contentauth).

import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// Public types (contract per §1)
// -------------------------------------------------------------------

export type C2paErrorCode =
    | "MISSING_C2PA"
    | "INVALID_C2PA_SIGNATURE"
    | "AI_GENERATED_CONTENT"
    | "MANIFEST_REWRITE_REJECTED"
    | "INVALID_ACTION"
    | "INVALID_SOFT_BINDING"
    | "SIGNER_KEY_UNAVAILABLE"
    | "C2PA_TOOLKIT_UNAVAILABLE";

// §2.4 Action vocabulary
export type ActionLabel =
    | "c2pa.created"
    | "c2pa.watermarked"
    | "c2pa.transcoded"
    | "c2pa.deed_issued"
    | "c2pa.personalized";

export interface SoftBindingAssertion {
    alg: string;
    value: string;
}

export interface ActionAssertion {
    action: ActionLabel | string;       // schema-validated against ACTION_VOCABULARY
    parameters?: Record<string, unknown>;
    softBinding?: SoftBindingAssertion;
    timestamp?: string;
}

// parseAndVerify

export interface ParseAndVerifyPass {
    ok: true;
    manifest_present: true;
    signature_valid: true;
    integrity_valid: true;
    signer: string;
    tool_chain: string[];
    action_chain: ActionAssertion[];
    ai_detected: false;
}

// signManifest

export interface SignManifestPass {
    ok: true;
    signed_file: Uint8Array;
    manifest_hash: string;
    signer_certificate: string;
}

// appendAction

export interface AppendActionPass {
    ok: true;
    signed_file: Uint8Array;
    manifest_hash: string;
    action_index: number;
}

export interface C2paReject {
    ok: false;
    error_code: C2paErrorCode;
    message: string;
}

export type ParseAndVerifyResult = ParseAndVerifyPass | C2paReject;
export type SignManifestResult = SignManifestPass | C2paReject;
export type AppendActionResult = AppendActionPass | C2paReject;

// -------------------------------------------------------------------
// Injectable dependencies
// -------------------------------------------------------------------

export interface C2paToolkit {
    readonly version: string;
    parse(bytes: Uint8Array): Promise<ParsedManifest | null>;
    verifySignature(manifest: ParsedManifest, trust: TrustList): Promise<SignatureVerification>;
    sign(
        file: Uint8Array,
        actions: ActionAssertion[],
        signer_certificate: string,
        signer_key: SignerKey
    ): Promise<SignedFile>;
    append(
        file: Uint8Array,
        action: ActionAssertion,
        signer_certificate: string,
        signer_key: SignerKey
    ): Promise<AppendedFile | null>;
}

export interface ParsedManifest {
    signer: string;
    tool_chain: string[];                // claim_generator strings
    action_chain: ActionAssertion[];
    integrity_valid: boolean;
}

export interface SignatureVerification {
    signature_valid: boolean;
    signer_on_trust_list: boolean;
}

export interface SignedFile {
    bytes: Uint8Array;
    manifest_hash: string;
}

export interface AppendedFile {
    bytes: Uint8Array;
    manifest_hash: string;
    action_index: number;
    prior_actions_unchanged: boolean;    // INV-08 enforcement signal
}

export interface TrustList {
    readonly version: string;
    isAccepted(signer: string): boolean;
}

export interface SignerKey {
    readonly certificate: string;        // fingerprint of platform cert (key custody via secrets subsystem)
}

export interface AiGeneratorRegistry {
    isGenerativeAi(claim_generator: string): boolean;
}

export interface C2paAuditSink {
    record(event: C2paAuditEvent): void;
}

export interface C2paAuditEvent {
    operation: "parseAndVerify" | "signManifest" | "appendAction";
    file_sha256: string;
    manifest_hash: string | null;
    signer: string | null;
    action_added: string | null;
    error_code: C2paErrorCode | null;
    at: string;
}

// -------------------------------------------------------------------
// Stub adapters
// -------------------------------------------------------------------

export const stubC2paToolkit: C2paToolkit = {
    version: "stub-c2pa-node-0.0.0",
    async parse(_bytes) {
        // TODO: replace with c2pa-node (CAI canonical SDK; wraps c2pa-rs).
        // https://github.com/contentauth/c2pa-rs
        // Stub: pretend no manifest is embedded so the gate reliably triggers
        // MISSING_C2PA path until wired.
        return null;
    },
    async verifySignature(_m, _t) {
        return { signature_valid: true, signer_on_trust_list: true };
    },
    async sign(file, _actions, _cert, _key) {
        return {
            bytes: new Uint8Array(file),
            manifest_hash: `stub-manifest-${sha256Hex(file).slice(0, 16)}`,
        };
    },
    async append(file, _action, _cert, _key) {
        return {
            bytes: new Uint8Array(file),
            manifest_hash: `stub-manifest-${sha256Hex(file).slice(0, 16)}`,
            action_index: 1,
            prior_actions_unchanged: true,
        };
    },
};

export const stubTrustList: TrustList = {
    version: "stub-trustlist-0.0.0",
    isAccepted(_signer) { return true; },
};

export const stubSignerKey: SignerKey = {
    certificate: "stub-elanoid-platform-cert",
};

export const stubAiGeneratorRegistry: AiGeneratorRegistry = {
    isGenerativeAi(claim_generator) {
        const known = [
            "midjourney", "dall-e", "stable diffusion", "stable-diffusion",
            "flux", "imagen", "leonardo", "firefly",
        ];
        const g = claim_generator.toLowerCase();
        return known.some(k => g.includes(k));
    },
};

export const stubC2paAuditSink: C2paAuditSink = {
    record(_event) { /* TODO: route to observability subsystem */ },
};

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const ACTION_VOCABULARY = new Set<string>([
    "c2pa.created",
    "c2pa.watermarked",
    "c2pa.transcoded",
    "c2pa.deed_issued",
    "c2pa.personalized",
]);

// -------------------------------------------------------------------
// Entry points
// -------------------------------------------------------------------

export interface C2paDeps {
    toolkit?: C2paToolkit;
    trust_list?: TrustList;
    signer_key?: SignerKey;
    ai_registry?: AiGeneratorRegistry;
    audit?: C2paAuditSink;
}

export async function parseAndVerify(
    file: Uint8Array,
    deps: C2paDeps = {}
): Promise<ParseAndVerifyResult> {
    const toolkit = deps.toolkit ?? stubC2paToolkit;
    const trust = deps.trust_list ?? stubTrustList;
    const aiRegistry = deps.ai_registry ?? stubAiGeneratorRegistry;
    const audit = deps.audit ?? stubC2paAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    let manifest: ParsedManifest | null;
    try {
        manifest = await toolkit.parse(file);
    } catch {
        return emit(audit, "parseAndVerify", file_sha256, null, null, null, "C2PA_TOOLKIT_UNAVAILABLE", "Toolkit threw on parse.", at);
    }

    if (manifest === null) {
        return emit(audit, "parseAndVerify", file_sha256, null, null, null, "MISSING_C2PA", "No manifest embedded.", at);
    }

    const verification = await toolkit.verifySignature(manifest, trust);

    if (!manifest.integrity_valid) {
        return emit(audit, "parseAndVerify", file_sha256, null, manifest.signer, null, "INVALID_C2PA_SIGNATURE", "Manifest integrity check failed.", at);
    }
    if (!verification.signature_valid) {
        return emit(audit, "parseAndVerify", file_sha256, null, manifest.signer, null, "INVALID_C2PA_SIGNATURE", "Signature does not verify.", at);
    }
    if (!verification.signer_on_trust_list) {
        return emit(audit, "parseAndVerify", file_sha256, null, manifest.signer, null, "INVALID_C2PA_SIGNATURE", "Signer not on trust list.", at);
    }

    const aiInToolChain = manifest.tool_chain.some(g => aiRegistry.isGenerativeAi(g));
    const aiInActions = manifest.action_chain.some(a => a.action === "c2pa.ai.generated");
    if (aiInToolChain || aiInActions) {
        return emit(audit, "parseAndVerify", file_sha256, null, manifest.signer, null, "AI_GENERATED_CONTENT", "Generative-AI generator detected in tool chain or action chain.", at);
    }

    audit.record({
        operation: "parseAndVerify",
        file_sha256,
        manifest_hash: null,
        signer: manifest.signer,
        action_added: null,
        error_code: null,
        at,
    });

    return {
        ok: true,
        manifest_present: true,
        signature_valid: true,
        integrity_valid: true,
        signer: manifest.signer,
        tool_chain: manifest.tool_chain,
        action_chain: manifest.action_chain,
        ai_detected: false,
    };
}

export interface SignManifestInputs {
    file: Uint8Array;
    creator_id: string;
    master_id: string;
    watermark_action: ActionAssertion;   // from spectrographic.embedCreator c2pa_action
    signing_event_id: string;            // from esign subsystem (Image Signing Affirmation)
}

export async function signManifest(
    inputs: SignManifestInputs,
    deps: C2paDeps = {}
): Promise<SignManifestResult> {
    const toolkit = deps.toolkit ?? stubC2paToolkit;
    const signerKey = deps.signer_key ?? stubSignerKey;
    const audit = deps.audit ?? stubC2paAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(inputs.file);

    if (!signerKey.certificate) {
        return emit(audit, "signManifest", file_sha256, null, null, null, "SIGNER_KEY_UNAVAILABLE", "Platform signing key not available.", at);
    }

    if (!validateActionSchema(inputs.watermark_action)) {
        return emit(audit, "signManifest", file_sha256, null, signerKey.certificate, inputs.watermark_action.action, "INVALID_ACTION", `Action ${inputs.watermark_action.action} fails schema validation.`, at);
    }
    if (inputs.watermark_action.softBinding && !validateSoftBinding(inputs.watermark_action.softBinding)) {
        return emit(audit, "signManifest", file_sha256, null, signerKey.certificate, inputs.watermark_action.action, "INVALID_SOFT_BINDING", "softBinding fails C2PA 2.4 schema.", at);
    }

    // §2.2 Initial action chain: c2pa.created + c2pa.watermarked
    const actions: ActionAssertion[] = [
        {
            action: "c2pa.created",
            parameters: {
                creator_id: inputs.creator_id,
                master_id: inputs.master_id,
                signing_event_id: inputs.signing_event_id,
            },
            timestamp: at,
        },
        inputs.watermark_action,
    ];

    let signed: SignedFile;
    try {
        signed = await toolkit.sign(inputs.file, actions, signerKey.certificate, signerKey);
    } catch {
        return emit(audit, "signManifest", file_sha256, null, signerKey.certificate, null, "C2PA_TOOLKIT_UNAVAILABLE", "Toolkit threw on sign.", at);
    }

    audit.record({
        operation: "signManifest",
        file_sha256,
        manifest_hash: signed.manifest_hash,
        signer: signerKey.certificate,
        action_added: "c2pa.created+c2pa.watermarked",
        error_code: null,
        at,
    });

    return {
        ok: true,
        signed_file: signed.bytes,
        manifest_hash: signed.manifest_hash,
        signer_certificate: signerKey.certificate,
    };
}

export async function appendAction(
    file: Uint8Array,
    action: ActionAssertion,
    deps: C2paDeps = {}
): Promise<AppendActionResult> {
    const toolkit = deps.toolkit ?? stubC2paToolkit;
    const signerKey = deps.signer_key ?? stubSignerKey;
    const audit = deps.audit ?? stubC2paAuditSink;

    const at = new Date().toISOString();
    const file_sha256 = sha256Hex(file);

    if (!signerKey.certificate) {
        return emit(audit, "appendAction", file_sha256, null, null, action.action, "SIGNER_KEY_UNAVAILABLE", "Platform signing key not available.", at);
    }

    if (!validateActionSchema(action)) {
        return emit(audit, "appendAction", file_sha256, null, signerKey.certificate, action.action, "INVALID_ACTION", `Action ${action.action} not in §2.4 vocabulary.`, at);
    }

    if (action.softBinding && !validateSoftBinding(action.softBinding)) {
        return emit(audit, "appendAction", file_sha256, null, signerKey.certificate, action.action, "INVALID_SOFT_BINDING", "softBinding fails C2PA 2.4 schema.", at);
    }

    let appended: AppendedFile | null;
    try {
        appended = await toolkit.append(file, action, signerKey.certificate, signerKey);
    } catch {
        return emit(audit, "appendAction", file_sha256, null, signerKey.certificate, action.action, "C2PA_TOOLKIT_UNAVAILABLE", "Toolkit threw on append.", at);
    }

    if (appended === null) {
        return emit(audit, "appendAction", file_sha256, null, signerKey.certificate, action.action, "C2PA_TOOLKIT_UNAVAILABLE", "Toolkit returned null on append.", at);
    }

    if (!appended.prior_actions_unchanged) {
        return emit(audit, "appendAction", file_sha256, null, signerKey.certificate, action.action, "MANIFEST_REWRITE_REJECTED", "Append would mutate prior actions (INV-08 violation).", at);
    }

    audit.record({
        operation: "appendAction",
        file_sha256,
        manifest_hash: appended.manifest_hash,
        signer: signerKey.certificate,
        action_added: action.action,
        error_code: null,
        at,
    });

    return {
        ok: true,
        signed_file: appended.bytes,
        manifest_hash: appended.manifest_hash,
        action_index: appended.action_index,
    };
}

// -------------------------------------------------------------------
// Validation helpers
// -------------------------------------------------------------------

function validateActionSchema(action: ActionAssertion): boolean {
    if (!action.action || typeof action.action !== "string") return false;
    return ACTION_VOCABULARY.has(action.action);
}

function validateSoftBinding(sb: SoftBindingAssertion): boolean {
    return typeof sb.alg === "string" && sb.alg.length > 0
        && typeof sb.value === "string" && sb.value.length > 0;
}

function emit(
    audit: C2paAuditSink,
    operation: "parseAndVerify" | "signManifest" | "appendAction",
    file_sha256: string,
    manifest_hash: string | null,
    signer: string | null,
    action_added: string | null,
    error_code: C2paErrorCode,
    message: string,
    at: string
): C2paReject {
    audit.record({ operation, file_sha256, manifest_hash, signer, action_added, error_code, at });
    return { ok: false, error_code, message };
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
