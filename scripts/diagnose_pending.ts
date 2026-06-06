import 'dotenv/config';
import { prisma } from '../src/db';

(async () => {
    const purchase = await prisma.purchase.findFirst({
        where: { status: { in: ['building', 'minting', 'paid'] } },
        orderBy: { created_at: 'desc' },
        include: {
            image: { include: { deed: true } },
            owner: { include: { user: { select: { email: true, wallet_address: true } } } },
        },
    });
    if (!purchase) {
        console.log('No in-flight purchases. Either the mint already completed or there are no purchases at all.');
        const recentDeeds = await prisma.deed.findMany({
            take: 3,
            orderBy: { minted_at: 'desc' },
        });
        if (recentDeeds.length) {
            console.log('Most recent deed(s):');
            for (const d of recentDeeds) {
                console.log(`  image_id=${d.image_id}  asset_id=${d.asset_id}  owner_wallet=${d.owner_wallet_address}  minted_at=${d.minted_at.toISOString()}`);
            }
        }
        process.exit(0);
    }
    console.log('Most recent in-flight purchase:');
    console.log(`  id:                 ${purchase.id}`);
    console.log(`  image_id:           ${purchase.image_id}`);
    console.log(`  status:             ${purchase.status}`);
    console.log(`  monogram_text:      ${purchase.monogram_text ?? 'NULL'}`);
    console.log(`  buyer email:        ${purchase.owner.user.email}`);
    console.log(`  buyer wallet:       ${purchase.owner.user.wallet_address ?? 'NULL'}`);
    console.log(`  crossmint_job_id:   ${purchase.crossmint_job_id ?? 'NULL'}  (= tx signature when mint succeeded)`);
    console.log(`  failure_reason:     ${purchase.failure_reason ?? 'NULL'}`);
    console.log(`  created_at:         ${purchase.created_at.toISOString()}`);
    console.log(`  image.arweave_uri:  ${purchase.image.arweave_uri ?? 'NULL'}`);
    console.log(`  image.deed:         ${purchase.image.deed ? 'EXISTS (asset_id=' + purchase.image.deed.asset_id + ')' : 'NOT YET'}`);
    await prisma.$disconnect();
})();
