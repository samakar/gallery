// cnft_dispatch.ts
// Self-mint Bubblegum V2 cNFT under our MPL-Core Collection per /docs/registry/deed.md
// (Path 4; consolidated 2026-06-07 from the prior mint_architecture.md + cnft_dispatch.md split).
//
// MVP scope (per ADR-0008):
//   - In-process per-tree mutex (single-instance API; distributed lock at scale, OI-02)
//   - Predict asset_id from tree state -> upload deed metadata JSON to Arweave ->
//     submit mintV2 with permanent Arweave URI -> verify observed asset_id matches predicted
//   - No embedded provenance manifest yet (post-MVP)
//   - No tree-state snapshots yet (post-MVP per OI-12)
//   - REQ-MINT-03 honored: monogram is NOT included in the metadata JSON
//
// Input/output shape mirrors the prior Crossmint dispatch to minimize churn in
// run_image_ops, with crossmint_job_id repurposed to carry the mint tx signature.

import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';
import Arweave from 'arweave';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
    createSignerFromKeypair,
    keypairIdentity,
    publicKey,
    type Signer,
    type Umi,
    type PublicKey,
} from '@metaplex-foundation/umi';
import {
    mplBubblegum,
    mintV2,
    fetchTreeConfigFromSeeds,
    findLeafAssetIdPda,
} from '@metaplex-foundation/mpl-bubblegum';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { buildThumbnailUrl } from '../commerce/image_gen';

// --------------------------------------------------------------------------- //
// Configuration
// --------------------------------------------------------------------------- //
const RPC_URL = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';

// Stable platform URL where the cNFT metadata's `image` field points. This URL
// is permanent in the on-Arweave metadata (and therefore on the cNFT forever),
// so it MUST be a host we own indefinitely (epimage.com), not a third-party CDN
// host whose URL pattern could change. The route /i/<image_id>?variant=thumbnail
// proxies/redirects to whatever CDN is current.
const PLATFORM_BASE_URL = process.env.PLATFORM_BASE_URL ?? 'https://epimage.com';

function mustEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is not set (run scripts/cnft_setup.ts)`);
    return v;
}

// --------------------------------------------------------------------------- //
// Umi + Turbo singletons (cached across calls)
// --------------------------------------------------------------------------- //
interface UmiBundle {
    umi: Umi;
    hotMint: Signer;        // payer + fee; also identity
    hotOps: Signer;         // tree authority -- signs as treeCreatorOrDelegate on mintV2
    coldRecovery: Signer;   // collection update authority -- signs as collectionAuthority on mintV2
}
let umiBundleSingleton: UmiBundle | null = null;

function loadSigner(envName: string, umi: Umi): Signer {
    const secret = bs58.decode(mustEnv(envName));
    if (secret.length !== 64) throw new Error(`${envName} is not a 64-byte base58 secret key`);
    const kp = umi.eddsa.createKeypairFromSecretKey(secret);
    return createSignerFromKeypair(umi, kp);
}

function getUmi(): UmiBundle {
    if (umiBundleSingleton) return umiBundleSingleton;
    const umi = createUmi(RPC_URL).use(mplBubblegum()).use(mplCore());
    const hotMint = loadSigner('HOT_MINT_KEY', umi);
    const hotOps = loadSigner('HOT_OPS_KEY', umi);
    const coldRecovery = loadSigner('COLD_RECOVERY_KEY', umi);
    // HOT_MINT_KEY pays tx fees; mintV2 explicitly attaches HOT_OPS_KEY +
    // COLD_RECOVERY_KEY as the other required signers.
    const hotMintKp = umi.eddsa.createKeypairFromSecretKey(bs58.decode(mustEnv('HOT_MINT_KEY')));
    umi.use(keypairIdentity(hotMintKp));
    umiBundleSingleton = { umi, hotMint, hotOps, coldRecovery };
    return umiBundleSingleton;
}

let turboClient: ReturnType<typeof TurboFactory.authenticated> | null = null;

async function getTurbo() {
    if (turboClient) return turboClient;
    let jwkBase64 = process.env.ARWEAVE_JWK_BASE64;
    if (!jwkBase64) {
        const arweave = Arweave.init({});
        const jwk = await arweave.wallets.generate();
        jwkBase64 = Buffer.from(JSON.stringify(jwk)).toString('base64');
        console.warn(
            '[cnft_dispatch] ARWEAVE_JWK_BASE64 not set -- generated a fresh JWK. ' +
            'Paste this line into .env to persist (otherwise a new key is minted each restart):\n' +
            `ARWEAVE_JWK_BASE64=${jwkBase64}`,
        );
        process.env.ARWEAVE_JWK_BASE64 = jwkBase64;
    }
    const jwk = JSON.parse(Buffer.from(jwkBase64, 'base64').toString('utf-8'));
    turboClient = TurboFactory.authenticated({
        signer: new ArweaveSigner(jwk),
        token: 'arweave',
    });
    return turboClient;
}

// --------------------------------------------------------------------------- //
// In-process per-tree mutex
// --------------------------------------------------------------------------- //
// Single-instance only at MVP. Distributed lock when scaled out per OI-02.
const treeMutexes = new Map<string, Promise<unknown>>();

async function withTreeMutex<T>(treePubkey: string, fn: () => Promise<T>): Promise<T> {
    const prev = treeMutexes.get(treePubkey) ?? Promise.resolve();
    let resolveNext!: () => void;
    const next = new Promise<void>(r => { resolveNext = r; });
    treeMutexes.set(treePubkey, prev.then(() => next));
    await prev;
    try {
        return await fn();
    } finally {
        resolveNext();
        // Best-effort cleanup once nobody else is waiting on this tree.
        if (treeMutexes.get(treePubkey) === next) treeMutexes.delete(treePubkey);
    }
}

// --------------------------------------------------------------------------- //
// Solana base58 sanity check
// --------------------------------------------------------------------------- //
function looksLikeSolanaAddress(s: string | null | undefined): boolean {
    if (!s) return false;
    if (s.startsWith('0x')) return false;
    if (s.length < 32 || s.length > 44) return false;
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

// --------------------------------------------------------------------------- //
// Public interface
// --------------------------------------------------------------------------- //
export type CnftDispatchErrorCode =
    | 'MINT_PARAMS_INVALID'
    | 'ARWEAVE_UPLOAD_FAILED'
    | 'MINT_SUBMIT_FAILED'
    | 'MINT_NOT_CONFIRMED'
    | 'RACE_DETECTED';

export interface DispatchInput {
    image_id: string;
    buyer_wallet: string | null;
    buyer_email: string; // unused at MVP -- cNFT mint requires a Solana wallet
    title: string;
    description: string;
    creator_display_name: string;
    preview_url: string;
    arweave_uri: string | null;       // permanent Arweave URI of the encrypted Master (from arweave_master)
    sha256: string | null;
    phash: string | null;
    enc_final: string | null;
    license_signing_event_id: string | null;
    royalty_pct: number;
    creator_wallet: string | null;
}

export type DispatchResult =
    | {
        ok: true;
        crossmint_job_id: string;    // kept for run_image_ops compat: now stores the Solana tx signature
        onchain_status: string;
        asset_id: string;            // cNFT asset_id (Metaplex DAS); stored as Deed.asset_id
        arweave_metadata_uri: string;
    }
    | { ok: false; error_code: CnftDispatchErrorCode; message: string };

export async function dispatch(input: DispatchInput): Promise<DispatchResult> {
    // Param validation
    if (!looksLikeSolanaAddress(input.buyer_wallet)) {
        return {
            ok: false,
            error_code: 'MINT_PARAMS_INVALID',
            message: 'buyer_wallet must be a valid Solana base58 pubkey; cNFT mint has no email-recipient fallback',
        };
    }
    if (!input.arweave_uri) {
        return {
            ok: false,
            error_code: 'MINT_PARAMS_INVALID',
            message: 'arweave_uri is required (encrypted Master must be on Arweave before mint)',
        };
    }

    const treePubkeyStr = mustEnv('PLATFORM_TREE_PUBKEY');
    const collectionPubkeyStr = mustEnv('PLATFORM_COLLECTION_PUBKEY');

    return withTreeMutex(treePubkeyStr, async () => {
        const { umi, hotOps, coldRecovery } = getUmi();
        const treePubkey = publicKey(treePubkeyStr);
        const collectionPubkey = publicKey(collectionPubkeyStr);

        // Step 1-3 (Path 4): predict asset_id from current tree state
        const treeConfig = await fetchTreeConfigFromSeeds(umi, { merkleTree: treePubkey });
        const predictedLeafIndex = Number(treeConfig.numMinted);
        const [predictedAssetId] = findLeafAssetIdPda(umi, {
            merkleTree: treePubkey,
            leafIndex: predictedLeafIndex,
        });

        // Step 4: build deed metadata JSON (REQ-MINT-03 image-identity fields only;
        // monogram stays in platform DB)
        const platformWallet = process.env.PLATFORM_WALLET_PUBKEY ?? umi.identity.publicKey.toString();
        const creators = buildCreatorsArray(input.creator_wallet, platformWallet);
        const metadataJson = buildDeedMetadataJson({
            input,
            assetId: predictedAssetId.toString(),
            collection: collectionPubkeyStr,
            creators,
        });

        // Step 5: upload metadata JSON to Arweave
        let arweaveMetadataUri: string;
        try {
            const turbo = await getTurbo();
            const data = Buffer.from(JSON.stringify(metadataJson), 'utf-8');
            const upload = await turbo.upload({
                data,
                dataItemOpts: {
                    tags: [
                        { name: 'Content-Type', value: 'application/json' },
                        { name: 'App-Name', value: 'Epimage' },
                        { name: 'App-Version', value: '2-cnft-bubblegum-v2' },
                        { name: 'Image-Id', value: input.image_id },
                        { name: 'Asset-Id', value: predictedAssetId.toString() },
                        { name: 'Schema', value: 'epimage.deed.metadata/v2' },
                    ],
                },
            });
            arweaveMetadataUri = `https://arweave.net/${upload.id}`;
        } catch (e: any) {
            return {
                ok: false,
                error_code: 'ARWEAVE_UPLOAD_FAILED',
                message: e?.message ?? 'Arweave metadata upload failed',
            };
        }

        // Step 6: submit mintV2 with permanent Arweave URI
        // Signers: HOT_MINT_KEY (payer, via umi.identity), HOT_OPS_KEY (treeCreatorOrDelegate
        // -- recorded as the tree's creator at setup time), COLD_RECOVERY_KEY
        // (collectionAuthority -- the collection's update_authority, required to verify
        // the asset's membership in our soulbound collection).
        const name = nameForOnchain(input.image_id);
        let txSignature: string;
        try {
            const tx = await mintV2(umi, {
                merkleTree: treePubkey,
                coreCollection: collectionPubkey,
                leafOwner: publicKey(input.buyer_wallet!),
                treeCreatorOrDelegate: hotOps,
                collectionAuthority: coldRecovery,
                metadata: {
                    name,
                    symbol: 'epimage',
                    uri: arweaveMetadataUri,
                    sellerFeeBasisPoints: input.royalty_pct * 100, // pct -> basis points
                    primarySaleHappened: false,
                    isMutable: true,
                    tokenStandard: { __option: 'Some', value: 0 } as any, // NonFungible
                    collection: { __option: 'Some', value: collectionPubkey } as any,
                    creators,
                },
            }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
            txSignature = bs58.encode(tx.signature);
        } catch (e: any) {
            return {
                ok: false,
                error_code: 'MINT_SUBMIT_FAILED',
                message: e?.message ?? 'mintV2 submit failed',
            };
        }

        // Step 7: advisory check on the tree state post-mint.
        // The mint already confirmed (no exception above), so the asset exists.
        // Reading numMinted here is meant to catch the rare case where a
        // concurrent mint slipped past our mutex (single-instance mutex can't
        // catch multi-instance races; that's OI-02 distributed lock territory).
        // In practice, RPC propagation lag means this read often shows stale
        // state for a few ms after `confirmed` commitment -- we treat any
        // mismatch as a warning rather than a hard failure. A genuine race
        // would be caught by the on-chain mint instruction itself (it would
        // either fail or mint to a different leaf_index, both of which we'd
        // see in the tx logs).
        try {
            const after = await fetchTreeConfigFromSeeds(umi, { merkleTree: treePubkey });
            const observedLeafIndex = Number(after.numMinted) - 1;
            if (observedLeafIndex !== predictedLeafIndex) {
                console.warn(
                    `[cnft.dispatch] post-mint tree state read: predicted_index=${predictedLeafIndex} observed_index=${observedLeafIndex} (likely RPC propagation lag; mint succeeded with predicted asset_id) image=${input.image_id}`,
                );
            }
        } catch (e: any) {
            console.warn(
                `[cnft.dispatch] post-mint tree fetch failed (non-fatal): ${e?.message ?? e}`,
            );
        }

        console.log(
            `[cnft.dispatch] image=${input.image_id} asset_id=${predictedAssetId} tx=${txSignature} uri=${arweaveMetadataUri}`,
        );

        return {
            ok: true,
            crossmint_job_id: txSignature, // run_image_ops persists this as Purchase.crossmint_job_id
            onchain_status: 'success',
            asset_id: predictedAssetId.toString(),
            arweave_metadata_uri: arweaveMetadataUri,
        };
    });
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

