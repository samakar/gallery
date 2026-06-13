// zip.ts
// ZIP-AES-256 (WinZip AE-2) packaging for the encrypted Master.
//
// At Card 1 (`POST /v1/images`) the upload buffer is packaged as a
// single-file ZIP-AES-256 archive (`<image_id>.jpg` inside), password =
// `base64(DEK_image)`. The archive is written to `EncryptedMasterStore` at
// `data/encrypted_masters/<image_id>.zip` and later lifted as-is to Arweave
// at Card 5 by `arweave_master.buildAndUpload`. The cleartext JPEG bytes
// never appear server-side after Card 1 -- `/download-master` returns the
// password + Arweave URL to the buyer and the buyer's OS extracts the ZIP
// natively (Windows / macOS Archive Utility / iOS Files / Linux unzip 6.0+).
//
// **Resale (post-MVP, TBD)**: when a deed transfers to a new owner, the
// platform will need to:
//   1. Fetch the encrypted ZIP from Arweave
//   2. Extract with the per-image password (`base64(DEK_image)` from
//      `images.dek_wrapped`)
//   3. Render a fresh Share Copy with the new owner's monogram
//   4. Upload the Share Copy to Cloudinary
// The extractor function (`extractFromZipAes256`) is intentionally stubbed
// here as the contract point so the resale module can plug into a single
// well-known surface when shipped.

import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const archiver = require_('archiver');
const archiverZipEncrypted = require_('archiver-zip-encrypted');

let zipFormatRegistered = false;
function ensureZipFormatRegistered() {
    if (zipFormatRegistered) return;
    (archiver as any).registerFormat('zip-encrypted', archiverZipEncrypted);
    zipFormatRegistered = true;
}

// Wrap a JPEG (or any binary) in a single-file ZIP-AES-256 archive.
// Password should be `base64(DEK_image)` per the deed crypto model so the
// on-chain `enc_final` envelope (which wraps DEK_image to the owner's
// wallet pubkey) closes the recovery loop.
export async function buildArweaveZip(
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

// Resale-time extractor (TBD post-MVP).
// At MVP we never extract server-side. The buyer's OS extract tool consumes
// the ZIP on the client. When resale ships, this function will:
//   - Parse the ZIP central directory
//   - Derive the AES key from the password via PBKDF2-HMAC-SHA1 (AE-2 spec)
//   - Decrypt the CBC-mode payload
//   - Verify HMAC-SHA-1 authentication
//   - Return the cleartext JPEG bytes
// Implementations: ~150 lines of in-process decode (no new dep), OR wrap a
// 7-Zip CLI binary, OR `adm-zip` with AES support.
export async function extractFromZipAes256(
    _zipBuffer: Buffer,
    _password: string,
): Promise<Buffer> {
    throw new Error(
        'extractFromZipAes256 is not implemented at MVP. ' +
        'Add the AES-256 ZIP reader when resale share-copy regeneration ships.',
    );
}
