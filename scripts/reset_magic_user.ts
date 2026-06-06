import 'dotenv/config';
import { prisma } from '../src/db';

(async () => {
    const user = await prisma.user.findFirst({ where: { email: 'samakar@gmail.com' } });
    if (!user) {
        console.log('No user row for samakar@gmail.com -- already deleted or never existed.');
        const remaining = await prisma.user.findMany({ select: { email: true, wallet_address: true, magic_did: true } });
        console.log('remaining users:', JSON.stringify(remaining, null, 2));
        await prisma.$disconnect();
        return;
    }
    console.log(`Deleting user_id=${user.user_id}  email=${user.email}  old_wallet=${user.wallet_address}  magic_did=${user.magic_did}`);

    // Cascade-clean related rows
    await prisma.deed.deleteMany({});
    await prisma.purchase.deleteMany({});
    await prisma.signature.deleteMany({});
    await prisma.owner.deleteMany({ where: { user_id: user.user_id } });
    await prisma.creator.deleteMany({ where: { user_id: user.user_id } });
    await prisma.image.updateMany({
        where: { status: 'sold' },
        data: { status: 'live', visibility: 'public', privacy_updated_at: null },
    });
    await prisma.user.delete({ where: { user_id: user.user_id } });
    console.log('Deleted local user row.');

    const remaining = await prisma.user.findMany({ select: { email: true, wallet_address: true, magic_did: true } });
    console.log('remaining users:', JSON.stringify(remaining, null, 2));
    await prisma.$disconnect();
})();
