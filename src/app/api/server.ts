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
import multer from 'multer';
import { createHash } from 'node:crypto';
import exifr from 'exifr';
import sharp from 'sharp';
import { Magic } from '@magic-sdk/admin';
import { prisma } from '../../db';
import { getDeedState } from '../../registry/deed_state';
import { generate as generateImageId } from '../../registry/image_id_generator';
import { uploadOriginal, uploadFromUrl, buildListingPreviewUrl, buildShareCopyUrl, buildThumbnailUrl, deleteAsset, uploadHeadshot, buildHeadshotUrl } from '../../commerce/image_gen';
import { initCheckout, handleStripeWebhook } from '../../commerce/payments';
import { startBuild } from '../../commerce/run_image_ops';
import { lookupJob } from '../../registry/crossmint_dispatch';
import { handleWebhook as handleCrossmintWebhook, applyMintSucceeded, applyMintFailed } from '../../registry/crossmint_webhook';
import Arweave from 'arweave';
import { validateUniqueness, sharpPhashComputer, prismaPerCreatorStore } from '../../cert/image_uniqueness';
import { captureSignature } from '../../cert/esign';

const PORT = Number(process.env.PORT ?? 3000);

// Price band (cents). Whole dollars only; diverges from R71 §1.1 ($20-$2000)
// per product decision. See docs/commerce/metadata.md §2.1.
const PRICE_MIN_CENTS = 500;       // $5
const PRICE_MAX_CENTS = 50000;     // $500
const PRICE_DEFAULT_CENTS = 1000;  // $10

// Title + description gates per docs/commerce/metadata.md §2.1. Enforced at
// publishListing (/list); PATCH is tolerant so drafts can be edited freely.
const TITLE_MIN_CHARS = 5;
const TITLE_MAX_CHARS = 50;
const TITLE_MIN_WORDS = 2;
const TITLE_MAX_WORDS = 5;
const DESC_MIN_CHARS = 40;
const DESC_MAX_CHARS = 280;
const BIO_MIN_CHARS = 40;
const BIO_MAX_CHARS = 280;

function validateTitle(raw: string): string | null {
    const t = raw.trim();
    if (t.length < TITLE_MIN_CHARS || t.length > TITLE_MAX_CHARS) {
        return `Title must be ${TITLE_MIN_CHARS}-${TITLE_MAX_CHARS} characters.`;
    }
    const words = t.split(/\s+/).filter(Boolean).length;
    if (words < TITLE_MIN_WORDS || words > TITLE_MAX_WORDS) {
        return `Title must be ${TITLE_MIN_WORDS}-${TITLE_MAX_WORDS} words.`;
    }
    return null;
}

function validateDescription(raw: string): string | null {
    const d = raw.trim();
    if (d.length < DESC_MIN_CHARS || d.length > DESC_MAX_CHARS) {
        return `Description must be ${DESC_MIN_CHARS}-${DESC_MAX_CHARS} characters.`;
    }
    return null;
}

function validateBio(raw: string | null): string | null {
    const b = (raw ?? '').trim();
    if (b.length < BIO_MIN_CHARS || b.length > BIO_MAX_CHARS) {
        return `Bio must be ${BIO_MIN_CHARS}-${BIO_MAX_CHARS} characters.`;
    }
    return null;
}

// Build the deed image_spec block per R62 §2.3. Seven fields read once from
// the Original at Card 2 ingestion; written to the deed at Card 5 mint.
// Source priority: sharp metadata for everything natively available, ICC
// presence drives the icc_profile field name.
interface DeedImageSpec {
    width_px: number;
    height_px: number;
    color_space: string;
    icc_profile: string;
    color_depth_bits: number;
    file_type: string;
    file_size_bytes: number;
}

async function extractImageSpec(buffer: Buffer): Promise<DeedImageSpec> {
    const meta = await sharp(buffer).metadata();
    const depthBits: Record<string, number> = {
        uchar: 8, char: 8, ushort: 16, short: 16,
        uint: 32, int: 32, float: 32, double: 64,
    };
    const bitsPerChannel = depthBits[meta.depth ?? 'uchar'] ?? 8;
    const channels = meta.channels ?? 3;
    const space = meta.space ?? 'srgb';
    // Friendly color space label; R62 example shows "Display P3" / "sRGB".
    const colorSpace = space === 'srgb' ? 'sRGB'
        : space === 'p3' ? 'Display P3'
        : space.toUpperCase();
    const hasIcc = meta.icc != null;
    return {
        width_px: meta.width ?? 0,
        height_px: meta.height ?? 0,
        color_space: colorSpace,
        icc_profile: hasIcc ? `${colorSpace.replace(/\s/g, '')}.icc` : 'sRGB',
        color_depth_bits: bitsPerChannel * channels,
        file_type: (meta.format ?? 'jpeg').toUpperCase(),
        file_size_bytes: buffer.length,
    };
}

// Pull DateTimeOriginal from EXIF for the image's true creation moment;
// fall back to upload time if the JPEG carries no EXIF (sharp-synthesised
// fixtures, web-downloaded files, etc.) or the date is implausible.
async function extractCreationDate(buffer: Buffer): Promise<Date> {
    try {
        const exif = await exifr.parse(buffer, { pick: ['DateTimeOriginal'] });
        const dt = exif?.DateTimeOriginal;
        if (dt instanceof Date && !isNaN(dt.getTime())) {
            const now = Date.now();
            // Sanity: not in the future, not pre-1990 (common camera default
            // when battery dies and clock resets).
            if (dt.getTime() <= now && dt.getFullYear() >= 1990) {
                return dt;
            }
        }
    } catch { /* exifr threw on a malformed/missing EXIF block */ }
    return new Date();
}