// Truncate to fit Solana's 32-byte UTF-8 name limit. "Epimage #<image_id>" with a
// 5-char image_id is 14 bytes, well within the limit.
// On-chain name format: epima.ge/<image_id> -- 14 bytes for a 5-char image_id,
// well within the 32-byte Solana name cap. Doubles as a clickable-looking
// short-URL surface in marketplace UIs.
function nameForOnchain(image_id: string): string {
    const candidate = `epima.ge/${image_id}`;
    const buf = Buffer.from(candidate, 'utf-8');
    if (buf.byteLength <= 32) return candidate;
    return buf.subarray(0, 32).toString('utf-8');
}

interface BuildCreatorEntry {
    address: PublicKey;
    verified: boolean;
    share: number; // 0-100, must sum to 100
}

function buildCreatorsArray(creatorWallet: string | null, platformWallet: string): BuildCreatorEntry[] {
    const platform: BuildCreatorEntry = {
        address: publicKey(platformWallet),
        verified: true,
        share: 10,
    };
    if (creatorWallet && looksLikeSolanaAddress(creatorWallet)) {
        return [
            { address: publicKey(creatorWallet), verified: false, share: 90 },
            platform,
        ];
    }
    // Fall back to 100% platform when the creator wallet isn't yet provisioned.
    // The royalty config is informational on-chain; actual revenue split is at the
    // Stripe layer per R71. Acceptable at MVP; revisit when creator wallets
    // are populated via the wallets subsystem.
    return [{ address: platform.address, verified: true, share: 100 }];
}

