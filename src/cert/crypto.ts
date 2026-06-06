// crypto.ts
// Master encryption pipeline per R65 §3.14 single-DEK architecture.
//
//   - PLATFORM_DEK: 32-byte symmetric key held by the server. Generated at
//     first startup if not in .env; print-once-and-paste pattern, same as
//     ARWEAVE_JWK_BASE64. Migrate to KMS at production time without touching
//     callers.
//   - DEK_image: per-image 32-byte symmetric key. Generated at Master
//     encryption time, wrapped with PLATFORM_DEK, persisted to
//     images.dek_wrapped.
//   - enc_final per R62 §2.3: encrypt(encrypt(DEK_image, buyer_wallet_pubkey),
//     PLATFORM_DEK). Inner layer is asymmetric (NaCl sealed box to the
//     buyer's Solana Ed25519 -> Curve25519 derived key) so post-cessation,
//     publishing PLATFORM_DEK does not expose per-deed Masters to anyone
//     other than the deed holder.
//
// All AES uses AES-256-GCM with random 12-byte IV. Ciphertext layout:
//   [12-byte IV][ciphertext][16-byte auth tag]
//
// All asymmetric uses NaCl sealed box (nacl.box) -- ephemeral X25519 sender
// keypair + recipient's X25519 derived from Solana Ed25519 pubkey.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import ed2curve from 'ed2curve';
import bs58 from 'bs58';

// -------------------------------------------------------------------
// PLATFORM_DEK
// -------------------------------------------------------------------

let cachedPlatformDek: Buffer | null = null;

export function getPlatformDek(): Buffer {
    if (cachedPlatformDek) return cachedPlatformDek;
    const fromEnv = process.env.PLATFORM_DEK;
    if (!fromEnv) {
        throw new Error('PLATFORM_DEK is not set. Restart the server -- the eager startup check will generate one and print it for paste.');
    }
    const buf = Buffer.from(fromEnv, 'base64');
    if (buf.length !== 32) {
        throw new Error(`PLATFORM_DEK must be 32 bytes (base64 of 32 raw bytes); got ${buf.length}`);
    }
    cachedPlatformDek = buf;
    return buf;
}

// Generate a fresh 32-byte key and return it base64-encoded for pasting.
// Called from server startup when PLATFORM_DEK is missing.
export function generatePlatformDek(): string {
    return randomBytes(32).toString('base64');
}

// -------------------------------------------------------------------
// Symmetric encryption (AES-256-GCM)
// -------------------------------------------------------------------

const IV_LEN = 12;        // GCM standard
const AUTH_TAG_LEN = 16;

export function aesEncrypt(key: Buffer, plaintext: Buffer): Buffer {
    if (key.length !== 32) throw new Error('AES key must be 32 bytes');
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]);
}