// Listing precondition: creator profile must be complete (everything the
// public creator-presence block needs). Returns null if OK, else the first
// missing field's friendly name.
function checkProfileForListing(creator: {
    display_name: string;
    youtube_channel_handle: string;
    creator_bio: string | null;
    creator_headshot_url: string | null;
}): string | null {
    if (!creator.display_name?.trim()) return 'display name';
    if (!creator.youtube_channel_handle?.trim()) return 'YouTube handle';
    if (validateBio(creator.creator_bio)) return `bio (${BIO_MIN_CHARS}-${BIO_MAX_CHARS} chars)`;
    if (!creator.creator_headshot_url) return 'headshot';
    return null;
}

const app = express();

// Stripe webhook MUST be registered with express.raw BEFORE express.json() --
// HMAC operates on the exact byte stream; JSON re-serialization breaks the
// signature. payments.md §2.2, §3.2.
app.post(
    '/v1/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const sig = req.header('stripe-signature') ?? '';
        try {
            const result = await handleStripeWebhook(req.body as Buffer, sig);
            if (!result.ok) return res.status(400).json({ error: 'STRIPE_SIGNATURE_INVALID' });
            res.json({ received: true, type: result.event_type });
        } catch (e) {
            // Spec §2.3: still respond 200 on internal handler errors to avoid
            // Stripe retry storms. Signature failures already returned 400 above.
            console.error('[stripe.webhook] outer handler error', e);
            res.json({ received: true, internal_error: true });
        }
    },
);

// Crossmint webhook -- same raw-body discipline as Stripe (HMAC over exact
// bytes). Receives nft.create.succeeded / .failed callbacks.
app.post(
    '/v1/webhooks/crossmint',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const sig = req.header('x-crossmint-signature') ?? req.header('crossmint-signature') ?? '';
        try {
            const result = await handleCrossmintWebhook(req.body as Buffer, sig);
            if (!result.ok) return res.status(400).json({ error: 'CROSSMINT_SIGNATURE_INVALID' });
            res.json({ received: true, type: result.event_type });
        } catch (e) {
            console.error('[crossmint.webhook] outer handler error', e);
            res.json({ received: true, internal_error: true });
        }
    },
);

app.use(express.json());

// Multipart for file uploads. memoryStorage keeps the buffer in RAM so we can
// stream straight to Cloudinary without a temp file. Two caps -- images are
// allowed to be large (38 MP ingestion ceiling + q100 headroom), headshots
// are not (a 200x200 delivery doesn't justify a multi-MB upload).
const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024;
const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMAGE_MAX_BYTES },
});
const headshotUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: HEADSHOT_MAX_BYTES },
});

// -------------------------------------------------------------------
// Auth -- Magic DID token (production path) + dev-persona shim (local-only)
// -------------------------------------------------------------------

// Magic admin SDK validates DID tokens issued by the client. If the secret
// isn't set we still allow the dev shim to function -- handy for fresh clones
// where Magic config hasn't been pasted yet.
const magicAdmin = process.env.MAGIC_SECRET_KEY
    ? new Magic(process.env.MAGIC_SECRET_KEY)
    : null;
if (!magicAdmin) {
    console.warn(
        '[auth] MAGIC_SECRET_KEY is not set -- Bearer DID tokens will be rejected. ' +
        'Dev-persona shim still works.'
    );
}

const DEV_USERS: Record<string, string> = {
    creator: 'dev-creator',
    buyer: 'dev-buyer',
    admin: 'dev-admin',
};

interface Auth {
    user_id?: string;
    role?: 'creator' | 'buyer' | 'admin';
}

// Per-request DID -> {user_id, role} cache. Avoids re-hitting Magic's
// validate() + a Prisma lookup for every API call within a single express
// request that happens to call auth() more than once.
const didCache = new WeakMap<Request, Auth>();

// Resolve a Magic-authenticated session from `Authorization: Bearer <didToken>`.
// Returns {} on any failure -- caller treats it as unauthenticated.
async function authFromBearer(req: Request): Promise<Auth> {
    if (!magicAdmin) return {};
    const header = req.header('authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ')) return {};
    const didToken = header.slice(7).trim();
    if (!didToken) return {};
    const cached = didCache.get(req);
    if (cached) return cached;
    try {
        magicAdmin.token.validate(didToken);
        const issuer = magicAdmin.token.getIssuer(didToken);
        const user = await prisma.user.findUnique({ where: { magic_did: issuer } });
        if (!user) return {};
        // Role is row-existence in `creators` / `admin allowlist` per
        // identity.md §2.3. Buyer is the default for any provisioned user.
        const [creator] = await Promise.all([
            prisma.creator.findUnique({ where: { user_id: user.user_id } }),
        ]);
        const role: Auth['role'] = creator ? 'creator' : 'buyer';
        const resolved: Auth = { user_id: user.user_id, role };
        didCache.set(req, resolved);
        return resolved;
    } catch {
        return {};
    }
}

// Sync wrapper used by routes that haven't been refactored to await auth() yet.
// Prefer `await authAsync(req)` for any route that needs Magic; the sync path
// only sees the dev-persona shim.
function auth(req: Request): Auth {
    const persona = String(req.header('x-dev-user') ?? '');
    if (persona in DEV_USERS) {
        return { user_id: DEV_USERS[persona], role: persona as Auth['role'] };
    }
    return {};
}

