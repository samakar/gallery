// crossmint_dispatch.ts
// Mint the deed NFT via Crossmint's Minting API.
// Spec: /docs/registry/crossmint_dispatch.md
//
// At MVP we use the `default-solana` auto-collection so no Collection
// provisioning step is needed. Set CROSSMINT_COLLECTION_ID in .env to send
// mints to a specific (branded) collection instead.
//
// Staging dispatches to Solana devnet -- mints appear at:
//   https://solscan.io/token/<mint_address>?cluster=devnet
// or in the Crossmint staging dashboard.

const CROSSMINT_BASE_URL =
    process.env.CROSSMINT_BASE_URL ?? 'https://staging.crossmint.com';

// Crossmint deprecated the `default-solana` shortcut; collections must now be
// explicit. We auto-create one on first dispatch when CROSSMINT_COLLECTION_ID
// is missing, cache it in-process for the rest of the run, and print the id so
// the operator can paste it into .env (otherwise a new collection is created
// each restart -- functional, but visually noisy on the dashboard).
let cachedCollectionId: string | null = null;

async function ensureCollectionId(): Promise<string> {
    const fromEnv = process.env.CROSSMINT_COLLECTION_ID;
    if (fromEnv) return fromEnv;
    if (cachedCollectionId) return cachedCollectionId;

    const apiKey = process.env.CROSSMINT_API_KEY;
    if (!apiKey) throw new Error('CROSSMINT_API_KEY is not set');
    const url = `${CROSSMINT_BASE_URL}/api/2022-06-09/collections`;
    const body = {
        chain: 'solana',
        metadata: {
            name: 'Epimage Deeds',
            description: 'Deeds of ownership for Epimage photographs.',
            symbol: 'EPIM',
            // Symbol/name placeholders; revisit when going to prod.
        },
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': apiKey,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`COLLECTION_CREATE_FAILED: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json() as { id?: string };
    if (!data.id) {
        throw new Error('COLLECTION_CREATE_FAILED: response missing id');
    }
    cachedCollectionId = data.id;
    console.warn(
        '\n[crossmint] CROSSMINT_COLLECTION_ID not set. Auto-created a staging ' +
        'collection -- paste this line into .env to reuse on subsequent restarts:\n' +
        `CROSSMINT_COLLECTION_ID=${data.id}\n`
    );
    return cachedCollectionId;
}

export interface DispatchInput {
    image_id: string;
    buyer_wallet: string | null;  // Solana base58, if we have one
    buyer_email: string;          // Fallback recipient -- Crossmint provisions a wallet for the email
    title: string;
    description: string;
    creator_display_name: string;
    preview_url: string;          // Cloudinary listing preview (or Arweave URI when wired)
    arweave_uri: string | null;   // Arweave URI of encrypted Master per R62 §2.3
    sha256: string | null;        // canonical-pixels sha256
    phash: string | null;         // perceptual hash from Card 1 uniqueness gate
    enc_final: string | null;     // base64 enc_final per R62 §2.3; null until buyer wallet is real
    license_signing_event_id: string | null; // per-image License Acceptance signature id
    royalty_pct: number;
    creator_wallet: string | null;
}

// Solana base58 addresses are 32-44 chars from this alphabet. EVM addresses
// (0x-prefixed hex) and Magic placeholder strings won't match.
function looksLikeSolanaAddress(s: string | null): boolean {
    if (!s) return false;
    if (s.startsWith('0x')) return false;
    if (s.length < 32 || s.length > 44) return false;
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

export type DispatchResult =
    | { ok: true; crossmint_job_id: string; onchain_status: string }
    | { ok: false; error_code: 'CROSSMINT_DISPATCH_FAILED' | 'MINT_PARAMS_INVALID'; message: string };

// POST to Crossmint Minting API. Returns immediately with the job id; the
// terminal mint_address arrives via crossmint_webhook (or via polling the
// status endpoint as a local-dev fallback).
export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
    const apiKey = process.env.CROSSMINT_API_KEY;
    if (!apiKey) {
        return {
            ok: false,
            error_code: 'CROSSMINT_DISPATCH_FAILED',
            message: 'CROSSMINT_API_KEY is not set -- add it to .env per .env.example.',
        };
    }
    let collectionId: string;
    try {
        collectionId = await ensureCollectionId();
    } catch (e) {
        return {
            ok: false,
            error_code: 'CROSSMINT_DISPATCH_FAILED',
            message: (e as Error)?.message ?? String(e),
        };
    }
    const url = `${CROSSMINT_BASE_URL}/api/2022-06-09/collections/${collectionId}/nfts`;

    // Prefer the buyer's Solana wallet when we have a valid one; otherwise
    // fall back to email-recipient -- Crossmint provisions a Solana wallet on
    // first mint and reuses it on subsequent ones (claimable by the buyer
    // later from their Crossmint account). Works while Magic's Solana wallet
    // provisioning is in flux.
    const recipient = looksLikeSolanaAddress(input.buyer_wallet)
        ? `solana:${input.buyer_wallet}`
        : `email:${input.buyer_email}:solana`;

    const body = {
        recipient,
        metadata: {
            name: input.title,
            description: input.description || `Unique edition by ${input.creator_display_name}`,
            image: input.preview_url,
            attributes: [
                { trait_type: 'creator', value: input.creator_display_name },
                { trait_type: 'image_id', value: input.image_id },
                { trait_type: 'edition', value: '1 of 1' },
            ],
            properties: {
                // Spec § 2.1 calls for these. At MVP some are null because the
                // Arweave + ESIGN subsystems aren't wired yet -- include them
                // anyway so the NFT carries the schema even when values are
                // placeholder, and so the swap to real values is a no-op once
                // those subsystems land.
                arweave_master_uri: input.arweave_uri,
                enc_final: input.enc_final,
                deed_state: 'sealed',
                royalty_pct: input.royalty_pct,
                royalty_recipients: input.creator_wallet
                    ? [{ address: input.creator_wallet, share: 100 }]
                    : [],
                variant_hashes: {
                    'M+00': { sha256: input.sha256, phash: input.phash },
                },
                license_acceptance_signing_event_id: input.license_signing_event_id,
            },
        },
    };

    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey,
            },
            body: JSON.stringify(body),
        });
    } catch (e) {
        return {
            ok: false,
            error_code: 'CROSSMINT_DISPATCH_FAILED',
            message: `network: ${(e as Error)?.message ?? 'unknown'}`,
        };
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
            ok: false,
            error_code: 'CROSSMINT_DISPATCH_FAILED',
            message: `${res.status} ${text.slice(0, 200)}`,
        };
    }
    const result = await res.json() as {
        id?: string;
        onChain?: { status?: string };
    };
    if (!result.id) {
        return {
            ok: false,
            error_code: 'CROSSMINT_DISPATCH_FAILED',
            message: 'response missing job id',
        };
    }
    return {
        ok: true,
        crossmint_job_id: result.id,
        onchain_status: result.onChain?.status ?? 'pending',
    };
}

