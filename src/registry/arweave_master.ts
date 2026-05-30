// arweave_master.ts
// On-Arweave Master encryption + ArDrive Turbo upload (Registry).
// Spec: /docs/registry/arweave_master.md
//
// Reads the Original via image_gen.decryptOriginal (cross-function read into
// Commerce). Re-encrypts with the SAME DEK_image per R65 §3.14 single-DEK
// architecture. Constructs enc_final = encrypt(encrypt(DEK_image,
// buyer_wallet_pubkey), platform_DEK) per R62 §2.3.

import { prisma } from '../db';
// TODO: import { decryptOriginal } from '../commerce/image_gen';
// TODO: import { Turbo } from '@ardrive/turbo-sdk';
// TODO: import { createHash, createCipheriv } from 'node:crypto';

export type ArweaveErrorCode =
    | "ARWEAVE_UPLOAD_FAILED"
    | "MASTER_ALREADY_BUILT";

export interface BuildResult {
    arweave_uri: string;
    sha256: string;
    enc_final: string;
}

export type ArweaveMasterResult =
    | { ok: true; result: BuildResult }
    | { ok: false; error_code: ArweaveErrorCode; message: string };

export async function buildAndUpload(
    image_id: string,
    _buyer_wallet_pubkey: string
): Promise<ArweaveMasterResult> {
    const image = await prisma.image.findUnique({
        where: { image_id },
        select: { arweave_uri: true, dek_wrapped: true, sha256: true },
    });
    if (image?.arweave_uri) {
        return { ok: false, error_code: "MASTER_ALREADY_BUILT", message: "Already built." };
    }
    // TODO: const plaintext = await decryptOriginal(image_id)
    // TODO: const sha256_hex = sha256(canonical_pixels(plaintext))
    // TODO: unwrap DEK_image from images.dek_wrapped via process.env.PLATFORM_DEK
    // TODO: const ciphertext = aes256gcm(DEK_image, plaintext)
    // TODO: const inner = encrypt(DEK_image, buyer_wallet_pubkey)  -- asymmetric, OI-01
    // TODO: const enc_final = base64(encrypt(inner, process.env.PLATFORM_DEK))
    // TODO: const arweave_tx = await turbo.uploadFile({ fileStreamFactory: () => stream(ciphertext), fileSizeFactory: () => ciphertext.length })
    // TODO: const arweave_uri = `https://arweave.net/${arweave_tx.id}`
    // TODO: await prisma.image.update({ where: { image_id }, data: { arweave_uri, sha256: sha256_hex } })
    // TODO: return { ok: true, result: { arweave_uri, sha256: sha256_hex, enc_final } }
    return {
        ok: false,
        error_code: "ARWEAVE_UPLOAD_FAILED",
        message: "ArDrive Turbo SDK + asymmetric scheme not yet wired.",
    };
}
