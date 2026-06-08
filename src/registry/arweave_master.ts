// arweave_master.ts
// MVP-scope Arweave upload via ArDrive Turbo SDK.
// Spec: /docs/registry/arweave_master.md (R62 §1.5 + §2.3 doubly-nested enc_final).
//
// Arweave payload = single-layer ZIP-AES-256 archive containing `<image_id>.jpg`,
// password = base64(DEK_image). R62 §1.5 architecture preserved: one DEK_image
// per image, doubly-nested `enc_final = encrypt(encrypt(DEK_image,
// owner_wallet_pubkey), platform_DEK)` lives on-chain in deed metadata (NOT
// into the Arweave payload). Recovery is unchanged: owner peels enc_final to
// recover DEK_image, then opens the Arweave ZIP with the DEK-derived password.
// ZIP packaging is a UX divergence from R62 §2.3 text ("AES-256-GCM") per D-19;
// shifts mode to ZIP-native AES-256-CBC for native-tool compatibility on
// Windows 11 native, macOS Archive Utility, iOS Files, Android Files, Linux
// unzip 6.0+, and 7-Zip.
//
// Local-disk persisted ciphertext is unchanged from R62 §2.3 exact form
// (raw AES-256-GCM(DEK_image, plaintext)) so /download-master's existing
// decryptMaster call works without modification.
//
// ADR-0010 (nested ZIP with signature-derived inner password) was superseded
// 2026-06-06; D-19's single-layer ZIP packaging is the operative MVP form.
//
// Authentication uses a generated Arweave JWK persisted to .env. First run
// without ARWEAVE_JWK_BASE64 writes a fresh JWK to disk + prints it for the
// operator to paste into .env.

import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk';
import Arweave from 'arweave';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { prisma } from '../db';
import { encryptMaster } from '../cert/crypto';

// Bring archiver in via createRequire because the package is CJS without an
// ESM-default export; the same pattern shipped briefly under ADR-0010 and is
// kept here for the single-layer ZIP-AES-256 Arweave packaging per D-19.
const require_ = createRequire(import.meta.url);
const archiver = require_('archiver');
const archiverZipEncrypted = require_('archiver-zip-encrypted');

let zipFormatRegistered = false;
function ensureZipFormatRegistered() {
    if (zipFormatRegistered) return;
    (archiver as any).registerFormat('zip-encrypted', archiverZipEncrypted);
    zipFormatRegistered = true;
}

// Wrap the plaintext Master JPEG in a single-file ZIP-AES-256 archive (WinZip
// AE-2 spec) with password = base64(DEK_image). The on-Arweave bytes become
// `<image_id>.zip` containing `<image_id>.jpg` instead of the raw AES-GCM
// ciphertext per R62 §2.3 spec text. R62 §1.5 architecture preserved: one
// DEK_image per image is still the only key needed to decrypt the Arweave
// bytes; the on-chain enc_final still wraps DEK_image in the doubly-nested
// envelope per R62 §2.3. Format change is for native-tool UX only.
async function buildArweaveZip(
    jpegBuffer: Buffer,
    image_id: string,
    password: string,
): Promise<Buffer> {
    ensureZipFormatRegistered();
    const archive = (archiver as any).create('zip-encrypted', {
        zlib: { level: 8 },
        encryptionMethod: 'aes256',
        password,
    });
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
        archive.on('data', (chunk: Buffer) => chunks.push(chunk));
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', (err: Error) => reject(err));
        archive.append(jpegBuffer, { name: `${image_id}.jpg` });
        archive.finalize();
    });
}

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

// Fetch the Cloudinary Master (original upload) bytes. Public URL, no auth.
// These are the full-resolution unwatermarked bytes that the deed anchors
// at M+00 and that the buyer receives via /v1/deeds/:imageId/download-master.
async function fetchMasterBytes(master_url: string): Promise<Buffer> {
    const res = await fetch(master_url);
    if (!res.ok) throw new Error(`master fetch failed: ${res.status}`);
    const arrBuf = await res.arrayBuffer();
    return Buffer.from(arrBuf);
}

