// moderation.ts
// MVP content moderation: moderator manual two-checkbox review.
// Spec: /docs/cert/moderation.md
//
// Supersedes automated PhotoDNA (drm_csam) and Hive (drm_adult) at MVP per
// revised R71 §2.2 step 5 and §3.7 rows 6a/6b; those modules are parked
// under /deferred/ pending MMP automation. The moderator role is held by
// the founder at MVP; the module is named for the role, not the incumbent.
//
// Tier 0 (CSAM, NCII) takes precedence over Tier 1 (adult, violence, hate,
// drugs). Tier 2 (AI authenticity, RoP, sole-copy) is contractual via the
// creator ESIGN warranty (§2.2 step 6), not enforced here.

import { prisma } from '../db';

export type ModerationDecision =
    | "approved"
    | "rejected_tier1"
    | "rejected_tier0";

// R71 §3.7 "Error conventions".
export type ModerationErrorCode =
    | "REVIEW_TIER1_VIOLATION"
    | "REVIEW_TIER0_VIOLATION";

export interface ModerationChecks {
    tier0_clean: boolean;   // no CSAM, no NCII
    tier1_clean: boolean;   // no adult, violence, hate, drugs
}

export type ModerationResult =
    | { ok: true; decision: "approved"; image_review_id: string }
    | {
        ok: false;
        decision: "rejected_tier1" | "rejected_tier0";
        error_code: ModerationErrorCode;
        image_review_id: string;
        ncmec_ticket_id: string | null;   // populated iff rejected_tier0 (once NCMEC subflow wired)
    };

export interface ModerationInput {
    image_id: string;
    reviewer_id: string;     // moderator user_id (founder at MVP)
    creator_id: string;      // image owner; notification + suspension target
    checks: ModerationChecks;
}

// R71 §3.7 row 6b. Tier-0 precedence: unchecked Tier 0 drives the NCMEC
// subflow + account suspension regardless of Tier 1. The unchecked box IS
// the rejection reason; no free-text field is collected. DB ops (image_reviews
// insert + images status transition + Tier 0 user suspension) are real;
// external side-effects (storage staging purge, email notifications, NCMEC
// handoff) remain TODO until those subsystems land.
export async function submitModeration(input: ModerationInput): Promise<ModerationResult> {
    if (!input.checks.tier0_clean) return rejectTier0(input);
    if (!input.checks.tier1_clean) return rejectTier1(input);
    return approve(input);
}

async function rejectTier0(input: ModerationInput): Promise<ModerationResult> {
    const review = await prisma.imageReview.create({
        data: {
            image_id: input.image_id,
            reviewer_id: input.reviewer_id,
            decision: 'rejected_tier0',
            checks: JSON.stringify(input.checks),
        },
    });
    await prisma.image.update({
        where: { image_id: input.image_id },
        data: { status: 'taken_down', takedown_reason: 'tier0_violation_ncmec_reported' },
    });
    await prisma.user.update({
        where: { user_id: input.creator_id },
        data: { status: 'suspended' },
    });
    // Staging NOT purged: hash + metadata retained 90-day minimum for §2258A.
    // TODO: ncmec_ticket_id = ncmec.openChecklist(input.image_id) -- NCMEC handoff TBD
    // TODO: stamp image_reviews.ncmec_report_filed_at via prisma.imageReview.update
    //       once the ticket id returns from the NCMEC subflow
    return {
        ok: false,
        decision: 'rejected_tier0',
        error_code: 'REVIEW_TIER0_VIOLATION',
        image_review_id: review.id,
        ncmec_ticket_id: null,
    };
}

async function rejectTier1(input: ModerationInput): Promise<ModerationResult> {
    const review = await prisma.imageReview.create({
        data: {
            image_id: input.image_id,
            reviewer_id: input.reviewer_id,
            decision: 'rejected_tier1',
            checks: JSON.stringify(input.checks),
        },
    });
    await prisma.image.update({
        where: { image_id: input.image_id },
        data: { status: 'taken_down', takedown_reason: 'tier1_violation' },
    });
    // TODO: storage.purgeStaging(input.image_id) -- Commerce storage subsystem TBD
    // TODO: email.notifyTier1Rejected(input.creator_id, input.image_id) -- email subsystem TBD
    return {
        ok: false,
        decision: 'rejected_tier1',
        error_code: 'REVIEW_TIER1_VIOLATION',
        image_review_id: review.id,
        ncmec_ticket_id: null,
    };
}

async function approve(input: ModerationInput): Promise<ModerationResult> {
    const review = await prisma.imageReview.create({
        data: {
            image_id: input.image_id,
            reviewer_id: input.reviewer_id,
            decision: 'approved',
            checks: JSON.stringify(input.checks),
        },
    });
    await prisma.image.update({
        where: { image_id: input.image_id },
        data: { status: 'draft' },
    });
    // TODO: email.notifyApproved(input.creator_id, input.image_id) -- email subsystem TBD
    return { ok: true, decision: 'approved', image_review_id: review.id };
}
