// rights.ts
// MVP rights / license configuration. Fixed defaults: 10% creator royalty,
// single beneficiary, Unique edition only.
// Spec: /docs/cert/rights.md
//
// Operational enforcement lives elsewhere: royalty on resale via the Metaplex
// Core royalty plugin (onchain); contractual binding via License Acceptance
// (esign). This module owns the MVP rights constants and the License Acceptance
// text rendering.

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

export interface LicenseAcceptanceContext {
    image_id: string;
    creator_display_name: string;
    listing_title: string;
}

// Renders per-image License Acceptance text (R62 §3.4) for esign to hash and
// capture. Fixed template at MVP; only the per-image context is substituted.
export function renderLicenseAcceptanceText(ctx: LicenseAcceptanceContext): string {
    return [
        `License Acceptance for "${ctx.listing_title}" by ${ctx.creator_display_name} (image-id ${ctx.image_id}).`,
        ``,
        `Buyer accepts the Exclusive License for this image, established in conjunction`,
        `with the Creator Master Agreement and Master Joinder Agreement, on the`,
        `following terms:`,
        ``,
        `- Field of use: personal collection, public display, social sharing.`,
        `- Territory: worldwide.`,
        `- Term: perpetual, subject to deed state transitions.`,
        `- Commercial-use permission: none at MVP. Commercial reproduction requires`,
        `  creator-enabled rights (R62 §5; deferred to MMP).`,
        `- Sublicensing: not permitted.`,
        `- Derivative-work rights: none.`,
        `- Display permissions: per Owner Privacy and Share Flow (R71 §2.6).`,
        `- Royalty terms: ${MVP_ROYALTY_PCT}% to the creator on every secondary transfer,`,
        `  enforced via the Metaplex Core royalty plugin at mint.`,
    ].join('\n');
}