export interface BuildAndUploadInput {
    image_id: string;
    buyer_wallet_pubkey: string | null;
    master_url: string;        // Cloudinary no-transformation delivery URL (buildOriginalUrl)
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
        const masterBytes = await fetchMasterBytes(input.master_url);
        // Reuse Image.sha256 if already populated at certify time -- buyer
        // sees the same hash pre-sale and the deed's M+00 anchor commits to
        // the same value post-sale. Re-hash only on the legacy path (pre-cert-
        // time sha256 deeds) so this stays idempotent. Note: at certify time
        // we hash the upload buffer directly; here we hash Cloudinary-served
        // bytes, which can differ if Cloudinary stripped EXIF/metadata. In
        // that case Image.sha256 (from upload buffer) takes precedence.
        const existingSha = await prisma.image.findUnique({
            where: { image_id: input.image_id },
            select: { sha256: true },
        });
        const sha256 = existingSha?.sha256
            ?? createHash('sha256').update(masterBytes).digest('hex');

        // Encrypt the Master bytes with a per-image DEK, wrap the DEK with
        // PLATFORM_DEK, persist the wrapped DEK to images.dek_wrapped. The
        // local-disk ciphertext stays R62 §2.3 exact (raw AES-GCM) so
        // /download-master's decryptMaster path is unchanged. The doubly-
        // nested envelope `enc_final` (asymmetric inner to wallet pubkey +
        // symmetric outer with PLATFORM_DEK) is constructed by run_image_ops
        // and written to on-chain deed metadata, NOT into the Arweave payload.
        const { ciphertext, dek_wrapped, dek_image } = encryptMaster(masterBytes);

        // Persist ciphertext to local disk BEFORE attempting Arweave -- so even
        // if Arweave 402s, the platform-mediated Master download still works
        // (D-11 follow-through). Local copy is the operative download source
        // at MVP; Arweave is the post-cessation owner-recovery channel.
        await persistEncryptedMasterLocal(input.image_id, ciphertext);

        // Build the Arweave-bound payload: single-layer ZIP-AES-256 containing
        // <image_id>.jpg per D-19. Password = base64(DEK_image); the on-chain
        // enc_final still wraps DEK_image so only the owner (or trustee at
        // cessation) can derive it. Native-tool extract once the password is in
        // hand.
        const dekPassword = dek_image.toString('base64');
        const arweaveZip = await buildArweaveZip(masterBytes, input.image_id, dekPassword);

        const turbo = await getTurbo();

        // Try the upload. If the Arweave wallet is out of Turbo credits (HTTP
        // 402), fall back to uploading a tiny manifest JSON instead -- the
        // deed still gets a real Arweave URI and the local ciphertext is the
        // operative source until the wallet is funded.
        let arweave_uri: string;
        try {
            const tags = [
                { name: 'Content-Type', value: 'application/zip' },
                { name: 'App-Name', value: 'Epimage' },
                { name: 'App-Version', value: '3-r62-zip' },
                { name: 'Image-Id', value: input.image_id },
                { name: 'Sha256', value: sha256 },
                { name: 'Encryption', value: 'ZIP-AES-256' },
                { name: 'Encryption-Schema', value: 'zip-aes256-dek-v1' },
                { name: 'File-Name', value: `${input.image_id}.zip` },
            ];
            const upload = await turbo.upload({
                data: arweaveZip,
                dataItemOpts: { tags },
            });
            arweave_uri = `https://arweave.net/${upload.id}`;
            console.log(`[arweave_master] uploaded ZIP-AES-256 (${arweaveZip.byteLength} bytes) for ${input.image_id} -> ${arweave_uri}`);
        } catch (uploadErr) {
            const msg = (uploadErr as Error)?.message ?? String(uploadErr);
            if (!/Insufficient balance|Status 402/i.test(msg)) {
                throw uploadErr; // unrelated error -- rethrow
            }
            console.warn(
                '[arweave] Out of Turbo credits. Falling back to manifest-JSON upload. ' +
                'Fund the wallet at https://turbo.ardrive.io to upload encrypted bytes. ' +
                `Image ${input.image_id} dek_wrapped is persisted; payload was not uploaded.`,
            );
            const manifest = {
                schema: 'epimage.deed.manifest/v1-no-credit-fallback',
                image_id: input.image_id,
                title: input.title,
                creator: input.creator_display_name,
                master_url: input.master_url,
                sha256,
                phash: image?.phash ?? null,
                intended_encryption: 'ZIP-AES-256',
                note: 'Encrypted Master bytes were not uploaded due to Arweave wallet exhaustion. dek_wrapped is on the platform DB; payload is not yet on Arweave.',
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
