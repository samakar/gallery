// seed.ts
// Dev fixture: 1 creator + 1 buyer + 1 admin + 3 images + 1 deed.
// Run: npm run db:seed   (delegates to `prisma db seed` -> tsx prisma/seed.ts)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Allowlist
    await prisma.creatorAllowlist.upsert({
        where: { email: 'creator@example.com' },
        create: { email: 'creator@example.com' },
        update: {},
    });

    // Creator
    await prisma.user.upsert({
        where: { user_id: 'dev-creator' },
        create: {
            user_id: 'dev-creator',
            magic_did: 'did:dev:creator',
            email: 'creator@example.com',
            oauth_provider: 'google',
            wallet_address: 'CreatorWallet11111111111111111111111111111',
            creator: {
                create: {
                    display_name: 'Sample Creator',
                    legal_name: 'Sample Creator LLC',
                    legal_address: JSON.stringify({ city: 'Seattle', country: 'US' }),
                    entity_type: 'llc',
                    youtube_channel_handle: '@sample',
                    creator_bio: 'Photographer based in the Pacific Northwest.',
                },
            },
        },
        update: {},
    });

    // Buyer
    await prisma.user.upsert({
        where: { user_id: 'dev-buyer' },
        create: {
            user_id: 'dev-buyer',
            magic_did: 'did:dev:buyer',
            email: 'buyer@example.com',
            oauth_provider: 'google',
            wallet_address: 'BuyerWallet111111111111111111111111111111',
            owner: { create: {} },
        },
        update: {},
    });

    // Admin
    await prisma.user.upsert({
        where: { user_id: 'dev-admin' },
        create: {
            user_id: 'dev-admin',
            magic_did: 'did:dev:admin',
            email: 'admin@example.com',
            oauth_provider: 'google',
        },
        update: {},
    });

    // Images
    const images = [
        {
            image_id: 'abc1d',
            title: 'After the rain',
            description:
                'A short first-person artist statement about this work. Two or three sentences in the creator\'s voice.',
            status: 'live',
            visibility: 'public',
            listed_price: 24000,
            creation_date: new Date('2026-04-15'),
        },
        {
            image_id: 'k7p2m',
            title: 'Northbound',
            description: 'Studio sunset over the highway.',
            status: 'sold',
            visibility: 'public',
            listed_price: 18000,
            creation_date: new Date('2026-03-02'),
        },
        {
            image_id: 'q9z3x',
            title: 'Untitled draft',
            description: 'Submitted for review.',
            status: 'pending_review',
            visibility: 'private',
            listed_price: 0,
            creation_date: new Date('2026-05-20'),
        },
    ];
    for (const img of images) {
        await prisma.image.upsert({
            where: { image_id: img.image_id },
            create: { ...img, creator_id: 'dev-creator' },
            update: {},
        });
    }

    // Deed for the sold image
    await prisma.deed.upsert({
        where: { image_id: 'k7p2m' },
        create: {
            image_id: 'k7p2m',
            mint_address: 'MintAddrK7P2M111111111111111111111111111111',
            owner_wallet_address: 'BuyerWallet111111111111111111111111111111',
            owner_id: 'dev-buyer',
            deed_state: 'sealed',
            variant_hashes: JSON.stringify({}),
            minted_at: new Date('2026-04-18'),
        },
        update: {},
    });

    console.log('Seed complete.');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