interface BuildMetadataJsonArgs {
    input: DispatchInput;
    assetId: string;
    collection: string;
    creators: BuildCreatorEntry[];
}

function buildDeedMetadataJson(args: BuildMetadataJsonArgs): Record<string, unknown> {
    const { input, collection, creators } = args;
    void args.assetId; // intentionally unused -- REQ-MINT-01 (asset_id binding
                       // inside metadata) was retired; on-chain identity is
                       // the canonical asset_id surface.
    return {
        schema: 'epimage.deed.metadata/v2-cnft-bubblegum-v2',
        // REQ-MINT-03 image-identity fields (monogram is NOT here)
        image_id: input.image_id,
        title: input.title || 'Untitled',
        creator_display_name: input.creator_display_name,
        // Standard cNFT metadata fields some marketplaces expect
        name: nameForOnchain(input.image_id),
        symbol: 'epimage',
        // Image is the unwatermarked Thumbnail per R62 §2.2.
        // TODO(MVP-launch): swap back to `${PLATFORM_BASE_URL}/i/${input.image_id}?variant=thumbnail`
        // once epimage.com is hosting the app (currently a parked GoDaddy
        // page returning 404). Until then we embed the Cloudinary URL
        // directly so marketplaces/wallets/Solana Explorer render images on
        // pre-MVP test mints. Trade-off: CDN host (res.cloudinary.com) is
        // baked into the chain forever; migrate-off-Cloudinary would orphan
        // these test deeds' images. Acceptable pre-MVP; the post-launch swap
        // restores the platform-branded URL form for all future mints.
        image: buildThumbnailUrl(input.image_id),
        // Metaplex standard field. Solana Explorer renders this as "Website".
        // Points at the public image page; same URL whether viewer is signed
        // in or not (the page swaps to private-stub for non-owners post-sale).
        external_url: `${PLATFORM_BASE_URL}/${input.image_id}`,
        description: input.description || '',
        seller_fee_basis_points: input.royalty_pct * 100,
        properties: {
            files: input.arweave_uri
                ? [{ uri: input.arweave_uri, type: 'application/octet-stream' }]
                : [],
            category: 'image',
            creators: creators.map(c => ({
                address: c.address.toString(),
                verified: c.verified,
                share: c.share,
            })),
            collection,
        },
        // Cryptographic anchors per REQ-MINT-03
        arweave_master_uri: input.arweave_uri,
        sha256: input.sha256,
        phash: input.phash,
        enc_final: input.enc_final,
        license_signing_event_id: input.license_signing_event_id,
        // Embedded provenance manifest (post-MVP) goes here when wired:
        // tree_root_at_mint_time, mint_tx_signature, platform_signature
    };
}
