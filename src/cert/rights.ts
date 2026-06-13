// rights.ts
// MVP rights / license configuration. Fixed defaults: 10% creator royalty,
// single beneficiary, Unique edition only.
// Spec: /docs/registry/deed.md §1.1 (Rights tuple paragraph + royalty_pct,
// royalty_recipients, edition schema rows). Per-image SAL agreement text lives
// in the legal binder per /docs/cert/legal_binder.md.
//
// Operational enforcement lives elsewhere: royalty on resale via the Metaplex
// Core royalty plugin (onchain); contractual binding via the SAL signature
// (esign + binder). This module's surface is dead at MVP (no callers) -- it
// remains as an accessor stub for cnft_dispatch's future Crossmint integration.

import { prisma } from '../db';

export const MVP_ROYALTY_PCT = 10;
export const MVP_EDITION_TIER = "Unique" as const;

export interface RoyaltyRecipient {
    address: string;     // Solana base58
    share: number;       // 0-100; sum to 100
}

export interface DeedRightsParams {
    royalty_pct: number;
    royalty_recipients: RoyaltyRecipient[];
    edition_tier: "Unique";    // Limited / Unlimited deferred to MMP
}

// Returns the rights tuple to embed in deed metadata at Crossmint mint
// dispatch (R71 §2.4 step 14). Resolves the creator's wallet for
// royalty_recipients.
export async function getDeedRightsParams(image_id: string): Promise<DeedRightsParams> {
    const image = await prisma.image.findUnique({
        where: { image_id },
        include: { creator: { include: { user: { select: { wallet_address: true } } } } },
    });
    if (!image) {
        throw new Error(`Image not found: ${image_id}`);
    }
    const walletAddress = image.creator.user.wallet_address;
    if (!walletAddress) {
        throw new Error(
            `Creator wallet not provisioned for ${image.creator.user_id}; CMA must precede mint per INV-2.`
        );
    }
    return {
        royalty_pct: MVP_ROYALTY_PCT,
        royalty_recipients: [{ address: walletAddress, share: 100 }],
        edition_tier: MVP_EDITION_TIER,
    };
}

// SAL contract text was previously rendered here as a template. Under the
// legal-binder architecture (cert/legal_binder.md) the canonical SAL bytes
// live in binder.entries[sal].content; per-deed values like image_id and
// royalty_pct are SAL props (binder.entries[sal].props_schema). Callers
// fetching SAL text should go through getActiveBinder() instead.
