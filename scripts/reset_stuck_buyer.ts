import 'dotenv/config';
import { prisma } from '../src/db';

(async () => {
    // Identify users whose wallet_address is an EVM address (starts with 0x).
    const evmUsers = await prisma.user.findMany({
        where: { wallet_address: { startsWith: '0x' } },
        select: { user_id: true, email: true, wallet_address: true },
    });
    console.log(`Found ${evmUsers.length} user(s) with EVM wallet_address (need Solana):`);
    for (const u of evmUsers) {
        console.log(`  ${u.email}  =>  ${u.wallet_address}`);
    }

    // Clear EVM addresses so next sign-in (with SolanaExtension active) saves a Solana one.
    const clearedUsers = await prisma.user.updateMany({
        where: { wallet_address: { startsWith: '0x' } },
        data: { wallet_address: null },
    });
    console.log(`Cleared wallet_address on ${clearedUsers.count} user(s).`);

    // Drop the stuck in-flight purchase so the buyer starts a fresh purchase
    // after re-signing in. Refund any Stripe payment is OUT OF SCOPE for dev
    // -- this is a dev DB reset; in production you'd refund first.
    const stuckPurchases = await prisma.purchase.deleteMany({
        where: { status: { in: ['paid', 'building', 'minting'] } },
    });
    console.log(`Deleted ${stuckPurchases.count} stuck purchase(s).`);

    await prisma.$disconnect();
})();
