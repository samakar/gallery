// post_mint.ts
// Post-mint finalization -- inserts the Deed row, flips Image.status to 'sold',
// and advances Purchase.status to 'confirmed'. Called inline from
// /src/commerce/run_image_ops after cnft_dispatch returns success
// (the cNFT mint is synchronous per ADR-0008; no webhook involved).
//
// Extracted from the legacy /src/registry/crossmint_webhook.ts. The two
// exported functions are vendor-agnostic -- they take an asset_id (Metaplex
// DAS identifier for the cNFT leaf) and a tx signature and don't care how
// the mint was dispatched.

import { prisma } from '../db';
import { refundPurchase } from '../commerce/payments';
import { sendCoaEmail } from '../cert/email';
import { buildThumbnailUrl } from '../commerce/image_gen';

// Idempotent: if the Deed already exists for this image_id, just sync the
// Purchase row and return ok.
export async function applyMintSucceeded(
    purchaseId: string,
    assetId: string,
    transactionSignature: string | null,
    ownerWallet: string | null,
    snapshots?: {
        creator_snapshot: Record<string, unknown> | null;
        video_snapshot: Record<string, unknown> | null;
    },
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

    let isFirstMint = false;
    await prisma.$transaction(async tx => {
        if (!purchase.image.deed) {
            isFirstMint = true;
            await tx.deed.create({
                data: {
                    image_id: purchase.image_id,
                    asset_id: assetId,
                    owner_wallet_address: ownerWallet ?? purchase.owner.user.wallet_address ?? assetId,
                    owner_id: purchase.owner_id,
                    custody_state: 'sealed',
                    legal_state: 'legit',
                    variant_hashes: variantHashes,
                    // Mirror moment-of-sealing YouTube snapshots to the DB row
                    // (also embedded into the Arweave metadata JSON). Null when
                    // creator has no YouTube association OR the API fetch
                    // failed at mint. No backfill at MVP per product scope.
                    creator_snapshot: snapshots?.creator_snapshot
                        ? JSON.stringify(snapshots.creator_snapshot)
                        : null,
                    video_snapshot: snapshots?.video_snapshot
                        ? JSON.stringify(snapshots.video_snapshot)
                        : null,
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

    // COA email at first mint per /docs/cert/email.md §3.2. Fire-and-forget;
    // failure doesn't roll back the on-chain artifact. Idempotency key is
    // 'coa:<image_id>' so retries land at most once. We don't re-send on
    // duplicate calls to applyMintSucceeded (isFirstMint gate).
    if (isFirstMint) {
        setImmediate(async () => {
            try {
                await sendCoaEmailForPurchase(purchase, assetId, transactionSignature, variantHashes);
            } catch (e: any) {
                console.error('[post_mint] coa email exception', { purchase_id: purchase.id, err: e?.message ?? e });
            }
        });
    }
}

// Helper: assemble the COA-email envelope from the purchase + image + deed
// context. Kept private here because the data assembly is mint-specific;
// re-encoding it for resale (post-MVP) gets its own helper at that time.
async function sendCoaEmailForPurchase(
    purchase: Awaited<ReturnType<typeof prisma.purchase.findUnique>> & { image: any; owner: any },
    assetId: string,
    transactionSignature: string | null,
    variantHashesJson: string,
): Promise<void> {
    if (!purchase) return;
    const platformBaseUrl = process.env.PLATFORM_BASE_URL ?? 'https://epimage.com';
    const solanaCluster = (process.env.SOLANA_RPC ?? '').includes('devnet') ? 'devnet' : 'mainnet';

    // Fetch the creator + buyer details we need for the PDFs.
    const image = await prisma.image.findUnique({
        where: { image_id: purchase.image_id },
        include: {
            creator: { include: { user: true } },
            signatures: { where: { document_type: 'COA' }, take: 1, orderBy: { clicked_at: 'desc' } },
        },
    });
    if (!image) return;
    const creatorUser = image.creator.user;
    const buyerUser = purchase.owner.user;
    const creatorEmail = creatorUser.email;
    const buyerEmail = buyerUser.email;
    if (!creatorEmail || !buyerEmail) return;

    // CMA + MJA signature rows for the evidentiary chain.
    const [cmaSig, mjaSig, licenseSig] = await Promise.all([
        prisma.signature.findFirst({
            where: { user_id: creatorUser.user_id, document_type: 'CMA' },
            orderBy: { clicked_at: 'desc' },
        }),
        prisma.signature.findFirst({
            where: { user_id: buyerUser.user_id, document_type: 'MJA' },
            orderBy: { clicked_at: 'desc' },
        }),
        purchase.signing_event_id_license
            ? prisma.signature.findUnique({ where: { id: purchase.signing_event_id_license } })
            : Promise.resolve(null),
    ]);

    const variantHashes = (() => { try { return JSON.parse(variantHashesJson); } catch { return {}; } })();
    const sha256 = variantHashes['M+00']?.sha256 ?? image.sha256 ?? '';
    const isaSignatureId = image.signatures[0]?.id ?? null;
    const deedPageUrl = `${platformBaseUrl}/${image.image_id}/deed`;
    const thumbnailUrl = buildThumbnailUrl(image.image_id);
    const mintedAt = new Date().toISOString();
    const creationDate = image.creation_date instanceof Date ? image.creation_date.toISOString() : String(image.creation_date);

    await sendCoaEmail({
        to: [creatorEmail, buyerEmail],
        image_id: image.image_id,
        title: image.title,
        creator_display_name: image.creator.display_name,
        buyer_identifier: buyerEmail,
        coa: {
            image_id: image.image_id,
            title: image.title,
            creator_display_name: image.creator.display_name,
            creator_youtube_handle: image.creator.youtube_channel_handle,
            creation_date: creationDate,
            edition: 'Unique',
            asset_id: assetId,
            solana_cluster: solanaCluster,
            sha256,
            arweave_uri: image.arweave_uri,
            isa_signature_id: isaSignatureId,
            deed_page_url: deedPageUrl,
            thumbnail_url: thumbnailUrl,
            minted_at: mintedAt,
        },
        title_document: {
            image_id: image.image_id,
            title: image.title,
            transaction_signature: transactionSignature ?? 'pending',
            timestamp: mintedAt,
            price_cents: purchase.amount_gross_cents ?? 0,
            royalty_pct: 10,
            creator_legal_name: image.creator.legal_name,
            buyer_identifier: buyerEmail,
            asset_id: assetId,
            solana_cluster: solanaCluster,
            deed_page_url: deedPageUrl,
        },
        purchase_receipt: {
            image_id: image.image_id,
            title: image.title,
            cma_version_hash: cmaSig?.document_version_hash ?? '',
            bma_version_hash: mjaSig?.document_version_hash ?? '',
            license_signing_event_id: purchase.signing_event_id_license ?? null,
            asset_id: assetId,
            transaction_signature: transactionSignature ?? 'pending',
            timestamp: mintedAt,
            price_cents: purchase.amount_gross_cents ?? 0,
            creator_net_cents: purchase.amount_creator_net_cents ?? 0,
            platform_net_cents: purchase.amount_platform_net_cents ?? 0,
        },
        license: {
            signature_id: licenseSig?.id ?? '',
            document_version_label: licenseSig?.document_version_label ?? 'License-1.0',
            document_version_hash: licenseSig?.document_version_hash ?? '',
            clicked_at: licenseSig?.clicked_at?.toISOString() ?? mintedAt,
            ip_address: licenseSig?.ip_address ?? '0.0.0.0',
            session_token_hash: licenseSig?.session_token_hash ?? '',
            // At MVP the per-image License parameters aren't persisted as a
            // dedicated table -- the License doc body covers them. Inline an
            // empty params object; future revisions will populate from a
            // license_params column.
            license_params: {},
            buyer_identifier: buyerEmail,
            image_id: image.image_id,
            title: image.title,
        },
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
    // mint.failed triggers a Stripe refund. refundPurchase is idempotent via
    // Stripe's idempotencyKey, so repeated calls on duplicates are safe.
    const refundResult = await refundPurchase(purchaseId, 'requested_by_customer');
    if (!refundResult.ok) {
        console.error('[post_mint] refund failed for purchase', purchaseId, refundResult);
    }
}
