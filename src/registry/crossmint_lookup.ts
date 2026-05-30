// crossmint_lookup.ts
// NFT ownership lookup via Crossmint NFT API.
// Spec: /docs/registry/crossmint_lookup.md
//
// Used by Commerce's renderer for per-request ownership gating on deed-holder
// Share Copy downloads. No direct Solana RPC at MVP (Crossmint internalizes).

export type LookupErrorCode = "CROSSMINT_LOOKUP_FAILED" | "NFT_NOT_FOUND";

export type LookupResult =
    | { ok: true; current_owner_wallet: string }
    | { ok: false; error_code: LookupErrorCode; message: string };

export async function getOwner(_mint_address: string): Promise<LookupResult> {
    // TODO: GET Crossmint NFT lookup endpoint with mint_address
    //       auth: process.env.CROSSMINT_API_KEY
    // TODO: retries: 3 attempts with exponential backoff (1s/4s/16s)
    // TODO: on 404 -> NFT_NOT_FOUND
    // TODO: on retries exhausted -> CROSSMINT_LOOKUP_FAILED
    // TODO: extract owner wallet from response; return current_owner_wallet
    return {
        ok: false,
        error_code: "CROSSMINT_LOOKUP_FAILED",
        message: "Crossmint NFT API not yet wired.",
    };
}
