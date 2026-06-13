// run_image_ops.ts
// Card 5 build pipeline. Triggered by the buyer's
// POST /v1/purchases/:id/start-build (NOT by the Stripe webhook, per ADR-0001).
// Spec: /docs/commerce/run_image_ops.md
//
// MVP scope (post ADR-0008 cNFT migration):
//   - Upload encrypted Master to Arweave via /src/registry/arweave_master.
//   - Build Share Copy with buyer monogram (TODO -- image_gen.generateShareCopy
//     not wired). Use the existing Cloudinary listing preview URL as the NFT image.
//   - Self-mint Bubblegum V2 cNFT under our MPL-Core Collection via
//     /src/registry/cnft_dispatch (synchronous; no Crossmint webhook).
//   - Persist Deed row + flip image to sold immediately on mint success via
//     applyMintSucceeded (extracted from the legacy crossmint_webhook module
//     and reused as-is; only the dispatch upstream changed).

import { prisma } from '../db';
import { dispatch } from '../registry/cnft_dispatch';
import { applyMintSucceeded } from '../registry/post_mint';
import { buildAndUpload as buildAndUploadArweave } from '../registry/arweave_master';
import { buildListingPreviewUrl } from './image_gen';
import { getStripe } from './payments';
import { unwrapDek, buildEncFinal } from '../cert/crypto';
import { fetchCreatorSnapshot, fetchVideoSnapshot } from '../cert/youtube_snapshot';

