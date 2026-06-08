// takedown.ts
// MVP reactive content removal post-publication. Moderator (founder at MVP)
// admin tool sets images.status = 'taken_down' with a free-text reason.
// Spec: /docs/cert/takedown.md
//
// Tier 0 pre-publication CSAM-driven takedown flows through moderation, not
// this module. This is for live/sold images flagged via the public Report
// mailto link or moderator self-discovery.
// Post-mint deed legal_state / custody_state mutations (disputed / void / burned) require
// 3-of-5 multi-sig per INV-06 and is deferred to MMP.

import { prisma } from '../db';

export type TakedownErrorCode =
    | "IMAGE_NOT_FOUND"
    | "TAKEDOWN_REASON_REQUIRED"
    | "ROLE_REQUIRED";

export interface TakedownInput {
    image_id: string;            // 5-char base-36
    reviewer_id: string;         // moderator user_id (founder at MVP)
    takedown_reason: string;     // free-text at MVP (DMCA, RoP, ToS-violation, etc.)
}

export type TakedownResult =
    | { ok: true }
    | { ok: false; error_code: TakedownErrorCode; message: string };

// Idempotent: re-takedown of an already taken-down image is a no-op; original
// reason preserved (R71 §3.8 image lifecycle).
export async function recordTakedown(input: TakedownInput): Promise<TakedownResult> {
    if (!input.takedown_reason || !input.takedown_reason.trim()) {
        return { ok: false, error_code: "TAKEDOWN_REASON_REQUIRED", message: "Reason required." };
    }
    // Moderator-role check is enforced upstream at the admin route (identity.requireRole).
    const image = await prisma.image.findUnique({
        where: { image_id: input.image_id },
        select: { status: true },
    });
    if (!image) {
        return { ok: false, error_code: "IMAGE_NOT_FOUND", message: `No image with id ${input.image_id}.` };
    }
    // Already taken down -> no-op; preserve the original reason.
    if (image.status === 'taken_down') {
        return { ok: true };
    }
    await prisma.image.update({
        where: { image_id: input.image_id },
        data: { status: 'taken_down', takedown_reason: input.takedown_reason },
    });
    // TODO: cdn.purgePublicPage(input.image_id) -- propagate suppression (<=60s)
    return { ok: true };
}
