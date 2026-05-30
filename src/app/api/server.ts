// server.ts
// MVP dev API. Glue only -- routes call subsystem functions or read Prisma
// directly for UI-shaped reads (CLAUDE.md "Never put business logic in
// /src/app/. Glue only.").
//
// Auth at MVP is the dev-only `x-dev-user: creator | buyer | admin` shim;
// production replaces this with Magic DID verification per /docs/cert/identity.md.
//
// Not yet wired: Stripe / Crossmint webhooks (require external setup) -- see
// /docs/registry/crossmint_webhook.md and /docs/commerce/payments.md.

import express, { type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../../db';
import { getDeedState } from '../../registry/deed_state';
import { generate as generateImageId } from '../../registry/image_id_generator';

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

app.use(express.json());

// -------------------------------------------------------------------
// Dev auth shim
// -------------------------------------------------------------------

const DEV_USERS: Record<string, string> = {
    creator: 'dev-creator',
    buyer: 'dev-buyer',
    admin: 'dev-admin',
};

interface Auth {
    user_id?: string;
    role?: 'creator' | 'buyer' | 'admin';
}

function auth(req: Request): Auth {
    const persona = String(req.header('x-dev-user') ?? '');
    if (persona in DEV_USERS) {
        return { user_id: DEV_USERS[persona], role: persona as Auth['role'] };
    }
    return {};
}

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------

app.get('/v1/health', (_req, res) => {
    res.json({ ok: true });
});

// Creator dashboard listings
app.get('/v1/creator/listings', async (req, res) => {
    const { user_id } = auth(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const images = await prisma.image.findMany({
        where: { creator_id: user_id },
        orderBy: { created_at: 'desc' },
    });
    res.json({
        listings: images.map(i => ({
            image_id: i.image_id,
            title: i.title,
            preview_url: previewUrlFor(i.image_id),
            status: i.status,
            visibility: i.visibility,
            listed_price_cents: i.status === 'sold' ? null : i.listed_price,
            created_at: i.created_at.toISOString(),
        })),
    });
});

// Buyer collection (deeds owned by user)
app.get('/v1/me/collection', async (req, res) => {
    const { user_id } = auth(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const deeds = await prisma.deed.findMany({
        where: { owner_id: user_id },
        include: { image: { include: { creator: true } } },
        orderBy: { minted_at: 'desc' },
    });
    res.json({
        deeds: deeds.map(d => ({
            image_id: d.image_id,
            title: d.image.title,
            creator_display_name: d.image.creator.display_name,
            share_copy_url: previewUrlFor(d.image_id),
            mint_address: d.mint_address,
            minted_at: d.minted_at.toISOString(),
            deed_state: d.deed_state,
        })),
    });
});

// Image page
app.get('/v1/images/:imageId', async (req, res) => {
    const { user_id } = auth(req);
    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { creator: true, deed: true },
    });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });

    const viewer_is_owner = user_id != null && img.deed?.owner_id === user_id;
    const is_creator = user_id != null && img.creator_id === user_id;
    res.json({
        image_id: img.image_id,
        title: img.title,
        creation_date: img.creation_date.toISOString(),
        edition: 'Unique',
        listed_price_cents: img.status === 'sold' ? null : img.listed_price,
        status: img.status,
        visibility: img.visibility,
        preview_url: previewUrlFor(img.image_id),
        creator: {
            display_name: img.creator.display_name,
            youtube_channel_handle: img.creator.youtube_channel_handle,
            headshot_url: img.creator.creator_headshot_url,
            bio: img.creator.creator_bio,
            context_video_url: null,
        },
        description: img.description,
        viewer_is_owner,
        is_creator,
        deed_mint_address: img.deed?.mint_address ?? null,
    });
});