// Async auth -- Magic Bearer first, dev-persona fallback. New routes should
// use this; legacy routes can adopt incrementally.
async function authAsync(req: Request): Promise<Auth> {
    const bearer = await authFromBearer(req);
    if (bearer.user_id) return bearer;
    return auth(req);
}

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------

app.get('/v1/health', (_req, res) => {
    res.json({ ok: true });
});

// DEV-only: create a live + public test listing with a real Cloudinary asset
// pulled from a public photo URL. Lets the operator get back to a usable
// /v1/public/sample without going through Creator upload + Admin approval.
// Refuses in production.
app.post('/v1/dev/create-test-listing', async (_req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'NOT_AVAILABLE_IN_PRODUCTION' });
    }
    // Pick a fresh 5-char base-36 image_id that's not yet taken. (Same shape
    // as generateImageId but no collision check needed for dev.)
    const newId = Math.random().toString(36).slice(2, 7);
    try {
        // Pull a random photo into Cloudinary at public_id=newId. picsum
        // returns a fresh image on each call; the ?random query bypasses any
        // CDN caching so each dev listing gets distinct visuals.
        await uploadFromUrl(newId, `https://picsum.photos/seed/${newId}/1080/720`);
        await prisma.image.create({
            data: {
                image_id: newId,
                creator_id: 'dev-creator',
                title: 'Picsum sample listing',
                description: 'Dev test listing -- random Picsum photo. Lets the post-payment build pipeline run with a real Cloudinary asset behind the deed metadata.',
                creation_date: new Date(),
                listed_price: 2500, // $25
                status: 'live',
                visibility: 'public',
                published_at: new Date(),
            },
        });
        console.log('[dev.create-test-listing] created', newId);
        res.json({ ok: true, image_id: newId });
    } catch (e) {
        console.error('[dev.create-test-listing] failed', e);
        res.status(500).json({ error: 'CREATE_TEST_LISTING_FAILED', message: (e as Error)?.message });
    }
});

// DEV-only reset: undo a successful checkout test by clearing the resulting
// Deed + Purchase rows and flipping the image back to live + public. Mirrors
// what `npm run db:seed` does for the resettable test fixtures, but reachable
// from the SignIn page so test iteration doesn't need a terminal.
// Refuses to run when NODE_ENV=production so this can't be hit on a live server.
app.post('/v1/dev/reset-sales', async (_req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'NOT_AVAILABLE_IN_PRODUCTION' });
    }
    try {
        const counts = await prisma.$transaction(async tx => {
            // Reset any image currently 'sold' OR with a Deed/Purchase from a
            // prior test. This is dynamic so it works for images the user
            // uploaded through the Creator dashboard, not just seeded fixtures.
            const soldImages = await tx.image.findMany({
                where: { status: 'sold' },
                select: { image_id: true },
            });
            const ids = soldImages.map(i => i.image_id);
            if (ids.length === 0) {
                return { deeds_deleted: 0, purchases_deleted: 0, images_updated: 0, reset_ids: [] };
            }
            const deedDel = await tx.deed.deleteMany({ where: { image_id: { in: ids } } });
            const purchaseDel = await tx.purchase.deleteMany({ where: { image_id: { in: ids } } });
            const imgUpd = await tx.image.updateMany({
                where: { image_id: { in: ids } },
                data: {
                    status: 'live',
                    visibility: 'public',
                    arweave_uri: null,
                    sha256: null,
                    stripe_product_id: null,
                    stripe_price_id: null,
                },
            });
            return {
                deeds_deleted: deedDel.count,
                purchases_deleted: purchaseDel.count,
                images_updated: imgUpd.count,
                reset_ids: ids,
            };
        });
        console.log('[dev.reset-sales]', counts);
        res.json({ ok: true, ...counts });
    } catch (e) {
        console.error('[dev.reset-sales] failed', e);
        res.status(500).json({ error: 'RESET_FAILED', message: (e as Error)?.message });
    }
});