export function aesDecrypt(key: Buffer, ciphertext: Buffer): Buffer {
    if (key.length !== 32) throw new Error('AES key must be 32 bytes');
    if (ciphertext.length < IV_LEN + AUTH_TAG_LEN) {
        throw new Error('Ciphertext too short');
    }
    const iv = ciphertext.subarray(0, IV_LEN);
    const tag = ciphertext.subarray(ciphertext.length - AUTH_TAG_LEN);
    const ct = ciphertext.subarray(IV_LEN, ciphertext.length - AUTH_TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// -------------------------------------------------------------------
// DEK_image lifecycle
// -------------------------------------------------------------------

export function generateDekImage(): Buffer {
    return randomBytes(32);
}

export function wrapDek(dekImage: Buffer): Buffer {
    return aesEncrypt(getPlatformDek(), dekImage);
}

export function unwrapDek(wrapped: Buffer): Buffer {
    return aesDecrypt(getPlatformDek(), wrapped);
}

// -------------------------------------------------------------------
// Master encryption
// -------------------------------------------------------------------

export interface EncryptedMaster {
    ciphertext: Buffer;
    dek_wrapped: Buffer;
    dek_image: Buffer; // returned for in-flight use; do NOT persist
}

export function encryptMaster(plaintext: Buffer): EncryptedMaster {
    const dek_image = generateDekImage();
    const ciphertext = aesEncrypt(dek_image, plaintext);
    const dek_wrapped = wrapDek(dek_image);
    return { ciphertext, dek_wrapped, dek_image };
}

export function decryptMaster(ciphertext: Buffer, dekWrapped: Buffer): Buffer {
    const dek_image = unwrapDek(dekWrapped);
    return aesDecrypt(dek_image, ciphertext);
}

// -------------------------------------------------------------------
// Asymmetric layer (NaCl sealed box to Solana wallet)
// -------------------------------------------------------------------

// Decode a Solana base58 pubkey and convert it to a Curve25519 pubkey
// suitable for NaCl box encryption. Ed25519 and Curve25519 are related but
// distinct; ed2curve does the standard birational mapping.
function solanaPubkeyToCurve25519(solanaBase58: string): Uint8Array {
    const ed = bs58.decode(solanaBase58);
    if (ed.length !== 32) {
        throw new Error(`Solana pubkey must decode to 32 bytes; got ${ed.length}`);
    }
    const curve = ed2curve.convertPublicKey(ed);
    if (!curve) throw new Error('Failed to convert Ed25519 pubkey to Curve25519 (invalid point)');
    return curve;
}

// Sealed-box: anyone holding `solana_pubkey_base58` can decrypt by signing
// with their corresponding Ed25519 private key (via Magic's wallet flow).
// Layout: [32-byte ephemeral pubkey][24-byte nonce][ciphertext + 16-byte MAC]
export function sealToSolanaWallet(plaintext: Buffer, solana_pubkey_base58: string): Buffer {
    const recipientCurve = solanaPubkeyToCurve25519(solana_pubkey_base58);
    const ephemeral = nacl.box.keyPair();
    const nonce = randomBytes(nacl.box.nonceLength);
    const ct = nacl.box(
        new Uint8Array(plaintext),
        nonce,
        recipientCurve,
        ephemeral.secretKey,
    );
    return Buffer.concat([
        Buffer.from(ephemeral.publicKey),
        nonce,
        Buffer.from(ct),
    ]);
}

// Decrypt a sealed-box. Recipient signs to recover their Ed25519 secret key;
// in our case Magic's signing flow is used buyer-side. Server-side this is
// only called for debugging / migration.
export function openFromSolanaWallet(sealed: Buffer, recipient_ed25519_secret: Buffer): Buffer {
    if (sealed.length < 32 + nacl.box.nonceLength) {
        throw new Error('Sealed box too short');
    }
    const ephemeralPub = sealed.subarray(0, 32);
    const nonce = sealed.subarray(32, 32 + nacl.box.nonceLength);
    const ct = sealed.subarray(32 + nacl.box.nonceLength);
    const recipientCurveSecret = ed2curve.convertSecretKey(new Uint8Array(recipient_ed25519_secret));
    const opened = nacl.box.open(
        new Uint8Array(ct),
        new Uint8Array(nonce),
        new Uint8Array(ephemeralPub),
        recipientCurveSecret,
    );
    if (!opened) throw new Error('Sealed box decryption failed (wrong key or tampered ciphertext)');
    return Buffer.from(opened);
}

// -------------------------------------------------------------------
// enc_final construction (R62 §2.3)
// -------------------------------------------------------------------

// enc_final = AES-256-GCM(PLATFORM_DEK, sealed_box(DEK_image -> buyer_wallet_pubkey))
//
// Caller passes the raw DEK_image (from the encrypt-time return value, OR
// from unwrapping dek_wrapped) and the buyer's Solana base58 wallet address.
export function buildEncFinal(dek_image: Buffer, buyer_wallet_base58: string): string {
    const inner = sealToSolanaWallet(dek_image, buyer_wallet_base58);
    const outer = aesEncrypt(getPlatformDek(), inner);
    return outer.toString('base64');
}