// Creator profile (read-only at MVP; CMA-captured fields)
app.get('/v1/creator/profile', async (req, res) => {
    const { user_id } = auth(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const creator = await prisma.creator.findUnique({ where: { user_id } });
    if (!creator) return res.status(404).json({ error: 'NOT_A_CREATOR' });
    res.json({
        profile: {
            display_name: creator.display_name,
            legal_name: creator.legal_name,
            entity_type: creator.entity_type,
            youtube_channel_handle: creator.youtube_channel_handle,
            creator_bio: creator.creator_bio,
            creator_headshot_url: creator.creator_headshot_url,
        },
    });
});

// New upload -- persists row with status='pending_review'.
// Real multipart + storage is deferred; client sends validated dimensions.
app.post('/v1/images', async (req, res) => {
    const { user_id } = auth(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const creator = await prisma.creator.findUnique({ where: { user_id } });
    if (!creator) return res.status(403).json({ error: 'NOT_A_CREATOR' });

    const { filename, width, height } = req.body ?? {};
    // image_id_generator may collide rarely (36^5); retry handful of times.
    let image_id = '';
    for (let i = 0; i < 5; i++) {
        const candidate = generateImageId();
        const clash = await prisma.image.findUnique({ where: { image_id: candidate } });
        if (!clash) { image_id = candidate; break; }
    }
    if (!image_id) return res.status(500).json({ error: 'ID_COLLISION' });

    const created = await prisma.image.create({
        data: {
            image_id,
            creator_id: user_id,
            title: filename ? String(filename).replace(/\.[^.]+$/, '') : '',
            description: '',
            creation_date: new Date(),
            listed_price: 0,
            status: 'pending_review',
            visibility: 'private',
            width_px: typeof width === 'number' ? width : null,
            height_px: typeof height === 'number' ? height : null,
        },
    });
    res.json({
        image_id: created.image_id,
        title: created.title,
        preview_url: previewUrlFor(created.image_id),
        status: created.status,
        visibility: created.visibility,
        listed_price_cents: created.listed_price,
        created_at: created.created_at.toISOString(),
    });
});

// Edit metadata (creator only; allowed at status in {pending_review, draft})
app.patch('/v1/images/:imageId/metadata', async (req, res) => {
    const { user_id } = auth(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.status !== 'pending_review' && img.status !== 'draft') {
        return res.status(409).json({ error: 'IMMUTABLE_STATUS', status: img.status });
    }

    const { title, description, listed_price_cents, creation_date } = req.body ?? {};
    await prisma.image.update({
        where: { image_id: img.image_id },
        data: {
            title: typeof title === 'string' ? title : img.title,
            description: typeof description === 'string' ? description : img.description,
            listed_price: Number.isFinite(listed_price_cents)
                ? Math.max(0, Math.round(listed_price_cents))
                : img.listed_price,
            creation_date: creation_date ? new Date(creation_date) : img.creation_date,
        },
    });
    res.json({ ok: true });
});

// Put on sale -- Card 3 List trigger. Requires status='draft' (moderated)
// and all required metadata fields set.
app.post('/v1/images/:imageId/list', async (req, res) => {
    const { user_id } = auth(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.status !== 'draft') {
        return res.status(409).json({ error: 'NOT_MODERATED', status: img.status });
    }
    if (!img.title || !img.description || img.listed_price <= 0) {
        return res.status(409).json({ error: 'INCOMPLETE_METADATA' });
    }

    await prisma.image.update({
        where: { image_id: img.image_id },
        data: { status: 'live', visibility: 'public', published_at: new Date() },
    });
    res.json({ ok: true });
});

// Deed content page
app.get('/v1/images/:imageId/deed', async (req, res) => {
    const deed = await prisma.deed.findUnique({
        where: { image_id: req.params.imageId },
        include: { image: { include: { creator: true } } },
    });
    if (!deed) return res.status(404).json({ error: 'NOT_FOUND' });

    // Use the real subsystem read; falls back to deed row on mismatch.
    const stateResult = await getDeedState(deed.mint_address);
    res.json({
        image_id: deed.image_id,
        title: deed.image.title,
        creator_display_name: deed.image.creator.display_name,
        creation_date: deed.image.creation_date.toISOString(),
        edition: 'Unique',
        mint_address: deed.mint_address,
        arweave_uri: deed.image.arweave_uri ?? '',
        sha256: deed.image.sha256 ?? '',
        minted_at: deed.minted_at.toISOString(),
        deed_state: stateResult.ok ? stateResult.deed_state : deed.deed_state,
        current_owner_wallet: deed.owner_wallet_address,
        royalty_pct: 10,
        appraisal_value_usd: null,
        last_sale_price_usd: null,
        provenance_chain_length: null,
    });
});

// Moderation queue
app.get('/v1/admin/reviews', async (req, res) => {
    if (auth(req).role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN' });

    const pending = await prisma.image.findMany({
        where: { status: 'pending_review' },
        include: { creator: true },
        orderBy: { created_at: 'asc' },
    });
    res.json({
        queue: pending.map(i => ({
            image_id: i.image_id,
            creator_display_name: i.creator.display_name,
            title: i.title,
            preview_url: previewUrlFor(i.image_id),
            submitted_at: i.created_at.toISOString(),
        })),
    });
});

app.post('/v1/admin/reviews/:imageId', async (req, res) => {
    const { user_id, role } = auth(req);
    if (role !== 'admin' || !user_id) return res.status(403).json({ error: 'FORBIDDEN' });

    const { abuse_clear, rights_clear } = req.body ?? {};
    // TODO: route through cert/moderation.decide(image_id, reviewer_id, ...)
    // once that surface stabilizes. Direct write at MVP.
    const approved = Boolean(abuse_clear) && Boolean(rights_clear);
    const newStatus = approved ? 'draft' : 'taken_down';
    await prisma.image.update({
        where: { image_id: req.params.imageId },
        data: { status: newStatus },
    });
    await prisma.imageReview.create({
        data: {
            image_id: req.params.imageId,
            reviewer_id: user_id,
            decision: approved ? 'approved' : 'rejected_tier1',
            checks: JSON.stringify({ tier0_clean: !!abuse_clear, tier1_clean: !!rights_clear }),
        },
    });
    res.json({ ok: true, status: newStatus });
});

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function previewUrlFor(imageId: string): string {
    // Placeholder until Cloudinary is wired (commerce/image_gen).
    return `https://placehold.co/600x600/eee/aaa?text=${encodeURIComponent(imageId)}`;
}

// -------------------------------------------------------------------
// Error guard
// -------------------------------------------------------------------

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api]', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
});

app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
});
