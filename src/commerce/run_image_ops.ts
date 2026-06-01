// run_image_ops.ts
// Card 5 build pipeline. Triggered by the buyer's
// POST /v1/purchases/:id/start-build (NOT by the Stripe webhook, per ADR-0001).
// Spec: /docs/commerce/run_image_ops.md
//
// MVP scope:
//   - Skip Arweave master upload (TODO -- arweave_master subsystem not wired).
//     We dispatch the mint with arweave_uri=null + sha256/phash=null; the
//     Crossmint metadata schema still carries those slots so the swap is a
//     no-op when arweave_master ships.
//   - Skip Share Copy build with buyer monogram (TODO -- image_gen.generateShareCopy
//     not wired). Use the existing Cloudinary listing preview URL as the NFT image.
//   - Dispatch to real Crossmint staging via /src/registry/crossmint_dispatch.
//   - Terminal mint_address arrives via the Crossmint webhook OR via polling
//     fallback in the status endpoint.

import { prisma } from '../db';
import { dispatch } from '../registry/crossmint_dispatch';
import { buildAndUpload as buildAndUploadArweave } from '../registry/arweave_master';
import { buildListingPreviewUrl } from './image_gen';
import { getStripe } from './payments';

export interface StartBuildInput {
    purchase_id: string;
    monogram_text: string; // ADR-0001 inline param, not persisted at Purchase row
}

export interface StartBuildResult {
    ok: true;
    crossmint_job_id: string;
    onchain_status: string;
    // mint_address arrives later via webhook / polling -- not in this response.
}

export async function startBuild(input: StartBuildInput): Promise<StartBuildResult> {
    const purchase = await prisma.purchase.findUnique({
        where: { id: input.purchase_id },
        include: {
            image: { include: { creator: true, deed: true } },
            owner: { include: { user: true } },
        },
    });
    if (!purchase) throw new Error(`Purchase ${input.purchase_id} not found`);
    if (purchase.image.deed) {
        // Already minted (idempotent re-call). Return the existing job id if
        // we kept one; else synthesize a deterministic marker.
        return {
            ok: true,
            crossmint_job_id: purchase.crossmint_job_id ?? 'already_minted',
            onchain_status: 'success',
        };
    }

    // Race recovery: the browser may land on the success URL faster than
    // Stripe's webhook reaches our server. If the local row is still
    // 'started' but Stripe's session is paid, advance locally. The webhook
    // will idempotently no-op when it eventually arrives.
    if (purchase.status === 'started' && purchase.stripe_checkout_session_id) {
        try {
            const stripe = getStripe();
            const session = await stripe.checkout.sessions.retrieve(
                purchase.stripe_checkout_session_id,
            );
            if (session.payment_status === 'paid') {
                const pi = typeof session.payment_intent === 'string'
                    ? session.payment_intent
                    : session.payment_intent?.id ?? null;
                await prisma.purchase.updateMany({
                    where: { id: purchase.id, status: 'started' },
                    data: {
                        status: 'paid',
                        stripe_payment_intent_id: pi,
                        amount_gross_cents: session.amount_total ?? null,
                    },
                });
                purchase.status = 'paid';
            }
        } catch (e) {
            console.warn(
                '[run_image_ops] stripe race-recovery lookup failed',
                (e as Error).message,
            );
        }
    }

    if (purchase.status !== 'paid' && purchase.status !== 'building') {
        throw new Error(`Purchase status is ${purchase.status}, expected 'paid' or 'building'`);
    }

    const buyerWallet = purchase.owner.user.wallet_address;
    const buyerEmail = purchase.owner.user.email;
    if (!buyerWallet && !buyerEmail) {
        throw new Error('Buyer has neither wallet_address nor email -- cannot mint');
    }

    // Flip to 'building' early so a duplicate start-build call sees it.
    await prisma.purchase.updateMany({
        where: { id: purchase.id, status: 'paid' },
        data: {
            status: 'building',
            monogram_text: input.monogram_text,
        },
    });

    const previewUrl = buildListingPreviewUrl(purchase.image_id);

    // Step (b) per spec: upload the Master to Arweave via Turbo. MVP scope:
    // uploads a manifest JSON (preview URL + hashes), not the encrypted Master
    // bytes themselves. Idempotent -- skips if arweave_uri is already set.
    const arweaveResult = await buildAndUploadArweave({
        image_id: purchase.image_id,
        buyer_wallet_pubkey: buyerWallet,
        preview_url: previewUrl,
        title: purchase.image.title,
        creator_display_name: purchase.image.creator.display_name,
    });
    if (!arweaveResult.ok) {
        // Roll back to 'paid'; surface the error to the buyer.
        await prisma.purchase.updateMany({
            where: { id: purchase.id, status: 'building' },
            data: { status: 'paid' },
        });
        throw new Error(`${arweaveResult.error_code}: ${arweaveResult.message}`);
    }

    const dispatchResult = await dispatch({
        image_id: purchase.image_id,
        buyer_wallet: buyerWallet,
        buyer_email: buyerEmail,
        title: purchase.image.title,
        description: purchase.image.description,
        creator_display_name: purchase.image.creator.display_name,
        preview_url: previewUrl,
        arweave_uri: arweaveResult.result.arweave_uri,
        sha256: arweaveResult.result.sha256,
        phash: arweaveResult.result.phash,
        license_signing_event_id: null,
        royalty_pct: 10,
        creator_wallet: null, // TODO: creator.user.wallet_address once wallets subsystem populates it
    });

    if (!dispatchResult.ok) {
        // Roll back to 'paid' so the buyer can retry; surface the error.
        await prisma.purchase.updateMany({
            where: { id: purchase.id, status: 'building' },
            data: { status: 'paid' },
        });
        throw new Error(`${dispatchResult.error_code}: ${dispatchResult.message}`);
    }

    await prisma.purchase.update({
        where: { id: purchase.id },
        data: {
            crossmint_job_id: dispatchResult.crossmint_job_id,
            status: 'minting',
        },
    });

    return {
        ok: true,
        crossmint_job_id: dispatchResult.crossmint_job_id,
        onchain_status: dispatchResult.onchain_status,
    };
}