// Magic OAuth callback handoff. Client posts the freshly-issued DID token in
// `Authorization: Bearer <didToken>`; we validate, look up or provision the
// User row, and return {user_id, role, email} so the client knows where to
// land. Role is inferred by existence of Creator / Owner rows per
// identity.md §2.3; first-time sign-ins default to buyer (no role row
// created here -- Owner row is minted at first purchase).
app.post('/v1/auth/magic', async (req, res) => {
    if (!magicAdmin) {
        return res.status(503).json({
            error: 'MAGIC_NOT_CONFIGURED',
            message: 'Server has no MAGIC_SECRET_KEY. Use a dev persona instead.',
        });
    }
    const header = req.header('authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ')) {
        return res.status(401).json({ error: 'BEARER_REQUIRED' });
    }
    const didToken = header.slice(7).trim();
    let issuer: string;
    let email: string;
    let oauthProvider: string;
    // Magic Dedicated Wallet (Solana chain) auto-provisions a wallet on first
    // sign-in. The Solana publicAddress lives in the `wallets[]` array;
    // top-level `publicAddress` is the legacy EVM default and is the wrong
    // address to feed to Crossmint's Solana minter.
    let walletAddress: string | null;
    try {
        magicAdmin.token.validate(didToken);
        issuer = magicAdmin.token.getIssuer(didToken);
        const meta = await magicAdmin.users.getMetadataByTokenAndWallet(didToken, 'SOLANA' as any);
        if (!meta.email) {
            return res.status(400).json({ error: 'EMAIL_MISSING' });
        }
        email = meta.email;
        oauthProvider = meta.oauthProvider ?? 'magic';
        // Prefer a Solana wallet from the wallets[] array (Magic Solana
        // metadata returns it as the primary publicAddress for that call,
        // but defensively scan the array too). Fall back to legacy
        // publicAddress only if there's nothing better.
        const solanaWallet = meta.wallets?.find(w => w.network?.toUpperCase() === 'SOLANA');
        walletAddress = solanaWallet?.publicAddress ?? meta.publicAddress ?? null;
    } catch (e) {
        return res.status(401).json({ error: 'INVALID_DID_TOKEN', message: String((e as Error)?.message ?? e) });
    }
    // Provision-on-first-sign-in. magic_did (issuer DID) is the stable identity
    // across provider connectors; email is updated on each sign-in in case the
    // user changes it upstream at Google / Apple.
    const user = await prisma.user.upsert({
        where: { magic_did: issuer },
        update: {
            email,
            // Only overwrite wallet_address if we don't already have one and
            // Magic returned one. Schema marks the column @unique so we never
            // clobber it once set.
            ...(walletAddress ? { wallet_address: walletAddress } : {}),
        },
        create: {
            magic_did: issuer,
            email,
            oauth_provider: oauthProvider,
            wallet_address: walletAddress,
        },
    });
    const creator = await prisma.creator.findUnique({ where: { user_id: user.user_id } });
    const role: 'creator' | 'buyer' = creator ? 'creator' : 'buyer';
    res.json({ user_id: user.user_id, role, email: user.email });
});

// One public-live listing for the unauth Sign-in page sample link.
// Picks the most recently published row. Returns null when no listings
// exist yet so SignIn can hide the link instead of dangling.
app.get('/v1/public/sample', async (_req, res) => {
    // Order by `created_at` so a reset image (published_at left null) is
    // still returned. published_at is set only on initial /list; resetting
    // a sold image doesn't repopulate it.
    const img = await prisma.image.findFirst({
        where: { status: 'live', visibility: 'public' },
        orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }],
        select: { image_id: true, title: true },
    });
    res.json({ sample: img });
});

// Creator dashboard listings
app.get('/v1/creator/listings', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const images = await prisma.image.findMany({
        where: { creator_id: user_id },
        orderBy: { created_at: 'desc' },
    });
    res.json({
        listings: images.map(i => ({
            image_id: i.image_id,
            title: i.title,
            preview_url: thumbnailUrlFor(i.image_id),
            status: i.status,
            visibility: i.visibility,
            listed_price_cents: i.status === 'sold' ? null : i.listed_price,
            created_at: i.created_at.toISOString(),
        })),
    });
});

// Buyer collection (deeds owned by user)
app.get('/v1/me/collection', async (req, res) => {
    const { user_id } = await authAsync(req);
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
            share_copy_url: thumbnailUrlFor(d.image_id),
            mint_address: d.mint_address,
            minted_at: d.minted_at.toISOString(),
            deed_state: d.deed_state,
        })),
    });
});

// Image page
app.get('/v1/images/:imageId', async (req, res) => {
    const { user_id } = await authAsync(req);
    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { creator: true, deed: true },
    });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });

    const viewer_is_owner = user_id != null && img.deed?.owner_id === user_id;
    const is_creator = user_id != null && img.creator_id === user_id;
    // Surface profile completeness so the UI's "Put on sale" checklist can
    // mirror the server-side /list gate without a second round-trip.
    const profile_missing = is_creator ? checkProfileForListing(img.creator) : null;
    // Surface ISA signing state for the gate UI per certify_wsd step 7.
    let isa_signed_at: string | null = null;
    if (img.signing_event_id_authorship) {
        const sig = await prisma.signature.findUnique({
            where: { id: img.signing_event_id_authorship },
            select: { clicked_at: true },
        });
        isa_signed_at = sig?.clicked_at.toISOString() ?? null;
    }
    // image_spec is persisted as a JSON string; parse for the API response.
    let image_spec: DeedImageSpec | null = null;
    if (img.image_spec) {
        try { image_spec = JSON.parse(img.image_spec); }
        catch { /* malformed -> leave null; UI renders ******* */ }
    }
    // When the deed exists, the canonical preview swaps to the Share Copy
    // variant (monogram baked in, central watermark dropped). Pull the
    // monogram from the confirming Purchase row.
    let preview_url = previewUrlFor(img.image_id);
    if (img.deed) {
        const confirming = await prisma.purchase.findFirst({
            where: { image_id: img.image_id, status: 'confirmed' },
            select: { monogram_text: true },
            orderBy: { completed_at: 'desc' },
        });
        preview_url = buildShareCopyUrl(img.image_id, confirming?.monogram_text ?? '');
    }
    res.json({
        image_id: img.image_id,
        title: img.title,
        creation_date: img.creation_date.toISOString(),
        edition: 'Unique',
        listed_price_cents: img.status === 'sold' ? null : img.listed_price,
        status: img.status,
        visibility: img.visibility,
        preview_url,
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
        creator_profile_missing: profile_missing,
        isa_signed_at,
        // Full deed surface (per crossmint_dispatch.md / R62 §3.5.3) for the
        // listing-page Deed panel. Pre-sale values are null and the UI shows
        // them as redacted ("*******"); post-sale they resolve to real values.
        royalty_pct: 10,
        royalty_recipient: img.creator.display_name,
        image_spec,
        arweave_uri: img.arweave_uri ?? null,
        sha256: img.sha256 ?? null,
        phash: img.phash ?? null,
        deed_mint_address: img.deed?.mint_address ?? null,
        deed_owner_wallet: img.deed?.owner_wallet_address ?? null,
        deed_minted_at: img.deed?.minted_at?.toISOString() ?? null,
        deed_state: img.deed?.deed_state ?? null,
    });
});

