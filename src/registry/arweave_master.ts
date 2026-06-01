// arweave_master.ts
// MVP-scope Arweave upload via ArDrive Turbo SDK.
// Spec: /docs/registry/arweave_master.md (full encryption pipeline).
//
// MVP-scope divergence (clearly documented):
//   - Skip the Master encryption layers (image_gen doesn't encrypt at MVP either).
//     `enc_final` is returned as an empty string.
//   - Skip the decryptOriginal + canonical-pixels SHA-256 path. Instead we fetch
//     the public Cloudinary listing preview bytes and hash THOSE. The deed's
//     M+00 anchor therefore commits to the preview image (good enough for
//     visual verification + Crossmint metadata; real impl commits to the
//     canonical-pixels of the Master).
//   - Upload a small JSON manifest (~1KB) referencing the preview URL + hashes,
//     not the image bytes themselves. Stays under Turbo's 100KB free-tier
//     ceiling so we don't need an Arweave wallet with credits.
//
// Authentication uses a generated Arweave JWK persisted to .env. First run
// without ARWEAVE_JWK_BASE64 writes a fresh JWK to disk + prints it for the
// operator to paste into .env.

import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';
import Arweave from 'arweave';
import { createHash } from 'node:crypto';
import { prisma } from '../db';

export type ArweaveErrorCode = 'ARWEAVE_UPLOAD_FAILED' | 'MASTER_ALREADY_BUILT';

export interface BuildResult {
    arweave_uri: string;
    sha256: string;
    phash: string | null;
    enc_final: string;
}

export type ArweaveMasterResult =
    | { ok: true; result: BuildResult }
    | { ok: false; error_code: ArweaveErrorCode; message: string };

// Cached Turbo client so we don't re-init the signer on every call.
let turboClient: ReturnType<typeof TurboFactory.authenticated> | null = null;

async function getTurbo() {
    if (turboClient) return turboClient;
    let jwkBase64 = process.env.ARWEAVE_JWK_BASE64;
    if (!jwkBase64) {
        // Generate a fresh key once and print it so the operator can paste it
        // into .env. Without persistence each restart would mint a new key
        // (fine for uploads, but loses any prior balance).
        const arweave = Arweave.init({});
        const jwk = await arweave.wallets.generate();
        jwkBase64 = Buffer.from(JSON.stringify(jwk)).toString('base64');
        console.warn(
            '[arweave] ARWEAVE_JWK_BASE64 not set -- generated a fresh JWK. ' +
            'Paste this line into .env to persist (otherwise a new key is minted each restart):\n' +
            `ARWEAVE_JWK_BASE64=${jwkBase64}`
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

// Fetch the Cloudinary listing preview bytes for hashing. Public URL, no auth.
async function fetchPreviewBytes(preview_url: string): Promise<Buffer> {
    const res = await fetch(preview_url);
    if (!res.ok) throw new Error(`preview fetch failed: ${res.status}`);
    const arrBuf = await res.arrayBuffer();
    return Buffer.from(arrBuf);
}

export interface BuildAndUploadInput {
    image_id: string;
    buyer_wallet_pubkey: string | null;
    preview_url: string;
    title: string;
    creator_display_name: string;
}

export async function buildAndUpload(input: BuildAndUploadInput): Promise<ArweaveMasterResult> {
    const image = await prisma.image.findUnique({
        where: { image_id: input.image_id },
        select: { arweave_uri: true, sha256: true, phash: true },
    });
    // Idempotent: don't re-upload if already done.
    if (image?.arweave_uri && image.sha256) {
        return {
            ok: true,
            result: {
                arweave_uri: image.arweave_uri,
                sha256: image.sha256,
                phash: image.phash,
                enc_final: '',
            },
        };
    }

    try {
        const previewBytes = await fetchPreviewBytes(input.preview_url);
        const sha256 = createHash('sha256').update(previewBytes).digest('hex');

        // Build the manifest JSON that gets uploaded to Arweave. Tiny payload
        // (~1KB) so Turbo's free tier covers it. Real impl uploads the
        // encrypted Master bytes themselves; this is a placeholder for staging.
        const manifest = {
            schema: 'epimage.deed.manifest/v0-mvp-stub',
            image_id: input.image_id,
            title: input.title,
            creator: input.creator_display_name,
            buyer_wallet: input.buyer_wallet_pubkey,
            preview_url: input.preview_url,
            sha256_of_preview: sha256,
            phash: image?.phash ?? null,
            note: 'MVP scaffold: preview bytes are hashed in place of encrypted Master. Real Master upload arrives with image_gen encryption.',
            generated_at: new Date().toISOString(),
        };
        const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');

        const turbo = await getTurbo();
        const upload = await turbo.upload({
            data: manifestBytes,
            dataItemOpts: {
                tags: [
                    { name: 'Content-Type', value: 'application/json' },
                    { name: 'App-Name', value: 'Epimage' },
                    { name: 'App-Version', value: '0-mvp' },
                    { name: 'Image-Id', value: input.image_id },
                    { name: 'Sha256', value: sha256 },
                ],
            },
        });

        const arweave_uri = `https://arweave.net/${upload.id}`;

        await prisma.image.update({
            where: { image_id: input.image_id },
            data: { arweave_uri, sha256 },
        });

        return {
            ok: true,
            result: {
                arweave_uri,
                sha256,
                phash: image?.phash ?? null,
                enc_final: '',
            },
        };
    } catch (e) {
        return {
            ok: false,
            error_code: 'ARWEAVE_UPLOAD_FAILED',
            message: (e as Error)?.message ?? String(e),
        };
    }
}
