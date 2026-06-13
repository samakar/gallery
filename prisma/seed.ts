// seed.ts
// Dev fixture: 1 creator + 1 buyer + 1 admin + 3 images + 1 deed.
// Run: npm run db:seed   (delegates to `prisma db seed` -> tsx prisma/seed.ts)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Allowlist is now env-config (CREATOR_ALLOWLIST_ENABLED + CREATOR_ALLOWLIST_EMAILS)
    // per identity.md §2.4 -- the creator_allowlist table was dropped in migration
    // 20260610130000_drop_creator_allowlist. Add creator@example.com to
    // CREATOR_ALLOWLIST_EMAILS in your .env if you want the gate active in dev.

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

    // One-time cleanup of the abandoned 'abc1d' fixture (no real Cloudinary
    // asset uploaded; rendered as broken image). Idempotent: safe to leave in
    // even after the row is gone.
    await prisma.deed.deleteMany({ where: { image_id: 'abc1d' } });
    await prisma.purchase.deleteMany({ where: { image_id: 'abc1d' } });
    await prisma.image.deleteMany({ where: { image_id: 'abc1d' } });

    const images = [
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
            listed_price: 1000,  // $10 default per metadata.md §2.1
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

    // Deed for the seeded sold image (separate from the resettable ones).
    await prisma.deed.upsert({
        where: { image_id: 'k7p2m' },
        create: {
            image_id: 'k7p2m',
            asset_id: 'AssetIdK7P2M11111111111111111111111111111111',
            owner_wallet_address: 'BuyerWallet111111111111111111111111111111',
            owner_id: 'dev-buyer',
            custody_state: 'sealed',
            legal_state: 'legit',
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