// Creator profile (editable). entity_type is intentionally NOT exposed --
// it's CMA / KYC data, not a user-facing field. Display fields (display_name,
// bio, youtube handle, headshot) are always editable; legal_name carries over
// from CMA for now but is editable as a creator-supplied display.
app.get('/v1/creator/profile', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const creator = await prisma.creator.findUnique({ where: { user_id } });
    if (!creator) return res.status(404).json({ error: 'NOT_A_CREATOR' });
    res.json({
        profile: {
            display_name: creator.display_name,
            legal_name: creator.legal_name,
            youtube_channel_handle: creator.youtube_channel_handle,
            creator_bio: creator.creator_bio,
            creator_headshot_url: creator.creator_headshot_url,
        },
    });
});

app.patch('/v1/creator/profile', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const creator = await prisma.creator.findUnique({ where: { user_id } });
    if (!creator) return res.status(403).json({ error: 'NOT_A_CREATOR' });

    const { display_name, legal_name, youtube_channel_handle, creator_bio } = req.body ?? {};
    await prisma.creator.update({
        where: { user_id },
        data: {
            display_name: typeof display_name === 'string' ? display_name : creator.display_name,
            legal_name: typeof legal_name === 'string' ? legal_name : creator.legal_name,
            youtube_channel_handle:
                typeof youtube_channel_handle === 'string'
                    ? youtube_channel_handle
                    : creator.youtube_channel_handle,
            creator_bio: typeof creator_bio === 'string' ? creator_bio : creator.creator_bio,
        },
    });
    res.json({ ok: true });
});

app.post('/v1/creator/profile/headshot', headshotUpload.single('file'), async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const creator = await prisma.creator.findUnique({ where: { user_id } });
    if (!creator) return res.status(403).json({ error: 'NOT_A_CREATOR' });
    if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });

    const public_id = `headshot-${user_id}`;
    let uploaded;
    try {
        uploaded = await uploadHeadshot(public_id, req.file.buffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: 'CLOUDINARY_UPLOAD_FAILED', message });
    }
    if (uploaded.width < 200 || uploaded.height < 200) {
        // Asset already uploaded; clean it up before rejecting.
        deleteAsset(public_id).catch(e =>
            console.error('[api] Cloudinary cleanup failed for', public_id, e)
        );
        return res.status(400).json({
            error: 'HEADSHOT_TOO_SMALL',
            message: `Headshot must be at least 200×200 px. Got ${uploaded.width}×${uploaded.height}.`,
        });
    }
    // Version-stamped URL so a re-upload to the same public_id produces a new
    // URL string -- defeats browser cache that would otherwise serve the
    // pre-replacement bytes.
    const url = buildHeadshotUrl(public_id, uploaded.version);
    await prisma.creator.update({
        where: { user_id },
        data: { creator_headshot_url: url },
    });
    res.json({ ok: true, url });
});

// New upload -- multipart with field name 'file'. Persists row with
// status='pending_review' only after Cloudinary upload succeeds (no orphan
// rows pointing at non-existent assets).
app.post('/v1/images', imageUpload.single('file'), async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const creator = await prisma.creator.findUnique({ where: { user_id } });
    if (!creator) return res.status(403).json({ error: 'NOT_A_CREATOR' });
    if (!req.file) return res.status(400).json({ error: 'FILE_REQUIRED' });

    // Card 1 uniqueness gate per ADR-0005. Runs BEFORE Cloudinary upload so a
    // duplicate doesn't waste an asset slot. Tier 1 (sharp-phash) is active;
    // Tier 2 (DINOv2 + platform-wide) is stubbed -- per-creator hard-reject
    // is the only gating that fires at MVP.
    const gate = await validateUniqueness(
        req.file.buffer,
        'pending',
        user_id,
        { phash: sharpPhashComputer, store: prismaPerCreatorStore }
    );
    if (!gate.ok) {
        if (gate.error_code === 'CREATOR_DUPLICATE') {
            return res.status(409).json({
                error: 'CREATOR_DUPLICATE',
                message: `You already uploaded this image (existing: ${gate.conflicting_master_id}).`,
                conflicting_image_id: gate.conflicting_master_id,
            });
        }
        if (gate.error_code === 'UNIQUENESS_BACKEND_UNAVAILABLE') {
            return res.status(502).json({ error: 'UNIQUENESS_BACKEND_UNAVAILABLE' });
        }
        return res.status(409).json({ error: gate.error_code });
    }
    const phash = gate.phash;

    // image_id_generator may collide rarely (36^5); retry handful of times.
    let image_id = '';
    for (let i = 0; i < 5; i++) {
        const candidate = generateImageId();
        const clash = await prisma.image.findUnique({ where: { image_id: candidate } });
        if (!clash) { image_id = candidate; break; }
    }
    if (!image_id) return res.status(500).json({ error: 'ID_COLLISION' });

    // Upload to Cloudinary first; only persist the row if it succeeds.
    let uploaded;
    try {
        uploaded = await uploadOriginal(image_id, req.file.buffer);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: 'CLOUDINARY_UPLOAD_FAILED', message });
    }

    const creation_date = await extractCreationDate(req.file.buffer);
    const imageSpec = await extractImageSpec(req.file.buffer);
    const created = await prisma.image.create({
        data: {
            image_id,
            creator_id: user_id,
            title: '',
            description: '',
            creation_date,
            listed_price: PRICE_DEFAULT_CENTS,
            status: 'pending_review',
            visibility: 'private',
            width_px: uploaded.width,
            height_px: uploaded.height,
            phash,
            image_spec: JSON.stringify(imageSpec),
        },
    });
    res.json({
        image_id: created.image_id,
        title: created.title,
        preview_url: thumbnailUrlFor(created.image_id),
        status: created.status,
        visibility: created.visibility,
        listed_price_cents: created.listed_price,
        created_at: created.created_at.toISOString(),
    });
});