// Quick local check matching the looksLikeSolanaAddress test in
// crossmint_dispatch -- enc_final requires a real Solana wallet for the
// asymmetric inner layer; if the buyer doesn't have one yet (e.g. email-
// recipient flow), we skip enc_final and Crossmint will backfill later.
function looksLikeSolanaAddress(s: string | null): boolean {
    if (!s) return false;
    if (s.startsWith('0x')) return false;
    if (s.length < 32 || s.length > 44) return false;
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

export interface StartBuildInput {
    purchase_id: string;
    monogram_text: string; // ADR-0001 inline param, not persisted at Purchase row
}

export interface StartBuildResult {
    ok: true;
    crossmint_job_id: string;
    onchain_status: string;
    // asset_id is now produced synchronously by cnft_dispatch (Path 4); this
    // shape is kept for callers that still treat the build as async.
}

export async function startBuild(input: StartBuildInput): Promise<StartBuildResult> {
    const purchase = await prisma.purchase.findUnique({
        where: { id: input.purchase_id },
        include: {
            image: { include: { creator: { include: { user: true } }, deed: true } },
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

    // Step (b) per spec: upload the encrypted Master to Arweave via Turbo
    // (R62 §1.5/§2.3 single-layer AES-256-GCM with DEK_image). The arweave_master
    // module reads the ciphertext from EncryptedMasterStore (written at Card 1)
    // and uploads it as-is -- no Cloudinary round-trip, no re-encryption. The
    // doubly-nested enc_final (asymmetric inner to wallet pubkey + symmetric
    // outer with PLATFORM_DEK) is constructed below and written to on-chain
    // deed metadata via cnft_dispatch. Idempotent -- skips if arweave_uri is
    // already set.
    const arweaveResult = await buildAndUploadArweave({
        image_id: purchase.image_id,
        buyer_wallet_pubkey: buyerWallet,
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

    // enc_final per R62 §2.3: asymmetric inner wrap to buyer wallet, outer
    // wrap with PLATFORM_DEK. Skipped when the buyer doesn't have a valid
    // Solana wallet yet -- Crossmint's email-recipient flow provisions one
    // post-mint, and we can backfill on the Deed row later.
    let enc_final: string | null = null;
    const refreshed = await prisma.image.findUnique({
        where: { image_id: purchase.image_id },
        select: { dek_wrapped: true },
    });
    if (refreshed?.dek_wrapped && looksLikeSolanaAddress(buyerWallet)) {
        try {
            const dek_image = unwrapDek(Buffer.from(refreshed.dek_wrapped));
            enc_final = buildEncFinal(dek_image, buyerWallet!);
        } catch (e) {
            console.warn('[run_image_ops] enc_final construction failed', (e as Error).message);
        }
    }

    // Creator's per-image ISA -- threaded into the on-chain Arweave metadata
    // JSON as the deed's creator-side COA leg. License (buyer-side) is on
    // purchase.signing_event_id_license below.
    let creator_isa_signing_event_id: string | null = null;
    let creator_isa_signed_at: string | null = null;
    if (purchase.image.signing_event_id_authorship) {
        const isa = await prisma.signature.findUnique({
            where: { id: purchase.image.signing_event_id_authorship },
            select: { id: true, clicked_at: true },
        });
        if (isa) {
            creator_isa_signing_event_id = isa.id;
            creator_isa_signed_at = isa.clicked_at.toISOString();
        }
    }

    // Parse stored image_spec JSON (set at Card 1 per R62 §2.3 7-field block).
    // Falls back to null on malformed legacy rows -- the metadata JSON will
    // carry image_spec=null rather than failing the whole mint.
    let parsedImageSpec: Record<string, unknown> | null = null;
    if (purchase.image.image_spec) {
        try {
            parsedImageSpec = JSON.parse(purchase.image.image_spec) as Record<string, unknown>;
        } catch (e) {
            console.warn('[run_image_ops] image_spec JSON parse failed for', purchase.image_id, (e as Error).message);
        }
    }
    // Parse stored capture_setup JSON (set at Card 1; EXIF-derived camera /
    // lens / exposure block). Falls back to null on malformed rows.
    let parsedCaptureSetup: Record<string, unknown> | null = null;
    if (purchase.image.capture_setup) {
        try {
            parsedCaptureSetup = JSON.parse(purchase.image.capture_setup) as Record<string, unknown>;
        } catch (e) {
            console.warn('[run_image_ops] capture_setup JSON parse failed for', purchase.image_id, (e as Error).message);
        }
    }

    // Moment-of-sealing YouTube snapshots (creator_snapshot + video_snapshot).
    // Fetched best-effort just before mint -- API failures yield null and the
    // mint proceeds (the deed simply records `null` blocks). No backfill at
    // MVP per product scope. Each fetcher applies its own ~10s timeout.
    const creatorYoutubeChannelId = purchase.image.creator.user.youtube_channel_id;
    const creatorOwnershipVerified = !!purchase.image.creator.user.youtube_verified_at;
    const creator_snapshot = creatorYoutubeChannelId
        ? await fetchCreatorSnapshot(creatorYoutubeChannelId, creatorOwnershipVerified)
        : null;
    const video_snapshot = purchase.image.video_url
        ? await fetchVideoSnapshot(
              purchase.image.video_url,
              purchase.image.video_moment_seconds,
          )
        : null;

    const dispatchResult = await dispatch({
        image_id: purchase.image_id,
        buyer_wallet: buyerWallet,
        buyer_email: buyerEmail,
        title: purchase.image.title,
        description: purchase.image.description,
        story: purchase.image.story ?? null,
        creator_display_name: purchase.image.creator.display_name,
        preview_url: buildListingPreviewUrl(purchase.image_id),
        arweave_uri: arweaveResult.result.arweave_uri,
        sha256: arweaveResult.result.sha256,
        pixel_sha256: purchase.image.pixel_sha256,
        phash: arweaveResult.result.phash,
        enc_final,
        license_signing_event_id: purchase.signing_event_id_license ?? null,
        royalty_pct: 10,
        creator_wallet: null, // TODO: creator.user.wallet_address once wallets subsystem populates it
        creator_isa_signing_event_id,
        creator_isa_signed_at,
        // COA-relevant creator-entered facts (R71 §3.6: 1 of 1 at MVP). Only
        // edition-stable fields go on the shared Arweave JSON; the per-edition
        // ordinal lives on the cNFT leaf, not here.
        creation_date: purchase.image.creation_date?.toISOString() ?? null,
        edition_total: 1,
        image_spec: parsedImageSpec,
        capture_setup: parsedCaptureSetup,
        creator_snapshot: creator_snapshot as Record<string, unknown> | null,
        video_snapshot: video_snapshot as Record<string, unknown> | null,
    });

    if (!dispatchResult.ok) {
        // Roll back to 'paid' so the buyer can retry; surface the error.
        await prisma.purchase.updateMany({
            where: { id: purchase.id, status: 'building' },
            data: { status: 'paid' },
        });
        throw new Error(`${dispatchResult.error_code}: ${dispatchResult.message}`);
    }

    // cNFT mint is synchronous (no Crossmint async webhook). Persist the tx
    // signature, then run the same applyMintSucceeded path the webhook used --
    // it inserts the Deed row, flips images.status to 'sold', and advances the
    // Purchase to 'confirmed'.
    await prisma.purchase.update({
        where: { id: purchase.id },
        data: {
            crossmint_job_id: dispatchResult.crossmint_job_id,
            status: 'minting',
        },
    });
    await applyMintSucceeded(
        purchase.id,
        dispatchResult.asset_id,
        dispatchResult.crossmint_job_id,
        buyerWallet,
        {
            creator_snapshot: creator_snapshot as Record<string, unknown> | null,
            video_snapshot: video_snapshot as Record<string, unknown> | null,
        },
    );

    return {
        ok: true,
        crossmint_job_id: dispatchResult.crossmint_job_id,
        onchain_status: dispatchResult.onchain_status,
    };
}
