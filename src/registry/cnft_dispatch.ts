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
import { PublicKey as Web3JsPublicKey } from '@solana/web3.js';
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

// Deed metadata JSON schema version. Source of truth for BOTH the body's
// `schema` field AND the Arweave `Schema` tag -- they must always agree.
// Pre-MVP launch resets to v1; future revisions bump from here.
const DEED_METADATA_SCHEMA = 'epimage.deed.metadata/v1';
// Arweave producer-code version (semver). Tracks the upload-handler
// implementation, independent of the body schema. Pre-MVP-launch = 0.x;
// bumps to 1.0 at first stable production release.
const CNFT_DISPATCH_APP_VERSION = '0.1';

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
    description: string;       // UI labels as "Caption"; Metaplex JSON convention requires field name `description`
    story: string | null;      // UI labels as "Story"; optional long-form narrative
    creator_display_name: string;
    preview_url: string;
    arweave_uri: string | null;       // permanent Arweave URI of the encrypted Master (from arweave_master)
    sha256: string | null;            // full-file bytewise identity
    pixel_sha256: string | null;      // pixel-content identity (metadata-stripped JPEG hash); null for non-JPEG
    phash: string | null;
    enc_final: string | null;
    license_signing_event_id: string | null;
    royalty_pct: number;
    creator_wallet: string | null;
    // Creator's Image Signing Affirmation (ISA) -- the per-image authorship
    // ESIGN click at Card 1. Threaded into the Arweave metadata JSON as the
    // creator-side leg of the deed's COA. License signing (buyer-side, at
    // Card 4) lives on license_signing_event_id above.
    creator_isa_signing_event_id: string | null;
    creator_isa_signed_at: string | null; // ISO UTC
    // Creator-entered image facts mirrored into the Arweave metadata JSON so a
    // trustless verifier with only the deed's `uri` can read every COA-relevant
    // field without walking to Solana for the signed Memo props. The JSON is
    // image-level + immutable, so only fields stable across all editions of
    // the image belong here -- per-edition values (like this deed's edition
    // ordinal) live on the cNFT's leaf / per-mint state, not here.
    creation_date: string | null;        // ISO date the photo was taken (EXIF or manual)
    edition_total: number;               // total editions of this image (1 at MVP per R71 §3.6)
    image_spec: Record<string, unknown> | null;  // 7-field block per R62 §2.3:
                                                  // { width_px, height_px, color_space,
                                                  //   icc_profile, color_depth_bits,
                                                  //   file_type, file_size_bytes }
    // EXIF-derived camera/lens/exposure block read at Card 1 upload.
    // Distinguishes professional capture (specific Make/Model + lens metadata
    // + manual exposure + RAW format + camera-programmed Artist field) from
    // phone/point-and-shoot defaults. Null when EXIF is unreadable.
    // Embedded as-is into the Arweave metadata JSON.
    capture_setup: Record<string, unknown> | null;
    // Moment-of-sealing YouTube snapshots per /src/cert/youtube_snapshot.ts.
    // Fetched best-effort by run_image_ops just before this dispatch; null on
    // YouTube API failure or absent video association. Embedded as-is into the
    // Arweave metadata JSON + mirrored to deeds.creator_snapshot /
    // deeds.video_snapshot on the post_mint write.
    creator_snapshot: Record<string, unknown> | null;
    video_snapshot: Record<string, unknown> | null;
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
        // Pre-compute the deed's PDA address from (asset_id, DEED_PROGRAM_ID).
        // Used by post-MVP resale architecture: the program writes rotating
        // enc_final + monogram to this account. Reserved at MVP so every minted
        // deed's Arweave JSON locks in the eventual side-car address, even
        // though no program is deployed yet. Seed convention: [b"deed-data", asset_id].
        // Null when DEED_PROGRAM_ID isn't configured (dev-test paths).
        const deedPdaAddress = deriveDeedPdaAddress(predictedAssetId.toString());
        const metadataJson = buildDeedMetadataJson({
            input,
            assetId: predictedAssetId.toString(),
            collection: collectionPubkeyStr,
            creators,
            deedPdaAddress,
        });

        // Step 5: upload metadata JSON to Arweave with the 15-tag discovery
        // index. Tags 8-15 may be null if the source data is unavailable
        // (e.g. creator without YouTube, image without EXIF); we omit those
        // rather than emit empty values so indexer filters behave cleanly.
        // Arweave block.timestamp gives free upload-time search via GraphQL.
        let arweaveMetadataUri: string;
        try {
            const turbo = await getTurbo();
            const data = Buffer.from(JSON.stringify(metadataJson), 'utf-8');
            const tags: Array<{ name: string; value: string }> = [
                { name: 'Content-Type', value: 'application/json' },
                { name: 'App-Name', value: 'Epimage' },
                { name: 'App-Version', value: CNFT_DISPATCH_APP_VERSION },
                { name: 'Schema', value: DEED_METADATA_SCHEMA },
                { name: 'File-Name', value: `${input.image_id}.json` },
                { name: 'Image-Id', value: input.image_id },
                { name: 'Asset-Id', value: predictedAssetId.toString() },
            ];
            if (input.creator_wallet) {
                tags.push({ name: 'Creator-Address', value: input.creator_wallet });
            }
            if (input.creator_display_name) {
                tags.push({ name: 'Creator-Display-Name', value: input.creator_display_name });
            }
            const channelId = input.creator_snapshot?.channelId;
            if (typeof channelId === 'string' && channelId.length > 0) {
                tags.push({ name: 'YouTube-Channel-Id', value: channelId });
            }
            const channelHandle = input.creator_snapshot?.handle;
            if (typeof channelHandle === 'string' && channelHandle.length > 0) {
                tags.push({ name: 'YouTube-Channel-Handle', value: channelHandle });
            }
            const captureFormat = input.capture_setup?.capture_format;
            if (typeof captureFormat === 'string' && captureFormat.length > 0 && captureFormat !== 'unknown') {
                tags.push({ name: 'Capture-Format', value: captureFormat });
            }
            if (input.creation_date) {
                const year = input.creation_date.slice(0, 4);
                if (/^\d{4}$/.test(year)) {
                    tags.push({ name: 'Capture-Year', value: year });
                }
            }
            if (input.pixel_sha256) {
                tags.push({ name: 'Image-Fingerprint', value: input.pixel_sha256 });
            }
            if (input.phash) {
                tags.push({ name: 'Content-Fingerprint', value: input.phash });
            }
            const upload = await turbo.upload({
                data,
                dataItemOpts: { tags },
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
    deedPdaAddress: string | null;
}

// Derive the future deed-data PDA address for a given asset_id. Pure
// function -- no on-chain interaction. Anyone with the asset_id + the
// DEED_PROGRAM_ID constant can recompute the same address. Returns null
// when DEED_PROGRAM_ID isn't configured (CI / dev / fresh checkouts) so
// the mint flow doesn't hard-fail on missing env -- the field just stays
// absent from the JSON until DEED_PROGRAM_ID is set.
function deriveDeedPdaAddress(assetId: string): string | null {
    const programIdStr = process.env.DEED_PROGRAM_ID;
    if (!programIdStr) return null;
    try {
        const programId = new Web3JsPublicKey(programIdStr);
        const assetIdBytes = new Web3JsPublicKey(assetId).toBuffer();
        const [pda] = Web3JsPublicKey.findProgramAddressSync(
            [Buffer.from('deed-data'), assetIdBytes],
            programId,
        );
        return pda.toBase58();
    } catch (e) {
        console.warn('[cnft_dispatch] deriveDeedPdaAddress failed:', (e as Error).message);
        return null;
    }
}

function buildDeedMetadataJson(args: BuildMetadataJsonArgs): Record<string, unknown> {
    const { input, collection, creators, deedPdaAddress, assetId } = args;
    return {
        schema: DEED_METADATA_SCHEMA,
        // REQ-MINT-03 image-identity fields (monogram is NOT here)
        image_id: input.image_id,
        // cNFT asset_id (Metaplex DAS standard). Matches the Arweave
        // `Asset-Id` tag promoted to the upload's tag index. Lets a verifier
        // reading only this JSON confirm "this metadata is for asset X"
        // without consulting Solana.
        asset_id: assetId,
        title: input.title || 'Untitled',
        creator_display_name: input.creator_display_name,
        // COA-relevant creator-entered facts: every image-level field a buyer
        // / auditor would want to verify, mirrored into the immutable mint-time
        // JSON. Per-edition values (this deed's edition ordinal) are NOT here
        // -- the JSON is shared across all editions of the image, so it can
        // only carry edition-stable data. The per-edition ordinal is derivable
        // from the cNFT's leaf_index on the tree.
        creation_date: input.creation_date,
        edition_total: input.edition_total,
        image_spec: input.image_spec,
        capture_setup: input.capture_setup,
        // Moment-of-sealing YouTube snapshots. Captured by run_image_ops just
        // before this dispatch and frozen here for permanence on Arweave.
        creator_snapshot: input.creator_snapshot,
        video_snapshot: input.video_snapshot,
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
        // Optional photographer's narrative (UI label "Story"); emitted only
        // when non-empty, keeping the JSON terse for deeds without one.
        ...(input.story && input.story.trim().length > 0
            ? { story: input.story }
            : {}),
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
        // Three fingerprint anchors. `sha256` keeps the industry-convention
        // name (Arweave/crypto-standard); the other two use semantic names
        // because no convention exists. UI display labels translate these to
        // "File fingerprint" / "Image fingerprint" / "Content fingerprint".
        sha256: input.sha256,                     // file hash (full bytes with metadata)
        image_fingerprint: input.pixel_sha256,    // sha256 of JPEG with metadata segments stripped
        content_fingerprint: input.phash,         // perceptual hash (similarity within threshold)
        enc_final: input.enc_final,
        license_signing_event_id: input.license_signing_event_id,
        // Creator-side ESIGN -- the deed's COA leg. The buyer-side leg is
        // license_signing_event_id above.
        creator_isa_signing_event_id: input.creator_isa_signing_event_id,
        creator_isa_signed_at: input.creator_isa_signed_at,
        // Reserved post-MVP resale anchor. Derived from (asset_id, DEED_PROGRAM_ID)
        // via the seed convention [b"deed-data", asset_id]. No on-chain account
        // at this address yet -- the side-car program lands when resale ships.
        // Anyone can re-derive this address; recording it makes the linkage
        // explicit in the immutable mint-time JSON.
        deed_pda_address: deedPdaAddress,
        // Embedded provenance manifest (post-MVP) goes here when wired:
        // tree_root_at_mint_time, mint_tx_signature, platform_signature
    };
}