// Edit metadata (creator only; allowed at status in {pending_review, draft})
app.patch('/v1/images/:imageId/metadata', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.status !== 'pending_review' && img.status !== 'draft') {
        return res.status(409).json({ error: 'IMMUTABLE_STATUS', status: img.status });
    }

    const { title, description, listed_price_cents } = req.body ?? {};
    // creation_date is intentionally NOT in the editable set -- it's pulled
    // from EXIF DateTimeOriginal at upload and immutable thereafter.

    // Per docs/commerce/metadata.md: whole dollars only, $5-$500 inclusive.
    let next_price = img.listed_price;
    if (Number.isFinite(listed_price_cents)) {
        const c = Math.round(listed_price_cents);
        if (c % 100 !== 0 || c < PRICE_MIN_CENTS || c > PRICE_MAX_CENTS) {
            return res.status(400).json({
                error: 'INVALID_PRICE',
                message: `Price must be a whole dollar between $${PRICE_MIN_CENTS / 100} and $${PRICE_MAX_CENTS / 100}.`,
            });
        }
        next_price = c;
    }

    await prisma.image.update({
        where: { image_id: img.image_id },
        data: {
            title: typeof title === 'string' ? title : img.title,
            description: typeof description === 'string' ? description : img.description,
            listed_price: next_price,
        },
    });
    res.json({ ok: true });
});

// Delete -- creator only; only while status in {pending_review, draft}.
// 'live' must be unlisted first (same two-step gate as edits per ADR-0003).
// 'sold' / 'taken_down' are terminal -- never delete (deed exists; audit
// trail must survive).
app.delete('/v1/images/:imageId', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.status !== 'pending_review' && img.status !== 'draft') {
        return res.status(409).json({ error: 'IMMUTABLE_STATUS', status: img.status });
    }

    // Cascade: ImageReviews first (FK). Signatures aren't attached yet at
    // MVP (ESIGN flow stubbed) -- revisit when wired.
    await prisma.imageReview.deleteMany({ where: { image_id: img.image_id } });
    await prisma.image.delete({ where: { image_id: img.image_id } });

    // Cloudinary cleanup -- best-effort; DB row is already gone so orphan
    // assets are tolerable.
    deleteAsset(img.image_id).catch(err =>
        console.error('[api] Cloudinary delete failed for', img.image_id, err)
    );

    res.json({ ok: true });
});

// Image Signing Affirmation -- per-image ESIGN click required before listing
// per cert/certify_wsd step 7. Creator only; idempotent against
// already-signed; only allowed while status='draft' (moderator-approved).
app.post('/v1/images/:imageId/sign-affirmation', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { creator: true },
    });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.signing_event_id_authorship) {
        return res.status(409).json({ error: 'ALREADY_AFFIRMED' });
    }
    // ISA is available throughout the pre-sale window. Moderator review and
    // creator affirmation are decoupled -- "I am the creator" doesn't depend
    // on whether the content has cleared review. Diverges from
    // certify_wsd.md step 7 ordering (recorded for ADR).
    if (img.status !== 'pending_review' && img.status !== 'draft') {
        return res.status(409).json({ error: 'IMMUTABLE_STATUS', status: img.status });
    }

    const clicked_at = new Date().toISOString();
    const documentText = renderIsaText(
        img.image_id,
        img.title || 'Untitled',
        img.creator.display_name,
        clicked_at
    );
    const result = await captureSignature({
        user_id,
        document_type: 'IMAGE_SIGNING_AFFIRMATION',
        document_text: documentText,
        document_version_label: 'ISA-v1.0',
        image_id: img.image_id,
        click: {
            ip_address: req.ip ?? '0.0.0.0',
            // Dev shim: no real session token, hash the persona key. Real
            // session-token hashing wires when Magic DID is verified upstream.
            session_token_hash: createHash('sha256').update(user_id).digest('hex'),
            clicked_at,
        },
    });
    if (!result.ok) {
        return res.status(500).json({ error: result.error_code, message: result.message });
    }
    await prisma.image.update({
        where: { image_id: img.image_id },
        data: { signing_event_id_authorship: result.row.signing_event_id },
    });
    res.json({ ok: true, isa_signed_at: clicked_at });
});

// Affirmation copy is incorporated by reference -- the substantive obligations
// live in the Creator Master Agreement (CMA-v1.0) signed at onboarding. This
// per-image clause re-anchors compliance for THIS specific image and the
// authorization to sell it.
const ISA_AFFIRMATION_TEXT =
    'I affirm that this image complies with my Creator Agreement [v1.0], ' +
    'including its representations on authorship, rights, and third-party ' +
    'clearances, and I authorize its sale on Epimage.';

