// stale_paid_sweeper.ts
// OI-08 recovery: if the buyer closes their tab after Stripe success but
// before clicking through the monogram modal, the Purchase sits at 'paid'
// forever. This sweeper periodically scans for such rows, gives them a
// grace period, and auto-issues with a default monogram derived from the
// buyer's email.
//
// Runs as part of dev:server's startup. In prod this would be a separate
// cron job or queue consumer; the function is cleanly callable so swapping
// the trigger is one line.

import { prisma } from '../../db';
import { startBuild } from '../../commerce/run_image_ops';

const GRACE_MS = 5 * 60 * 1000;      // monogram set -- start retrying within 5 min
const SWEEP_INTERVAL_MS = 60 * 1000; // run the sweep once a minute

function defaultMonogramFromEmail(email: string | null): string {
    if (!email) return 'E';
    const local = email.split('@')[0] ?? '';
    const initial = local.charAt(0).toUpperCase();
    return /[A-Z]/.test(initial) ? initial : 'E';
}

export async function sweepStalePaid(): Promise<{ swept: number }> {
    const cutoff = new Date(Date.now() - GRACE_MS);
    // Only retry build dispatches the buyer has already initiated (monogram
    // chosen, "Mark my image" clicked). Purchases where the buyer paid but
    // never reached the monogram step are deliberately left alone -- the
    // system waits indefinitely for the buyer to come back and finish.
    // The image page's recovery path opens the BuyWizard at the monogram
    // step the moment they return signed in.
    const stale = await prisma.purchase.findMany({
        where: {
            status: 'paid',
            monogram_text: { not: null },
            created_at: { lt: cutoff },
        },
        include: {
            owner: { include: { user: { select: { email: true } } } },
        },
        take: 50,
    });
    let swept = 0;
    for (const p of stale) {
        // Prefer the buyer's persisted monogram (saved on the first build
        // attempt, or by the BuyWizard when the marker was first dispatched).
        // Fall back to the email-derived default only when the row has no
        // monogram -- which means the buyer closed the tab before clicking
        // Mark my image. Either way, the deed gets issued without further
        // user involvement.
        const monogram = p.monogram_text?.trim() || defaultMonogramFromEmail(p.owner.user.email);
        try {
            await startBuild({ purchase_id: p.id, monogram_text: monogram });
            console.log('[sweep.stale-paid] dispatched build for', p.id, 'monogram=', monogram);
            swept++;
        } catch (e) {
            // Expected on transient failures (Arweave out of credits,
            // Crossmint blip, etc.). startBuild rolls Purchase back to 'paid'
            // so the next sweep retries automatically.
            console.warn('[sweep.stale-paid] retry queued for', p.id, ':', (e as Error).message);
        }
    }
    return { swept };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startStalePaidSweeper(): void {
    if (timer) return;
    timer = setInterval(() => {
        sweepStalePaid().catch(e => console.error('[sweep.stale-paid] sweep error', e));
    }, SWEEP_INTERVAL_MS);
    // Don't keep the Node event loop alive just for this.
    timer.unref?.();
}
