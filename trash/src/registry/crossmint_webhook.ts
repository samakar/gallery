// crossmint_webhook.ts
// Receives mint.succeeded / mint.failed callbacks from Crossmint.
// Spec: /docs/registry/crossmint_webhook.md
//
// Express route mounts express.raw so HMAC sees byte-exact body. The actual
// signature scheme Crossmint uses is HMAC-SHA256 over the raw body with
// CROSSMINT_WEBHOOK_SECRET, sent in `X-Crossmint-Signature`. When the secret
// isn't set we skip verification (dev convenience) and log a warning.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { refundPurchase } from '../commerce/payments';

export type WebhookErrorCode = 'CROSSMINT_SIGNATURE_INVALID';

export type WebhookResult =
    | { ok: true; event_type?: string }
    | { ok: false; error_code: WebhookErrorCode; message: string };

interface CrossmintMintData {
    id: string;
    onChain?: {
        status?: string;
        mintHash?: string;
        txHash?: string;
        owner?: string;
    };
    actionFailReason?: string;
    metadata?: {
        attributes?: Array<{ trait_type?: string; value?: string }>;
    };
}

interface CrossmintEvent {
    // Crossmint event type, e.g. "nft.create.succeeded", "nft.create.failed".
    // Older docs use "mint.succeeded" / "mint.failed"; we accept both shapes.
    event?: string;
    type?: string;
    data?: CrossmintMintData;
}

function verifySignature(raw: Buffer, signature: string, secret: string): boolean {
    const computed = createHmac('sha256', secret).update(raw).digest('hex');
    // Strip a possible "sha256=" prefix Crossmint sometimes emits.
    const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
    if (computed.length !== provided.length) return false;
    try {
        return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(provided, 'hex'));
    } catch {
        return false;
    }
}

// Resolve the Purchase row for a Crossmint mint event. Primary lookup is by
// crossmint_job_id (which we persisted at dispatch). Fallback reads the
// image_id from the NFT metadata attributes if the job id isn't found -- this
// covers the rare case where the dispatch response timed out before we could
// save the job id.
async function findPurchaseForEvent(data: CrossmintMintData) {
    if (data.id) {
        const byJob = await prisma.purchase.findUnique({
            where: { crossmint_job_id: data.id },
            include: { image: { include: { creator: true, deed: true } } },
        });
        if (byJob) return byJob;
    }
    const imageIdAttr = data.metadata?.attributes?.find(a => a.trait_type === 'image_id')?.value;
    if (imageIdAttr) {
        return prisma.purchase.findFirst({
            where: { image_id: imageIdAttr, status: 'minting' },
            include: { image: { include: { creator: true, deed: true } } },
            orderBy: { created_at: 'desc' },
        });
    }
    return null;
}

// Idempotent: if the Deed already exists for this image_id, just sync the
// Purchase row and return ok. Real entry point for both the webhook path
// AND the polling-fallback path -- both call into this to flip end-state.
export async function applyMintSucceeded(
    purchaseId: string,
    mintAddress: string,
    transactionSignature: string | null,
    ownerWallet: string | null,
): Promise<void> {
    const purchase = await prisma.purchase.findUnique({
        where: { id: purchaseId },
        include: { image: { include: { deed: true } }, owner: { include: { user: true } } },
    });
    if (!purchase) return;
    const variantHashes = JSON.stringify({
        'M+00': {
            sha256: purchase.image.sha256 ?? null,
            phash: purchase.image.phash ?? null,
            anchored_at: new Date().toISOString(),
        },
    });

    await prisma.$transaction(async tx => {
        if (!purchase.image.deed) {
            await tx.deed.create({
                data: {
                    image_id: purchase.image_id,
                    mint_address: mintAddress,
                    owner_wallet_address: ownerWallet ?? purchase.owner.user.wallet_address ?? mintAddress,
                    owner_id: purchase.owner_id,
                    deed_state: 'sealed',
                    variant_hashes: variantHashes,
                    minted_at: new Date(),
                },
            });
            // Image transitions per R62 §4.7.
            await tx.image.update({
                where: { image_id: purchase.image_id },
                data: {
                    status: 'sold',
                    visibility: 'private',
                    privacy_updated_at: new Date(),
                },
            });
        }
        // Conditional update so duplicate calls no-op.
        await tx.purchase.updateMany({
            where: { id: purchase.id, status: { in: ['minting', 'paid', 'building'] } },
            data: {
                status: 'confirmed',
                deed_mint_tx_signature: transactionSignature,
                completed_at: new Date(),
            },
        });
    });
}

export async function applyMintFailed(purchaseId: string, reason: string): Promise<void> {
    await prisma.purchase.updateMany({
        where: { id: purchaseId, status: { in: ['minting', 'paid', 'building'] } },
        data: {
            status: 'failed',
            failure_reason: `MINT_FAILED:${reason}`,
        },
    });
    // Per crossmint_webhook spec §2.3: mint.failed triggers a Stripe refund.
    // refundPurchase is idempotent via Stripe's idempotencyKey, so repeated
    // calls on duplicate webhooks are safe.
    const refundResult = await refundPurchase(purchaseId, 'requested_by_customer');
    if (!refundResult.ok) {
        console.error('[crossmint.webhook] refund failed for purchase', purchaseId, refundResult);
    }
}

// POST /v1/webhooks/crossmint (R71 §3.7 row 22).
// Express route uses express.raw so HMAC sees byte-exact body.
export async function handleWebhook(
    raw_body: Buffer,
    signature: string,
): Promise<WebhookResult> {
    const secret = process.env.CROSSMINT_WEBHOOK_SECRET;
    if (secret) {
        if (!signature || !verifySignature(raw_body, signature, secret)) {
            return {
                ok: false,
                error_code: 'CROSSMINT_SIGNATURE_INVALID',
                message: 'HMAC mismatch',
            };
        }
    } else {
        console.warn(
            '[crossmint.webhook] CROSSMINT_WEBHOOK_SECRET not set -- skipping signature verification (dev only).'
        );
    }

    let event: CrossmintEvent;
    try {
        event = JSON.parse(raw_body.toString()) as CrossmintEvent;
    } catch {
        // Malformed body but signature was valid -- ack to avoid retries.
        return { ok: true };
    }

    const eventName = (event.type ?? event.event ?? '').toLowerCase();
    const data = event.data;
    if (!data) return { ok: true, event_type: eventName };

    try {
        if (eventName.endsWith('.succeeded') || eventName.endsWith('.success')) {
            const purchase = await findPurchaseForEvent(data);
            if (purchase && data.onChain?.mintHash) {
                await applyMintSucceeded(
                    purchase.id,
                    data.onChain.mintHash,
                    data.onChain.txHash ?? null,
                    data.onChain.owner ?? null,
                );
            }
        } else if (eventName.endsWith('.failed')) {
            const purchase = await findPurchaseForEvent(data);
            if (purchase) {
                await applyMintFailed(purchase.id, data.actionFailReason ?? 'unknown');
            }
        }
    } catch (e) {
        console.error('[crossmint.webhook] handler error', eventName, e);
        // Spec § 2.3: still ack so Crossmint doesn't retry-storm. Surface via log.
    }

    return { ok: true, event_type: eventName };
}