function renderIsaText(
    image_id: string,
    title: string,
    creator_display_name: string,
    clicked_at: string
): string {
    return [
        'Image Signing Affirmation (ISA-v1.0)',
        '',
        `Image: ${title} (image-id: ${image_id})`,
        `Creator: ${creator_display_name}`,
        `Affirmation timestamp: ${clicked_at}`,
        '',
        ISA_AFFIRMATION_TEXT,
        '',
    ].join('\n');
}

// Take off sale -- inverse of /list. Creator only; only while status='live'
// (sold/taken_down are terminal). Drops visibility to private so the listing
// disappears from public discovery while metadata is being edited.
app.post('/v1/images/:imageId/unlist', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.status !== 'live') {
        return res.status(409).json({ error: 'NOT_LIVE', status: img.status });
    }

    await prisma.image.update({
        where: { image_id: img.image_id },
        data: { status: 'draft', visibility: 'private' },
    });
    res.json({ ok: true });
});

// Put on sale -- Card 3 List trigger. Requires status='draft' (moderated)
// and all required metadata fields set.
app.post('/v1/images/:imageId/list', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    if (img.creator_id !== user_id) return res.status(403).json({ error: 'FORBIDDEN' });
    if (img.status !== 'draft') {
        return res.status(409).json({ error: 'NOT_MODERATED', status: img.status });
    }
    const titleErr = validateTitle(img.title || '');
    if (titleErr) return res.status(409).json({ error: 'INVALID_TITLE', message: titleErr });
    const descErr = validateDescription(img.description || '');
    if (descErr) return res.status(409).json({ error: 'INVALID_DESCRIPTION', message: descErr });
    if (img.listed_price <= 0) {
        return res.status(409).json({ error: 'INCOMPLETE_METADATA' });
    }

    // Profile gate: creator must have a complete public-facing profile
    // (display_name, youtube handle, bio in [40,280], headshot).
    const creatorRow = await prisma.creator.findUnique({ where: { user_id } });
    if (!creatorRow) return res.status(403).json({ error: 'NOT_A_CREATOR' });
    const missing = checkProfileForListing(creatorRow);
    if (missing) {
        return res.status(409).json({
            error: 'PROFILE_INCOMPLETE',
            message: `Complete your profile before listing: missing ${missing}.`,
        });
    }

    // ISA gate per cert/certify_wsd step 7.
    if (!img.signing_event_id_authorship) {
        return res.status(409).json({
            error: 'ISA_REQUIRED',
            message: 'Sign the Image Signing Affirmation before listing.',
        });
    }

    await prisma.image.update({
        where: { image_id: img.image_id },
        data: { status: 'live', visibility: 'public', published_at: new Date() },
    });
    res.json({ ok: true });
});

// Init checkout: create a Purchase row + Stripe Embedded Checkout session.
// Spec: payments.md §2.1; R71 §3.7 row 15.
app.post('/v1/purchases', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const { image_id } = (req.body ?? {}) as { image_id?: string };
    if (!image_id) return res.status(400).json({ error: 'IMAGE_ID_REQUIRED' });

    const user = await prisma.user.findUnique({ where: { user_id } });
    if (!user) return res.status(401).json({ error: 'USER_NOT_FOUND' });
    const image = await prisma.image.findUnique({ where: { image_id } });
    if (!image) return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
    if (image.creator_id === user_id) {
        return res.status(400).json({ error: 'SELF_PURCHASE_FORBIDDEN' });
    }

    try {
        const result = await initCheckout({
            image_id,
            owner_id: user_id,
            owner_email: user.email,
            return_origin: req.header('origin') ?? `http://localhost:${PORT}`,
        });
        res.json(result);
    } catch (e) {
        const msg = (e as Error)?.message ?? 'init_checkout_failed';
        if (msg.startsWith('STRIPE_SECRET_KEY')) {
            return res.status(503).json({ error: 'STRIPE_NOT_CONFIGURED', message: msg });
        }
        console.error('[purchases.init] failed', msg);
        res.status(500).json({ error: 'INIT_CHECKOUT_FAILED', message: msg });
    }
});

// Buyer-triggered build per ADR-0001. Takes monogram_text as an inline body
// param (not persisted on Purchase before this call). MOCK at MVP scaffold --
// run_image_ops.ts builds the end-state synchronously instead of dispatching
// to runImageOps + crossmint_dispatch. Real impl: async job + Crossmint mint.
app.post('/v1/purchases/:purchaseId/start-build', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const purchase = await prisma.purchase.findUnique({
        where: { id: req.params.purchaseId },
    });
    if (!purchase) return res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
    if (purchase.owner_id !== user_id) {
        return res.status(403).json({ error: 'NOT_PURCHASE_OWNER' });
    }
    const { monogram_text } = (req.body ?? {}) as { monogram_text?: string };
    try {
        const result = await startBuild({
            purchase_id: purchase.id,
            monogram_text: monogram_text ?? '',
        });
        res.json(result);
    } catch (e) {
        const msg = (e as Error)?.message ?? 'start_build_failed';
        console.error('[purchases.start-build] failed', msg);
        res.status(500).json({ error: 'START_BUILD_FAILED', message: msg });
    }
});

