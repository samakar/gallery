// crossmint_dispatch.ts
// Mint deed via Crossmint Minting API.
// Spec: /docs/registry/crossmint_dispatch.md

// TODO: import { getDeedRightsParams } from '../commerce/rights';

export type CrossmintDispatchErrorCode =
    | "CROSSMINT_DISPATCH_FAILED"
    | "MINT_PARAMS_INVALID";

export interface DispatchInput {
    image_id: string;
    buyer_wallet_pubkey: string;
    arweave_uri: string;
    sha256: string;
    enc_final: string;
    license_signing_event_id: string;
}

export type DispatchResult =
    | { ok: true; crossmint_job_id: string }
    | { ok: false; error_code: CrossmintDispatchErrorCode; message: string };

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!input.arweave_uri || !input.sha256 || !input.enc_final || !input.license_signing_event_id) {
        return {
            ok: false,
            error_code: "MINT_PARAMS_INVALID",
            message: "Missing required mint payload field.",
        };
    }
    // TODO: const rights = await getDeedRightsParams(input.image_id)
    // TODO: build Crossmint mint metadata per R71 §3.3:
    //   recipient: solana:<buyer_wallet_pubkey>
    //   metadata: { name, image, attributes, properties: {
    //     arweave_master_uri, enc_final, deed_state: 'sealed',
    //     royalty_pct: rights.royalty_pct,
    //     royalty_recipients: rights.royalty_recipients,
    //     variant_hashes: { M+00: { sha256, anchored_at: <mint_tx_block_time> } },
    //     license_acceptance_signing_event_id: input.license_signing_event_id
    //   }}
    // TODO: POST to Crossmint Minting API with process.env.CROSSMINT_API_KEY
    // TODO: return crossmint_job_id from response; terminal state arrives via webhook
    return {
        ok: false,
        error_code: "CROSSMINT_DISPATCH_FAILED",
        message: "Crossmint Minting API not yet wired.",
    };
}
