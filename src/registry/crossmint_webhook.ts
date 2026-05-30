// crossmint_webhook.ts
// Receives mint.succeeded / mint.failed callbacks from Crossmint.
// Spec: /docs/registry/crossmint_webhook.md

// TODO: import { onMintSucceeded } from '../commerce/metadata';
// TODO: import { refundPurchase } from '../commerce/payments';

export type WebhookErrorCode = "CROSSMINT_SIGNATURE_INVALID";

export type WebhookResult =
    | { ok: true }
    | { ok: false; error_code: WebhookErrorCode; message: string };

// POST /v1/webhooks/crossmint (R71 §3.7 row 22).
// Express route MUST use express.raw({ type: 'application/json' }) so HMAC
// operates on the exact bytes Crossmint signed.
export async function handleWebhook(
    _raw_body: Buffer,
    _signature: string
): Promise<WebhookResult> {
    // TODO: verify HMAC-SHA256(raw_body, process.env.CROSSMINT_WEBHOOK_SECRET) === signature
    //       (use Crossmint SDK helper if exposed; else crypto.timingSafeEqual)
    //       on mismatch -> return CROSSMINT_SIGNATURE_INVALID (caller returns 400)

    // TODO: const event = JSON.parse(raw_body.toString())
    // TODO: switch (event.type) {
    //   case 'mint.succeeded': {
    //     const { mint_address, transaction_signature, purchase_id } = extractFromMetadata(event)
    //     await prisma.deed.create({
    //       data: { image_id, mint_address, owner_wallet_address, owner_id,
    //               deed_state: 'sealed', variant_hashes, minted_at: new Date() }
    //     })
    //     await onMintSucceeded(image_id)  // metadata.onMintSucceeded (Commerce)
    //     await prisma.purchase.update({
    //       where: { id: purchase_id },
    //       data: { status: 'confirmed', deed_mint_tx_signature: transaction_signature }
    //     })  // conditional on status='minting' for idempotency
    //     break
    //   }
    //   case 'mint.failed': {
    //     await prisma.purchase.update({
    //       where: { id: purchase_id },
    //       data: { status: 'failed', failure_reason: `MINT_FAILED:${event.error_code}` }
    //     })
    //     await refundPurchase(purchase_id)  // payments.refundPurchase (Commerce)
    //     break
    //   }
    // }

    return { ok: true };
}