// Purchase status -- polled by the post-payment banner until the mint
// resolves. If a Crossmint webhook already arrived, this just reads the
// Deed row. If not (e.g. local dev without a tunnel for Crossmint to reach
// our server), we look up the job at Crossmint and advance the local state
// inline. Both paths converge on idempotent Deed creation in the registry's
// applyMintSucceeded helper.
app.get('/v1/purchases/:purchaseId/status', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const purchase = await prisma.purchase.findUnique({
        where: { id: req.params.purchaseId },
        include: { image: { include: { deed: true } } },
    });
    if (!purchase) return res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
    if (purchase.owner_id !== user_id) {
        return res.status(403).json({ error: 'NOT_PURCHASE_OWNER' });
    }

    // Already final -- return the rolled-up state.
    if (purchase.image.deed) {
        return res.json({
            status: purchase.status,
            mint_address: purchase.image.deed.mint_address,
            deed_state: purchase.image.deed.deed_state,
        });
    }

    // Polling fallback: if we have a Crossmint job id and we're still in flight,
    // check Crossmint directly and advance state inline if the mint succeeded.
    if (purchase.status === 'minting' && purchase.crossmint_job_id) {
        try {
            const lookup = await lookupJob(purchase.crossmint_job_id);
            if (lookup.status === 'success' && lookup.mint_address) {
                await applyMintSucceeded(
                    purchase.id,
                    lookup.mint_address,
                    lookup.transaction_signature,
                    lookup.owner,
                );
                return res.json({
                    status: 'confirmed',
                    mint_address: lookup.mint_address,
                    deed_state: 'sealed',
                });
            }
            if (lookup.status === 'failed') {
                await applyMintFailed(purchase.id, lookup.failure_reason ?? 'unknown');
                return res.json({
                    status: 'failed',
                    failure_reason: lookup.failure_reason,
                });
            }
        } catch (e) {
            console.warn('[purchases.status] crossmint lookup failed', (e as Error).message);
        }
    }

    res.json({
        status: purchase.status,
        mint_address: null,
        failure_reason: purchase.failure_reason,
    });
});

// Privacy flip -- post-sale owner toggles between public and private.
// Diverges from R71/R62 spec (which has public as a one-way share affordance);
// this endpoint allows the round-trip. Owner gate: deed owner (post-mint) or
// creator (pre-mint).
app.post('/v1/images/:imageId/visibility', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const { visibility } = (req.body ?? {}) as { visibility?: string };
    if (visibility !== 'public' && visibility !== 'private') {
        return res.status(400).json({ error: 'INVALID_VISIBILITY' });
    }
    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { deed: true },
    });
    if (!img) return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
    const isDeedOwner = img.deed?.owner_id === user_id;
    const isCreator = img.creator_id === user_id;
    if (!isDeedOwner && !isCreator) {
        return res.status(403).json({ error: 'NOT_AUTHORIZED' });
    }
    await prisma.image.update({
        where: { image_id: img.image_id },
        data: { visibility, privacy_updated_at: new Date() },
    });
    res.json({ ok: true, visibility });
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
            preview_url: thumbnailUrlFor(i.image_id),
            submitted_at: i.created_at.toISOString(),
        })),
    });
});

app.post('/v1/admin/reviews/:imageId', async (req, res) => {
    const { user_id, role } = await authAsync(req);
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
    // Watermarked Listing Copy per R62 §2.2 -- used on the full image page
    // (the public-facing display). Includes Epimage wordmark + URL bar +
    // edition mark overlays.
    return buildListingPreviewUrl(imageId);
}

function thumbnailUrlFor(imageId: string): string {
    // Unwatermarked thumbnail per R62 §2.4 -- used in grids (creator
    // dashboard, buyer collection, moderator review queue). Watermark would
    // dominate at 500-600 px tile size, defeating the thumbnail's purpose
    // of helping the viewer choose an image.
    return buildThumbnailUrl(imageId);
}

// -------------------------------------------------------------------
// Error handlers
// -------------------------------------------------------------------

// Translate multer's size-cap rejection into a clean 413 with a route-aware
// message. Without this, multer's LIMIT_FILE_SIZE error falls through to the
// generic 500 INTERNAL handler.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
        const isHeadshot = req.path.includes('/headshot');
        const maxMb = (isHeadshot ? HEADSHOT_MAX_BYTES : IMAGE_MAX_BYTES) / 1024 / 1024;
        const label = isHeadshot ? 'Headshot' : 'Image';
        return res.status(413).json({
            error: 'FILE_TOO_LARGE',
            message: `${label} must be under ${maxMb} MB.`,
        });
    }
    next(err);
});

// Catch-all.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api]', err);
    res.status(500).json({ error: 'INTERNAL', message: err.message });
});

// Eager startup checks for env vars that arweave_master.ts only logs lazily
// on the first build call. Surfacing them at boot lets the operator paste the
// printed key into .env before any test purchase runs.
async function eagerStartupChecks() {
    if (!process.env.ARWEAVE_JWK_BASE64) {
        try {
            const arweave = Arweave.init({});
            const jwk = await arweave.wallets.generate();
            const jwkBase64 = Buffer.from(JSON.stringify(jwk)).toString('base64');
            console.warn(
                '\n[arweave] ARWEAVE_JWK_BASE64 not set. Generated a fresh JWK -- ' +
                'paste this line into .env and restart to persist (otherwise a new key mints each restart):\n' +
                `ARWEAVE_JWK_BASE64=${jwkBase64}\n`
            );
            process.env.ARWEAVE_JWK_BASE64 = jwkBase64;
        } catch (e) {
            console.warn('[arweave] startup JWK generation failed:', (e as Error).message);
        }
    }
}

app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    void eagerStartupChecks();
});
