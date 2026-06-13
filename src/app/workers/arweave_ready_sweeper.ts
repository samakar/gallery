// arweave_ready_sweeper.ts
// Fresh Arweave uploads commonly take 5-30 minutes to propagate from Turbo
// confirmation to gateway-readable. Surfacing the canonical
// https://arweave.net/<tx_id> URL on the deed page during that window means
// every click 404s -- bad UX even though the upload itself is fine.
//
// This sweeper periodically HEAD-checks every Image with arweave_uri set
// and arweave_ready_at null. When the gateway returns 200, it stamps
// arweave_ready_at = now(). The deed page then flips from "Archive upload
// in progress" to the live URL.
//
// Same setInterval pattern as stale_paid_sweeper. Lives in dev:server's
// startup; in prod this becomes a separate cron / queue consumer with the
// same exported function.

import { prisma } from '../../db';
import { encryptedMasterStore } from '../../registry/arweave_master';

const SWEEP_INTERVAL_MS = 30 * 1000; // poll every 30s
const HEAD_TIMEOUT_MS = 10 * 1000;   // give the gateway up to 10s per check
const BATCH_SIZE = 25;

export async function sweepArweaveReady(): Promise<{ checked: number; stamped: number }> {
    const pending = await prisma.image.findMany({
        where: {
            arweave_uri: { not: null },
            arweave_ready_at: null,
        },
        select: { image_id: true, arweave_uri: true },
        take: BATCH_SIZE,
    });
    let stamped = 0;
    for (const row of pending) {
        if (!row.arweave_uri) continue;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
            const resp = await fetch(row.arweave_uri, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timer);
            if (resp.ok) {
                await prisma.image.update({
                    where: { image_id: row.image_id },
                    data: { arweave_ready_at: new Date() },
                });
                console.log('[sweep.arweave-ready] stamped', row.image_id);
                stamped++;

                // Arweave is now the authoritative encrypted-Master copy for
                // this image. Delete the FS entry so the store doesn't grow
                // indefinitely with sold inventory. `/download-master` falls
                // back to Arweave automatically when the store returns null.
                // Best-effort: delete failures are logged inside the store
                // helper, never throw to the sweeper.
                await encryptedMasterStore.delete(row.image_id);
            }
        } catch {
            // Network errors, timeouts, etc. -- next sweep will retry.
        }
    }
    return { checked: pending.length, stamped };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startArweaveReadySweeper(): void {
    if (timer) return;
    timer = setInterval(() => {
        sweepArweaveReady().catch(e => console.error('[sweep.arweave-ready] sweep error', e));
    }, SWEEP_INTERVAL_MS);
    timer.unref?.();
}