// Look up the current state of a mint job. Used by the polling-fallback path
// when a webhook hasn't (or won't) arrive. Returns mint_address +
// transaction_signature once Crossmint reports success.
export interface LookupResult {
    status: 'pending' | 'success' | 'failed';
    mint_address: string | null;
    transaction_signature: string | null;
    owner: string | null;
    failure_reason: string | null;
}

export async function lookupJob(crossmint_job_id: string): Promise<LookupResult> {
    const apiKey = process.env.CROSSMINT_API_KEY;
    if (!apiKey) throw new Error('CROSSMINT_API_KEY is not set');
    const collectionId = await ensureCollectionId();
    const url = `${CROSSMINT_BASE_URL}/api/2022-06-09/collections/${collectionId}/nfts/${crossmint_job_id}`;
    const res = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`CROSSMINT_LOOKUP_FAILED: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json() as {
        onChain?: {
            status?: string;
            mintHash?: string;
            txHash?: string;
            owner?: string;
        };
        actionFailReason?: string;
    };
    const onChain = data.onChain ?? {};
    let status: LookupResult['status'] = 'pending';
    if (onChain.status === 'success') status = 'success';
    else if (onChain.status === 'failed' || data.actionFailReason) status = 'failed';
    return {
        status,
        mint_address: onChain.mintHash ?? null,
        transaction_signature: onChain.txHash ?? null,
        owner: onChain.owner ?? null,
        failure_reason: data.actionFailReason ?? null,
    };
}
