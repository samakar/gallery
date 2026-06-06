import { prisma } from '../src/db';
(async () => {
    const deedsBefore = await prisma.deed.count();
    const purchasesBefore = await prisma.purchase.count();
    console.log(`before: ${deedsBefore} deeds, ${purchasesBefore} purchases`);
    const d = await prisma.deed.deleteMany({});
    const p = await prisma.purchase.deleteMany({});
    // Also reset image.status from 'sold' back to 'live' so old listings are available again
    const i = await prisma.image.updateMany({
        where: { status: 'sold' },
        data: { status: 'live', visibility: 'public', privacy_updated_at: null },
    });
    console.log(`wiped: ${d.count} deeds, ${p.count} purchases; reset ${i.count} images sold->live`);
    await prisma.$disconnect();
})();
