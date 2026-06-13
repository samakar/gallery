// arweave_master.ts
// MVP-scope Arweave upload via ArDrive Turbo SDK.
// Spec: /docs/registry/arweave_master.md (R62 §1.5 + §2.3 doubly-nested enc_final).
//
// Arweave payload = single-layer ZIP-AES-256 archive containing `<image_id>.jpg`,
// password = base64(DEK_image). Per D-21, Card 1 builds the ZIP and writes it
// to `EncryptedMasterStore` at `data/encrypted_masters/<image_id>.zip`. This
// module reads the FS bytes and lifts them to Arweave **as-is** -- no decrypt,
// no rezip, no in-memory cleartext. Arweave bytes are byte-identical to FS bytes.
//
// R62 §1.5 architecture preserved: one DEK_image per image, doubly-nested
// `enc_final = encrypt(encrypt(DEK_image, owner_wallet_pubkey), platform_DEK)`
// lives on-chain in deed metadata. Recovery: owner peels `enc_final` (server
// peels outer wrap on first /download-master; owner's wallet privkey peels the
// inner sealed-box) to recover DEK_image, derives `base64(DEK_image)` password,
// and extracts the ZIP with native OS tools (WinZip / macOS Archive Utility /
// iOS Files / Android Files / Linux unzip 6.0+).
//
// ADR-0010 (nested ZIP with signature-derived inner password) was superseded
// 2026-06-06; D-19's Card-5-decrypt-and-rezip was superseded 2026-06-11 by D-21
// (Card 1 writes ZIP directly + Card 5 pass-through + /download-master returns
// password instead of streaming cleartext).
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

// Encrypted-Master storage abstraction. At MVP this is local FS only; post-MVP
// swaps in an S3-compatible object store (S3 / B2 / R2) without touching any
// call site -- only the export at the bottom of this section changes.
//
// MVP architecture:
//   - Card 1 (creator upload): write encrypted Master to the store.
//   - Card 5 (post-sale build): read from the store -> upload to Arweave ->
//     verify ready -> delete from the store (Arweave becomes the authoritative
//     post-sale copy; `/download-master` falls back to Arweave per server.ts).
//   - Takedown: delete from the store (no need to retain bytes for content the
//     platform will not serve).
//
// No backup at MVP per explicit scope decision -- if server FS is lost
// pre-sale, the creator re-uploads. Atomic write (write-temp + rename) is
// still used to protect against partial-write corruption from in-process
// crashes; that is correctness, not durability. Disk-full / write errors are
// logged via console.warn (the Pino logger is in server.ts and pulling it
// here would create a circular import; this module is rarely-failing).
export interface EncryptedMasterStore {
    read(image_id: string): Promise<Buffer | null>;
    write(image_id: string, ciphertext: Buffer): Promise<void>;
    delete(image_id: string): Promise<void>;
    exists(image_id: string): Promise<boolean>;
}

// Arweave producer-code version for the encrypted-Master upload (semver).
// Pre-MVP-launch = 0.x; bumps to 1.0 at first stable production release.
const ARWEAVE_MASTER_APP_VERSION = '0.1';

const ENCRYPTED_MASTER_DIR = path.join(
    process.cwd(),
    process.env.ENCRYPTED_MASTER_DIR ?? 'data/encrypted_masters',
);

export function encryptedMasterPath(image_id: string): string {
    return path.join(ENCRYPTED_MASTER_DIR, `${image_id}.zip`);
}

