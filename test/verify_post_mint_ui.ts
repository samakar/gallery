/**
 * Simulates the API responses for each post-mint UI surface against the
 * deed we minted (image_id=op23z, asset_id=5NJZ3sz..., owner=samakar@gmail.com).
 * No HTTP -- queries the DB directly through the same Prisma calls each
 * endpoint makes. Outputs what the frontend would receive.
 *
 * Run: tsx scripts/verify_post_mint_ui.ts
 */
import 'dotenv/config';
import { prisma } from '../src/db';

const IMAGE_ID = 'op23z';
const BUYER_EMAIL = 'samakar@gmail.com';

(async () => {
    const buyer = await prisma.user.findFirst({
        where: { email: BUYER_EMAIL },
        include: { owner: true },
    });
    if (!buyer) throw new Error('no buyer');

    console.log('=== 1. /v1/me/collection (buyer Collection page) ===');
    const deeds = await prisma.deed.findMany({
        where: { owner_id: buyer.user_id },
        include: { image: { select: { title: true, status: true, visibility: true } } },
        orderBy: { minted_at: 'desc' },
    });
    console.log(`buyer holds ${deeds.length} deed(s):`);
    for (const d of deeds) {
        console.log(`  image_id=${d.image_id}  title="${d.image.title}"  deed_state=${d.deed_state}  visibility=${d.image.visibility}  status=${d.image.status}  asset_id=${d.asset_id}`);
    }

    console.log('\n=== 2. /v1/images/op23z (owner-state image page render branch) ===');
    const image = await prisma.image.findUnique({
        where: { image_id: IMAGE_ID },
        include: {
            deed: true,
            creator: { include: { user: true } },
        },
    });
    if (!image) throw new Error('no image');
    const viewerIsOwner = image.deed?.owner_id === buyer.user_id;
    console.log({
        image_id: image.image_id,
        title: image.title,
        status: image.status,
        visibility: image.visibility,
        creator_display: image.creator.display_name,
        deed_state: image.deed?.deed_state ?? null,
        viewer_is_owner: viewerIsOwner,
        render_branch: !image.deed
            ? 'pre-sale (Buy CTA visible)'
            : viewerIsOwner
                ? 'owner-state (Share Copy + deed metadata + Share toggle)'
                : image.visibility === 'public'
                    ? 'post-sale public (Share Copy without Buy)'
                    : 'post-sale private stub ("image is private")',
    });

    console.log('\n=== 3. POST /v1/images/op23z/make-public (Share toggle preflight) ===');
    console.log(`current visibility: ${image.visibility}`);
    console.log(`expected behavior: idempotent flip to public; refuses if status != sold`);
    console.log(`current status: ${image.status} -> Share would ${image.status === 'sold' ? 'work' : 'reject'}`);

    console.log('\n=== 4. /v1/images/op23z/deed (deed-content page) ===');
    if (!image.deed) {
        console.log('NO DEED -- deed page would show TBD fields');
    } else {
        console.log({
            asset_id: image.deed.asset_id,
            owner_wallet: image.deed.owner_wallet_address,
            owner_id: image.deed.owner_id,
            deed_state: image.deed.deed_state,
            minted_at: image.deed.minted_at.toISOString(),
            sha256: JSON.parse(image.deed.variant_hashes)['M+00']?.sha256,
            phash: JSON.parse(image.deed.variant_hashes)['M+00']?.phash,
            arweave_master_uri: image.arweave_uri,
        });
    }

    console.log('\n=== 5. Share Copy URL ===');
    console.log(`Share Copy is served via Cloudinary transformation overlay (monogram + URL text)`);
    console.log(`image_gen.ts produces the URL from image_id + monogram_text`);
    const purchase = await prisma.purchase.findFirst({
        where: { image_id: IMAGE_ID, owner_id: buyer.user_id, status: 'confirmed' },
        select: { monogram_text: true, completed_at: true },
    });
    console.log(`buyer monogram on this deed: "${purchase?.monogram_text}"`);
    console.log(`-> Share Copy will render with monogram "${purchase?.monogram_text}" baked in`);

    console.log('\n=== 6. Pending-purchase recovery check ===');
    const pending = await prisma.purchase.findFirst({
        where: { image_id: IMAGE_ID, owner_id: buyer.user_id, status: 'paid', monogram_text: null },
    });
    console.log(`pending_purchase_id for this image: ${pending?.id ?? '(none -- clean state)'}`);

    await prisma.$disconnect();
})();
