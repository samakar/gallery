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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { prisma } from '../db';
import { encryptMaster } from '../cert/crypto';

// Local encrypted-Master persistence per R71 §1.1 + D-11 follow-through.
// MVP architecture: platform delivers the Master from this local copy via
// /v1/deeds/:imageId/download-master. Arweave upload is best-effort for the
// long-term license-survival path (R62 §2.3 post-cessation recovery); the
// local copy is the operative source for buyer downloads at MVP.
const ENCRYPTED_MASTER_DIR = path.join(
    process.cwd(),
    process.env.ENCRYPTED_MASTER_DIR ?? 'data/encrypted_masters',
);

export function encryptedMasterPath(image_id: string): string {
    return path.join(ENCRYPTED_MASTER_DIR, `${image_id}.bin`);
}

export async function readEncryptedMasterLocal(image_id: string): Promise<Buffer | null> {
    try {
        return await fs.readFile(encryptedMasterPath(image_id));
    } catch (e: any) {
        if (e?.code === 'ENOENT') return null;
        throw e;
    }
}

async function persistEncryptedMasterLocal(image_id: string, ciphertext: Buffer): Promise<void> {
    await fs.mkdir(ENCRYPTED_MASTER_DIR, { recursive: true });
    await fs.writeFile(encryptedMasterPath(image_id), ciphertext);
}

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

        // Encrypt the preview bytes with a per-image DEK, wrap the DEK with
        // PLATFORM_DEK, persist the wrapped DEK to images.dek_wrapped.
        const { ciphertext, dek_wrapped, dek_image } = encryptMaster(previewBytes);
        void dek_image; // run_image_ops re-unwraps for enc_final.

        // Persist ciphertext to local disk BEFORE attempting Arweave -- so even
        // if Arweave 402s, the platform-mediated Master download still works
        // (D-11 follow-through). Local copy is the operative download source
        // at MVP; Arweave is best-effort for the long-term post-cessation path.
        await persistEncryptedMasterLocal(input.image_id, ciphertext);

        const turbo = await getTurbo();

        // Try the full encrypted-Master upload. If the Arweave wallet is out
        // of Turbo credits (HTTP 402), fall back to uploading a tiny manifest
        // JSON instead -- the deed still gets a real Arweave URI and the
        // ciphertext stays on the server for later upload when the wallet is
        // funded. Persist dek_wrapped either way so the asymmetric layer
        // works at mint time.
        let arweave_uri: string;
        try {
            const upload = await turbo.upload({
                data: ciphertext,
                dataItemOpts: {
                    tags: [
                        { name: 'Content-Type', value: 'application/octet-stream' },
                        { name: 'App-Name', value: 'Epimage' },
                        { name: 'App-Version', value: '1-mvp' },
                        { name: 'Image-Id', value: input.image_id },
                        { name: 'Sha256', value: sha256 },
                        { name: 'Encryption', value: 'AES-256-GCM' },
                        { name: 'Encryption-Schema', value: 'aes-256-gcm-v1' },
                    ],
                },
            });
            arweave_uri = `https://arweave.net/${upload.id}`;
        } catch (uploadErr) {
            const msg = (uploadErr as Error)?.message ?? String(uploadErr);
            if (!/Insufficient balance|Status 402/i.test(msg)) {
                throw uploadErr; // unrelated error -- rethrow
            }
            console.warn(
                '[arweave] Out of Turbo credits. Falling back to manifest-JSON upload. ' +
                'Fund the wallet at https://turbo.ardrive.io to upload encrypted bytes. ' +
                `Image ${input.image_id} dek_wrapped is persisted; ciphertext was not uploaded.`,
            );
            const manifest = {
                schema: 'epimage.deed.manifest/v1-no-credit-fallback',
                image_id: input.image_id,
                title: input.title,
                creator: input.creator_display_name,
                preview_url: input.preview_url,
                sha256,
                phash: image?.phash ?? null,
                note: 'Encrypted Master bytes were not uploaded due to Arweave wallet exhaustion. dek_wrapped is on the platform DB; ciphertext is not yet on Arweave.',
                generated_at: new Date().toISOString(),
            };
            const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8');
            const upload = await turbo.upload({
                data: manifestBytes,
                dataItemOpts: {
                    tags: [
                        { name: 'Content-Type', value: 'application/json' },
                        { name: 'App-Name', value: 'Epimage' },
                        { name: 'App-Version', value: '1-mvp-fallback' },
                        { name: 'Image-Id', value: input.image_id },
                        { name: 'Sha256', value: sha256 },
                    ],
                },
            });
            arweave_uri = `https://arweave.net/${upload.id}`;
        }

        await prisma.image.update({
            where: { image_id: input.image_id },
            data: { arweave_uri, sha256, dek_wrapped },
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