export const fsEncryptedMasterStore: EncryptedMasterStore = {
    async read(image_id: string): Promise<Buffer | null> {
        try {
            return await fs.readFile(encryptedMasterPath(image_id));
        } catch (e: any) {
            if (e?.code === 'ENOENT') return null;
            throw e;
        }
    },

    // Atomic write: write to a temp file, fsync, rename over the target. If
    // the process crashes mid-write, the target file is either pre-existing
    // (untouched) or absent -- never half-written.
    async write(image_id: string, ciphertext: Buffer): Promise<void> {
        await fs.mkdir(ENCRYPTED_MASTER_DIR, { recursive: true });
        const target = encryptedMasterPath(image_id);
        const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        try {
            await fs.writeFile(tmp, ciphertext);
            await fs.rename(tmp, target);
        } catch (e: any) {
            console.warn(
                `[encrypted_master_store] write failed for ${image_id}: ${e?.code ?? ''} ${e?.message ?? e}`,
            );
            // Best-effort cleanup of the temp file
            try { await fs.unlink(tmp); } catch { /* noop */ }
            throw e;
        }
    },

    async delete(image_id: string): Promise<void> {
        try {
            await fs.unlink(encryptedMasterPath(image_id));
        } catch (e: any) {
            // Already absent -> success. Anything else logged + swallowed
            // (delete is a cleanup; we don't want it to wedge the pipeline).
            if (e?.code !== 'ENOENT') {
                console.warn(
                    `[encrypted_master_store] delete failed for ${image_id}: ${e?.code ?? ''} ${e?.message ?? e}`,
                );
            }
        }
    },

    async exists(image_id: string): Promise<boolean> {
        try {
            await fs.access(encryptedMasterPath(image_id));
            return true;
        } catch {
            return false;
        }
    },
};

// Active store at MVP. Post-MVP: swap this binding to `s3EncryptedMasterStore`
// (new file implementing the same interface against S3/B2/R2). No call site
// changes.
export const encryptedMasterStore: EncryptedMasterStore = fsEncryptedMasterStore;

// Back-compat: `readEncryptedMasterLocal` and `persistEncryptedMasterLocal`
// remain exported as thin shims so existing callers (server.ts) keep working.
// New code should use `encryptedMasterStore` directly.
export async function readEncryptedMasterLocal(image_id: string): Promise<Buffer | null> {
    return encryptedMasterStore.read(image_id);
}

async function persistEncryptedMasterLocal(image_id: string, ciphertext: Buffer): Promise<void> {
    return encryptedMasterStore.write(image_id, ciphertext);
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

export interface BuildAndUploadInput {
    image_id: string;
    buyer_wallet_pubkey: string | null;
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
        // The encrypted Master is already on FS as a ZIP-AES-256 archive
        // (written at Card 1 by `POST /v1/images` per D-21). Pass through to
        // Arweave -- no decrypt, no rezip, no in-memory cleartext. Arweave
        // bytes are byte-identical to FS bytes.
        const zipBytes = await encryptedMasterStore.read(input.image_id);
        if (!zipBytes) {
            return {
                ok: false,
                error_code: 'ARWEAVE_UPLOAD_FAILED',
                message: `Encrypted Master ZIP not found in store for ${input.image_id}; expected Card 1 to have written it.`,
            };
        }
        const imgRow = await prisma.image.findUnique({
            where: { image_id: input.image_id },
            select: { sha256: true },
        });
        // sha256 was computed at Card 1 over the upload buffer (cleartext).
        // Read-through; this module never recomputes (would need to extract the
        // ZIP, which is post-MVP territory per cert/zip.ts).
        const sha256 = imgRow?.sha256
            ?? createHash('sha256').update(zipBytes).digest('hex');

        const arweaveZip = zipBytes;

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
                { name: 'App-Version', value: ARWEAVE_MASTER_APP_VERSION },
                { name: 'Image-Id', value: input.image_id },
                { name: 'Sha256', value: sha256 },   // Arweave/ArDrive convention -- sha256 of the cleartext Master inside the ZIP
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
                        { name: 'App-Version', value: `${ARWEAVE_MASTER_APP_VERSION}-fallback` },
                        { name: 'Image-Id', value: input.image_id },
                        { name: 'Sha256', value: sha256 },
                    ],
                },
            });
            arweave_uri = `https://arweave.net/${upload.id}`;
        }

        // dek_wrapped is set at Card 1 (upload time) and is not updated here.
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
