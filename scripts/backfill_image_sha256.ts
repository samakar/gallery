// scripts/backfill_image_sha256.ts
// One-shot backfill: populate Image.sha256 for rows certified before the
// certify-time sha256 change shipped. Fetches the Cloudinary listing-preview
// bytes for each row and hashes them; updates the row in place. Idempotent --
// skips rows that already have sha256.
//
// Run:
//   npx tsx scripts/backfill_image_sha256.ts

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { prisma } from '../src/db';
import { buildListingPreviewUrl } from '../src/commerce/image_gen';

async function main() {
    const targets = await prisma.image.findMany({
        where: { sha256: null },
        select: { image_id: true },
    });
    console.log(`[backfill] ${targets.length} image rows missing sha256`);

    let ok = 0, fail = 0;
    for (const t of targets) {
        const url = buildListingPreviewUrl(t.image_id);
        try {
            const resp = await fetch(url);
            if (!resp.ok) {
                console.warn(`  [skip] ${t.image_id}: preview HTTP ${resp.status}`);
                fail++;
                continue;
            }
            const bytes = Buffer.from(await resp.arrayBuffer());
            const sha256 = createHash('sha256').update(bytes).digest('hex');
            await prisma.image.update({
                where: { image_id: t.image_id },
                data: { sha256 },
            });
            console.log(`  [ok]   ${t.image_id}: ${sha256.slice(0, 12)}… (${bytes.byteLength} bytes)`);
            ok++;
        } catch (e: any) {
            console.warn(`  [fail] ${t.image_id}: ${e?.message ?? e}`);
            fail++;
        }
    }
    console.log(`[backfill] done. ok=${ok} fail=${fail}`);
    await prisma.$disconnect();
}

main().catch(e => { console.error('backfill failed:', e?.message ?? e); process.exit(1); });
