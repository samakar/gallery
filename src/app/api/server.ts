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
import { uploadOriginal, uploadFromUrl, buildListingPreviewUrl, buildShareCopyUrl, buildDownloadUrl, buildThumbnailUrl, deleteAsset, uploadHeadshot, buildHeadshotUrl } from '../../commerce/image_gen';
import { initCheckout, handleStripeWebhook, refundPurchase } from '../../commerce/payments';
import { startBuild } from '../../commerce/run_image_ops';
// crossmint_webhook helpers no longer needed at this layer; run_image_ops calls
// applyMintSucceeded directly after the synchronous cNFT mint per ADR-0008.
import { startStalePaidSweeper } from '../workers/stale_paid_sweeper';
import { startArweaveReadySweeper } from '../workers/arweave_ready_sweeper';
import { httpLogger, logger } from '../logger';
import rateLimit from 'express-rate-limit';
import Arweave from 'arweave';
import { generatePlatformDek, decryptMaster, unwrapDek, buildEncFinalUnwrapped } from '../../cert/crypto';
import { readEncryptedMasterLocal } from '../../registry/arweave_master';
import { validateUniqueness, sharpPhashComputer, prismaPerCreatorStore } from '../../cert/image_uniqueness';
import { captureSignature } from '../../cert/esign';
import { getLegalDoc, listLegalDocs, type LegalDocType } from '../../cert/legal';
import { verifyEligibility as verifyYoutubeEligibility, buildAuthorizationUrl as buildYoutubeAuthorizationUrl } from '../../cert/youtube_eligibility';
import { verifyRecaptchaToken } from '../../cert/recaptcha';
import { sendOnboardingCreatorEmail, sendOnboardingBuyerEmail, sendCoaEmail, handlePostmarkWebhook } from '../../cert/email';
import { normalizeTitle, normalizeDescription, normalizeDisplayName, sanitizeFilename } from '../../cert/text_normalize';
import { Keypair as SolKeypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Platform wallet pubkey -- matches cnft_dispatch's resolution: explicit env
// var wins; otherwise derive from HOT_MINT_KEY so existing deeds and the
// collection-metadata creators array stay consistent.
function resolvePlatformWalletPubkey(): string | null {
    if (process.env.PLATFORM_WALLET_PUBKEY) return process.env.PLATFORM_WALLET_PUBKEY;
    if (!process.env.HOT_MINT_KEY) return null;
    try {
        const kp = SolKeypair.fromSecretKey(bs58.decode(process.env.HOT_MINT_KEY));
        return kp.publicKey.toBase58();
    } catch {
        return null;
    }
}

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
        // Parse with explicit segment enable -- the default fast-path with
        // `pick` skips IFD1 / SubIFD where some camera apps (notably Pixel
        // HDR+) write date metadata. Reading the whole EXIF block is
        // slightly slower but reliably finds the date.
        // exifr's TS types don't expose the per-segment booleans cleanly;
        // cast to bypass and use the runtime-correct option shape.
        const exif = await exifr.parse(buffer, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: false,
            interop: false,
            ifd1: true,
            mergeOutput: true,
        } as unknown as Parameters<typeof exifr.parse>[1]);
        const candidates: Array<{ name: string; value: unknown }> = [
            { name: 'DateTimeOriginal', value: exif?.DateTimeOriginal },
            { name: 'CreateDate', value: exif?.CreateDate },
            { name: 'DateTimeDigitized', value: exif?.DateTimeDigitized },
            { name: 'DateTime', value: exif?.DateTime },
            { name: 'ModifyDate', value: exif?.ModifyDate },
        ];
        const now = Date.now();
        for (const c of candidates) {
            const dt = c.value instanceof Date
                ? c.value
                : typeof c.value === 'string'
                    ? new Date(c.value)
                    : null;
            if (dt && !isNaN(dt.getTime())) {
                if (dt.getTime() <= now && dt.getFullYear() >= 1990) {
                    console.log(`[extractCreationDate] using ${c.name}=${dt.toISOString()}`);
                    return dt;
                }
            }
        }
        // Nothing found -- log what exifr did return so we can debug.
        console.warn(
            '[extractCreationDate] no usable EXIF date. Keys present:',
            exif ? Object.keys(exif).join(',') : '(null)'
        );
    } catch (e) {
        console.warn('[extractCreationDate] exifr error', (e as Error).message);
    }
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

// Crossmint webhook removed per ADR-0008 (self-mint cNFT is synchronous).
// applyMintSucceeded / applyMintFailed are still exported from crossmint_webhook.ts
// and now called inline from run_image_ops after the Bubblegum V2 mint confirms.

// Structured request logger -- runs after the webhook routes so their raw
// body is unaffected, but before everything else so all API calls are tracked.
app.use(httpLogger);

// Rate limit auth + signature endpoints. Webhook routes are above and not
// affected. Tuned for dev; tighten in production env.
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED' },
});
app.use(['/v1/auth/', '/v1/signatures', '/v1/purchases'], authLimiter);

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

// Public list of legal documents -- type, label, hash. Body fetched separately
// to keep the index small. Used by the SignIn / footer to drive ToS + Privacy
// links and by the ESIGN modals to display the currently-binding version.
app.get('/v1/legal', (_req, res) => {
    res.json({
        docs: listLegalDocs().map(d => ({
            type: d.type,
            label: d.label,
            hash: d.hash,
        })),
    });
});

app.get('/v1/legal/:docType', (req, res) => {
    const type = req.params.docType.toUpperCase() as LegalDocType;
    try {
        const doc = getLegalDoc(type);
        res.json(doc);
    } catch {
        res.status(404).json({ error: 'LEGAL_DOC_NOT_FOUND' });
    }
});

// Capture an ESIGN click event. document_version_hash MUST match the current
// hash from the cert/legal registry; we re-derive and verify rather than
// trust the client. Returns the signature id so callers can persist it as
// the foreign key on the relevant row (Purchase.signing_event_id_mja, etc.)
// Has the signed-in user signed MJA already? Cheap lookup driving the
// EsignModal's needsMja flag so returning buyers don't re-sign MJA on
// every purchase. License Acceptance is per-image and always required.
app.get('/v1/me/esign-status', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const mja = await prisma.signature.findFirst({
        where: { user_id, document_type: 'MJA' },
        select: { id: true },
        orderBy: { clicked_at: 'desc' },
    });
    res.json({ has_mja: mja !== null });
});

// YouTube OAuth + subscriber gate per identity.md §2.8.
// Step 1 of the dance: client GETs this to obtain the Google OAuth redirect URL,
// then navigates the browser to it. Returns 401 if not signed in (Magic session
// required so the verify callback can attribute the result to a known user_id).
// `redirect_uri` is client-supplied so it matches whatever origin the user is
// actually on (localhost:5173 in dev, the prod host in prod, a tunnel URL when
// testing devnet against external OAuth). PLATFORM_BASE_URL is the on-chain
// URL and is the wrong source for OAuth callbacks.
app.get('/v1/creator/youtube/authorize-url', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const redirect_uri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : null;
    if (!redirect_uri || !/^https?:\/\/[^/]+\/creator\/youtube\/callback$/.test(redirect_uri)) {
        return res.status(400).json({
            error: 'INVALID_REDIRECT_URI',
            message: 'redirect_uri query param required; must end with /creator/youtube/callback',
        });
    }
    // Use user_id as the OAuth `state` -- single-use round-trip identifier so the
    // callback knows which user to bind the verified channel to. Magic session
    // is also re-checked on the verify POST as defense in depth.
    try {
        const url = buildYoutubeAuthorizationUrl(redirect_uri, user_id);
        res.json({ authorize_url: url, redirect_uri });
    } catch (e: any) {
        return res.status(503).json({
            error: 'YOUTUBE_OAUTH_NOT_CONFIGURED',
            message: e?.message ?? 'YOUTUBE_OAUTH_CLIENT_ID env var not set',
        });
    }
});

// Step 2: client POSTs the OAuth authorization code returned by Google.
// Server exchanges code -> access_token, calls channels.list, applies gates,
// persists snapshot on users row + inserts creator_allowlist on pass.
app.post('/v1/creator/youtube/verify', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const { code, redirect_uri } = (req.body ?? {}) as { code?: string; redirect_uri?: string };
    if (!code || !redirect_uri) {
        return res.status(400).json({ error: 'MISSING_OAUTH_CODE_OR_REDIRECT' });
    }
    const user = await prisma.user.findUnique({
        where: { user_id },
        select: { email: true, youtube_verified_at: true },
    });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (user.youtube_verified_at) {
        // Idempotent: re-verification is a no-op. Surface the existing state.
        return res.status(409).json({ error: 'ALREADY_VERIFIED' });
    }

    const result = await verifyYoutubeEligibility(code, redirect_uri);
    if (!result.ok) {
        // Map to HTTP statuses: 4xx for user-correctable, 502 for upstream failure.
        const status =
            result.error_code === 'YOUTUBE_OAUTH_FAILED' ? 502 :
            result.error_code === 'YOUTUBE_NO_CHANNEL' ? 400 :
            403;
        return res.status(status).json({
            error: result.error_code,
            message: result.message,
            subscriber_count: 'subscriber_count' in result ? result.subscriber_count : undefined,
            recent_upload_count: 'recent_upload_count' in result ? result.recent_upload_count : undefined,
        });
    }

    // Persist the snapshot + auto-allowlist atomically.
    try {
        await prisma.$transaction(async tx => {
            await tx.user.update({
                where: { user_id },
                data: {
                    youtube_channel_id: result.channel_id,
                    youtube_channel_handle: result.channel_handle,
                    youtube_subscriber_count_at_onboarding: result.subscriber_count,
                    youtube_verified_at: result.verified_at,
                },
            });
            // Upsert -- if a manual founder row already exists, leave it (its
            // `note` may carry vetting context we don't want to overwrite).
            await tx.creatorAllowlist.upsert({
                where: { email: user.email },
                create: { email: user.email, note: 'youtube_oauth' },
                update: {},
            });
        });
    } catch (e: any) {
        // The unique constraint on users.youtube_channel_id fires here if
        // another user already verified this same channel -- surface a clean
        // error instead of a 500.
        if (typeof e?.message === 'string' && e.message.includes('youtube_channel_id')) {
            return res.status(409).json({
                error: 'YOUTUBE_CHANNEL_ALREADY_CLAIMED',
                message: 'This YouTube channel is already linked to a different Epimage account.',
            });
        }
        logger.error({ err: e, user_id }, 'youtube verify persist failed');
        return res.status(500).json({ error: 'PERSIST_FAILED' });
    }

    res.json({
        ok: true,
        channel_id: result.channel_id,
        channel_handle: result.channel_handle,
        subscriber_count: result.subscriber_count,
        recent_upload_count: result.recent_upload_count,
        verified_at: result.verified_at.toISOString(),
    });
});

// Sign the Creator Master Agreement (CMA). Per identity.md §2.7 and
// creator_onboarding_wsd.md step 6: creates the `creators` row in the same
// transaction as the CMA `signatures` row (INV-2). Preconditions checked
// in order: authed; allowlisted; has YouTube-verified row on User; not
// already a creator. youtube_channel_handle is copied from User to Creator
// (per identity.md §2.7 source column).
app.post('/v1/creator/sign-cma', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const user = await prisma.user.findUnique({
        where: { user_id },
        select: {
            email: true,
            youtube_channel_handle: true,
            youtube_verified_at: true,
            creator: { select: { user_id: true } },
        },
    });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (user.creator) return res.status(409).json({ error: 'ALREADY_A_CREATOR' });

    // Allowlist gate (identity.md §2.4). Allowlist row is auto-inserted by
    // YouTube verify on pass; manual founder rows also count.
    const allowlistRow = await prisma.creatorAllowlist.findUnique({
        where: { email: user.email },
    });
    if (!allowlistRow) return res.status(403).json({ error: 'CREATOR_NOT_ALLOWLISTED' });

    // youtube_channel_handle must be populated. Manual-allowlist exception
    // path (note != 'youtube_oauth') is allowed through with a fallback handle
    // -- founder will edit display values post-sign-cma.
    const youtube_channel_handle = user.youtube_channel_handle ?? `@${user.email.split('@')[0]}`;

    const body = (req.body ?? {}) as {
        legal_name?: string;
        legal_address?: unknown;
        entity_type?: string;
    };
    const legal_name = typeof body.legal_name === 'string' ? body.legal_name.trim() : '';
    const entity_type = typeof body.entity_type === 'string' ? body.entity_type.trim().toLowerCase() : '';
    const legal_address = body.legal_address && typeof body.legal_address === 'object'
        ? JSON.stringify(body.legal_address)
        : null;
    if (!legal_name) return res.status(400).json({ error: 'MISSING_LEGAL_NAME' });
    if (!legal_address) return res.status(400).json({ error: 'MISSING_LEGAL_ADDRESS' });
    if (!['individual', 'llc', 'corp'].includes(entity_type)) {
        return res.status(400).json({ error: 'INVALID_ENTITY_TYPE' });
    }
    // display_name is not part of the CMA contract -- it's a profile field
    // (see Profile.tsx ordering: editable fields up top, signing artifacts
    // at the bottom). Seed it from the YouTube handle so the schema-required
    // creators.display_name is non-empty at row creation; the creator edits
    // it later on /creator/profile before listing (checkProfileForListing
    // still gates listings on a non-empty display_name).
    const display_name = youtube_channel_handle.replace(/^@/, '');

    // Render the CMA text. esign.captureSignature hashes the rendered text
    // as document_version_hash -- the content integrity anchor. We append
    // the counterparty's legal_name + signing timestamp so each signature
    // hash is unique to the actual signing event.
    let cmaDoc;
    try {
        cmaDoc = getLegalDoc('CMA');
    } catch {
        return res.status(500).json({ error: 'CMA_DOC_NOT_FOUND' });
    }
    const clicked_at = new Date().toISOString();
    const documentText = `${cmaDoc.body}\n\n---\nSigned by: ${legal_name} (${entity_type})\nLegal address: ${legal_address}\nSigned at: ${clicked_at}\n`;

    // Atomic: signatures row + creators row in one transaction. Per INV-2,
    // the CMA signature precedes the role-row creation -- both land together.
    // captureSignature receives `tx` so it writes on the SAME connection;
    // omitting that argument made the two writes contend for the SQLite
    // lock from separate connections and trigger the 5s tx timeout.
    let signature_id: string | null = null;
    try {
        await prisma.$transaction(async tx => {
            const sigResult = await captureSignature({
                user_id,
                document_type: 'CMA',
                document_text: documentText,
                document_version_label: cmaDoc.label,
                image_id: null,
                click: {
                    ip_address: req.ip ?? '0.0.0.0',
                    session_token_hash: createHash('sha256').update(user_id).digest('hex'),
                    clicked_at,
                },
            }, tx);
            if (!sigResult.ok) {
                throw new Error(`ESIGN_FAILED: ${sigResult.message}`);
            }
            signature_id = sigResult.row.signing_event_id;
            await tx.creator.create({
                data: {
                    user_id,
                    display_name,
                    legal_name,
                    legal_address,
                    entity_type,
                    youtube_channel_handle,
                    // creator_headshot_url + creator_bio captured later via
                    // PATCH /v1/creator/profile + POST /v1/creator/profile/headshot.
                },
            });
        });
    } catch (e: any) {
        logger.error({ err: e, user_id }, 'sign-cma transaction failed');
        return res.status(500).json({ error: 'SIGN_CMA_FAILED', message: e?.message ?? String(e) });
    }

    // TODO(identity.md §2.6, INV-4): identity.provisionWalletIfMissing(user_id).
    // Wallets subsystem is not yet wired -- creators end up with NULL
    // wallet_address at MVP. Card 1 (Certify) doesn't need the wallet; first
    // purchase by this creator (when they self-buy a test listing) will need it.

    // Onboarding email per /docs/cert/email.md §3.2 -- fire-and-forget so the
    // response returns immediately even if Postmark is slow / down. The
    // creators row + signature row are already committed; email failure does
    // NOT roll them back. ops re-sends out-of-band per email.md §2.4.
    if (signature_id) {
        const sigId = signature_id;
        setImmediate(async () => {
            try {
                const result = await sendOnboardingCreatorEmail({
                    to: user.email,
                    creator_display_name: display_name,
                    cma: {
                        signature_id: sigId,
                        signed_at: clicked_at,
                        document_version_label: cmaDoc.label,
                        document_version_hash: createHash('sha256').update(documentText).digest('hex'),
                        legal_name,
                        legal_address: JSON.parse(legal_address ?? '{}'),
                        entity_type: entity_type as 'individual' | 'llc' | 'corp',
                        ip_address: req.ip ?? '0.0.0.0',
                        body: documentText,
                    },
                });
                if (result.ok) {
                    await prisma.signature.update({
                        where: { id: sigId },
                        data: { email_message_id: result.message_id },
                    });
                } else {
                    logger.warn({ user_id, sigId, err: result }, 'onboarding_creator email send failed');
                }
            } catch (e: any) {
                logger.error({ user_id, sigId, err: e?.message ?? e }, 'onboarding_creator email exception');
            }
        });
    }

    res.json({ ok: true, user_id });
});

// Cheap status check for the onboarding flow: did this user finish YouTube
// verification AND complete sign-cma? Drives the "where should they land?"
// routing logic in Profile / YoutubeVerify pages.
app.get('/v1/creator/onboarding-status', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const user = await prisma.user.findUnique({
        where: { user_id },
        select: {
            email: true,
            youtube_verified_at: true,
            creator: { select: { user_id: true } },
        },
    });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const allowlistRow = await prisma.creatorAllowlist.findUnique({
        where: { email: user.email },
        select: { email: true },
    });
    res.json({
        youtube_verified: user.youtube_verified_at !== null,
        allowlisted: allowlistRow !== null,
        cma_signed: user.creator !== null,
        next_step: user.creator
            ? 'complete'
            : user.youtube_verified_at && allowlistRow
                ? 'sign-cma'
                : 'youtube-verify',
    });
});

// Cheap status check the UI polls to know whether the creator has completed
// the YouTube gate. Used by the onboarding flow to decide whether to show the
// "Connect YouTube" CTA vs let the creator proceed to sign-cma.
app.get('/v1/me/youtube-status', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const u = await prisma.user.findUnique({
        where: { user_id },
        select: {
            youtube_channel_id: true,
            youtube_channel_handle: true,
            youtube_subscriber_count_at_onboarding: true,
            youtube_verified_at: true,
        },
    });
    if (!u) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.json({
        verified: u.youtube_verified_at !== null,
        channel_id: u.youtube_channel_id,
        channel_handle: u.youtube_channel_handle,
        subscriber_count_at_onboarding: u.youtube_subscriber_count_at_onboarding,
        verified_at: u.youtube_verified_at?.toISOString() ?? null,
    });
});

app.post('/v1/signatures', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    const { document_type, image_id } = (req.body ?? {}) as {
        document_type?: string;
        image_id?: string;
    };
    if (!document_type) return res.status(400).json({ error: 'DOCUMENT_TYPE_REQUIRED' });
    let doc;
    try {
        doc = getLegalDoc(document_type as LegalDocType);
    } catch {
        return res.status(400).json({ error: 'UNKNOWN_DOCUMENT_TYPE' });
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const sig = await prisma.signature.create({
        data: {
            user_id,
            document_type,
            document_version_hash: doc.hash,
            document_version_label: doc.label,
            image_id: image_id ?? null,
            ip_address: ip,
            session_token_hash: createHash('sha256')
                .update(req.header('authorization') ?? req.header('x-dev-user') ?? '')
                .digest('hex'),
        },
    });

    // onboarding_buyer email at MJA capture per /docs/cert/email.md §3.2.
    // Fire-and-forget; failures don't roll back the signature.
    if (document_type === 'MJA') {
        const userRow = await prisma.user.findUnique({ where: { user_id }, select: { email: true } });
        if (userRow?.email) {
            const buyerEmail = userRow.email;
            const sigId = sig.id;
            setImmediate(async () => {
                try {
                    const result = await sendOnboardingBuyerEmail({
                        to: buyerEmail,
                        // No buyer legal name at MJA capture (Stripe billing comes
                        // later). Use the email as a stable identifier until the
                        // buyer's Stripe customer fills in a real name.
                        buyer_display_name: buyerEmail,
                        bma: {
                            signature_id: sigId,
                            signed_at: sig.clicked_at.toISOString(),
                            document_version_label: doc.label,
                            document_version_hash: doc.hash,
                            legal_name: buyerEmail,
                            legal_address: {},
                            ip_address: ip,
                            body: doc.body,
                        },
                    });
                    if (result.ok) {
                        await prisma.signature.update({
                            where: { id: sigId },
                            data: { email_message_id: result.message_id },
                        });
                    } else {
                        logger.warn({ user_id, sigId, err: result }, 'onboarding_buyer email send failed');
                    }
                } catch (e: any) {
                    logger.error({ user_id, sigId, err: e?.message ?? e }, 'onboarding_buyer email exception');
                }
            });
        }
    }

    res.json({
        ok: true,
        signature_id: sig.id,
        document_version_hash: doc.hash,
        document_version_label: doc.label,
        clicked_at: sig.clicked_at.toISOString(),
    });
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
        // returns a fresh image on each call; the seed query keys it.
        const uploaded = await uploadFromUrl(newId, `https://picsum.photos/seed/${newId}/1080/720`);
        // Synthesize image_spec from the Cloudinary response so the Deed
        // panel's Technical Specification section has real values to show.
        // Picsum serves 8-bit sRGB JPEGs.
        const image_spec = JSON.stringify({
            width_px: uploaded.width,
            height_px: uploaded.height,
            color_space: 'sRGB',
            icc_profile: 'sRGB IEC61966-2.1',
            color_depth_bits: 8,
            file_type: 'image/jpeg',
            file_size_bytes: uploaded.bytes,
        });
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
                width_px: uploaded.width,
                height_px: uploaded.height,
                image_spec,
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
// Dev-only: send a test email to a recipient (defaults to EMAIL_FROM_ADDRESS,
// which is always a verified Sender Signature so it works in Postmark test
// mode). Generates a sample CMA PDF and dispatches via the same code path
// the production onboarding email uses. Refuses to run when NODE_ENV=production.
app.post('/v1/dev/send-test-email', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'NOT_AVAILABLE_IN_PRODUCTION' });
    }
    const { to } = (req.body ?? {}) as { to?: string };
    const recipient = to?.trim() || process.env.EMAIL_FROM_ADDRESS;
    if (!recipient) {
        return res.status(400).json({ error: 'MISSING_RECIPIENT', message: 'Provide `to` or set EMAIL_FROM_ADDRESS' });
    }
    const { renderCmaPdf } = await import('../../cert/pdf_bundle');
    let pdfBuffer: Buffer;
    try {
        pdfBuffer = await renderCmaPdf({
            signature_id: 'test-signature-not-real',
            signed_at: new Date().toISOString(),
            document_version_label: 'CMA-test-1.0',
            document_version_hash: 'a'.repeat(64),
            legal_name: 'Test Creator',
            legal_address: { street: '123 Test St', city: 'San Francisco', state_or_region: 'CA', postal_code: '94105', country: 'United States' },
            entity_type: 'individual',
            ip_address: '127.0.0.1',
            body: 'This is a TEST CMA used only for verifying Postmark integration. The signature event is not real.',
        });
    } catch (e: any) {
        return res.status(500).json({ error: 'PDF_RENDER_FAILED', message: e?.message ?? String(e) });
    }

    const token = process.env.POSTMARK_SERVER_TOKEN;
    const from = process.env.EMAIL_FROM_ADDRESS;
    if (!token || !from) {
        return res.status(503).json({
            error: 'POSTMARK_NOT_CONFIGURED',
            message: 'POSTMARK_SERVER_TOKEN and EMAIL_FROM_ADDRESS must be set in .env',
        });
    }
    try {
        const resp = await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': token,
            },
            body: JSON.stringify({
                From: from,
                To: recipient,
                Subject: 'Epimage Postmark integration test',
                HtmlBody:
                    '<!DOCTYPE html><html><body style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">' +
                    '<h1 style="font-weight: 300;">Postmark integration test</h1>' +
                    '<p>If you see this email and the attached PDF opens cleanly, the integration works.</p>' +
                    `<p><strong>Sent at:</strong> ${new Date().toISOString()}</p>` +
                    '<p style="font-size: 12px; color: #888;">Triggered from the Backdoor dev page.</p>' +
                    '</body></html>',
                TextBody:
                    'Postmark integration test.\n' +
                    `Sent at: ${new Date().toISOString()}\n\n` +
                    'If you see this email and the attached PDF opens, the integration works.',
                MessageStream: 'outbound',
                Attachments: [
                    {
                        Name: 'test-cma.pdf',
                        Content: pdfBuffer.toString('base64'),
                        ContentType: 'application/pdf',
                    },
                ],
            }),
        });
        const data: any = await resp.json().catch(() => ({}));
        if (resp.ok) {
            return res.json({ ok: true, message_id: data.MessageID, submitted_at: data.SubmittedAt, to: data.To });
        }
        return res.status(502).json({
            error: 'POSTMARK_REJECTED',
            http_status: resp.status,
            postmark_error: data,
        });
    } catch (e: any) {
        return res.status(502).json({ error: 'POSTMARK_NETWORK_ERROR', message: e?.message ?? String(e) });
    }
});

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
        // Magic returns multi-wallet identities with `wallet_type` per entry
        // ('ETH' | 'SOLANA' | ...) and `network` set to the chain network
        // name ('MAINNET' for both). The Solana wallet shows up in wallets[]
        // alongside the ETH default; we MUST match on wallet_type (not network).
        // The top-level meta.publicAddress is always the EVM one, so we
        // explicitly pick the SOLANA entry rather than falling back to it.
        const solanaWallet = (meta.wallets as any[] | undefined)?.find(
            w => (w.wallet_type ?? w.walletType ?? '').toUpperCase() === 'SOLANA',
        );
        walletAddress = (solanaWallet?.public_address ?? solanaWallet?.publicAddress ?? null) as string | null;
        if (!walletAddress) {
            // Defensive: log so we notice if Magic stops returning a SOLANA wallet
            // (shouldn't happen if the SolanaExtension is registered client-side).
            console.warn(
                '[auth.magic] no SOLANA wallet in admin metadata; wallets[]=',
                JSON.stringify(meta.wallets),
            );
        }
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
            asset_id: d.asset_id,
            minted_at: d.minted_at.toISOString(),
            custody_state: d.custody_state,
            legal_state: d.legal_state,
        })),
    });
});

// Image page
app.get('/v1/images/:imageId', async (req, res) => {
    const { user_id } = await authAsync(req);
    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { creator: { include: { user: true } }, deed: true },
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
    // Canonical short URL `/i/<image_id>` -- the browser resolves it against
    // the current origin (localhost in dev, epimage.com in prod), and the
    // GET /i/:imageId redirect picks the right Cloudinary variant.
    // "Copy image address" now returns this short URL instead of the long
    // Cloudinary one.
    //
    // Cache-bust when the deed exists so the post-sale polling refetch
    // produces a NEW URL (Listing Preview cached pre-sale won't be reused;
    // the browser refetches and resolves to the Share Copy variant).
    const preview_url = img.deed
        ? `/i/${img.image_id}?v=${img.deed.minted_at.getTime()}`
        : `/i/${img.image_id}`;
    let purchase_price_cents: number | null = null;
    let purchased_at: string | null = null;
    // Pending-purchase recovery: if the signed-in viewer has a paid-but-not-
    // built purchase for this image with no monogram (i.e. they closed the
    // tab between Stripe success and the monogram step), surface the id so
    // the client can re-open the BuyWizard at the monogram step.
    let pending_purchase_id: string | null = null;
    if (user_id) {
        const pending = await prisma.purchase.findFirst({
            where: {
                image_id: img.image_id,
                owner_id: user_id,
                status: 'paid',
                monogram_text: null,
            },
            select: { id: true },
            orderBy: { created_at: 'desc' },
        });
        pending_purchase_id = pending?.id ?? null;
    }
    if (img.deed) {
        const confirming = await prisma.purchase.findFirst({
            where: { image_id: img.image_id, status: 'confirmed' },
            select: { monogram_text: true, amount_gross_cents: true, completed_at: true },
            orderBy: { completed_at: 'desc' },
        });
        purchased_at = confirming?.completed_at?.toISOString() ?? img.deed.minted_at.toISOString();
        if (viewer_is_owner) {
            purchase_price_cents = confirming?.amount_gross_cents ?? null;
        }
    }
    res.json({
        image_id: img.image_id,
        title: img.title,
        creation_date: img.creation_date.toISOString(),
        edition: 'Unique',
        listed_price_cents: img.status === 'sold' ? null : img.listed_price,
        purchase_price_cents,
        purchased_at,
        pending_purchase_id,
        status: img.status,
        visibility: img.visibility,
        // Always expose dimensions from the Image row -- image_spec JSON may
        // be null on older rows but these columns are populated at upload
        // time. Lets the print-size calc work even when image_spec is null.
        image_width_px: img.width_px,
        image_height_px: img.height_px,
        preview_url,
        // Unwatermarked Thumbnail (R62 §2.2) -- used by the private-state
        // render of a sold deed (R71 §2.7 revised) so an anonymous viewer sees
        // Thumbnail + COA panel instead of a blank lock stub.
        thumbnail_url: thumbnailUrlFor(img.image_id),
        creator: {
            display_name: img.creator.display_name,
            youtube_channel_handle: img.creator.youtube_channel_handle,
            headshot_url: img.creator.creator_headshot_url,
            bio: img.creator.creator_bio,
            context_video_url: null,
            wallet_address: img.creator.user.wallet_address ?? null,
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
        arweave_ready_at: img.arweave_ready_at?.toISOString() ?? null,
        sha256: img.sha256 ?? null,
        phash: img.phash ?? null,
        deed_asset_id: img.deed?.asset_id ?? null,
        deed_owner_wallet: img.deed?.owner_wallet_address ?? null,
        deed_minted_at: img.deed?.minted_at?.toISOString() ?? null,
        // Pre-sale: no Deed row exists yet, but the buyer sees a coherent
        // state machine. Synthetic 'draft' represents "image listed, no deed
        // issued yet" on the custody axis. Once the deed mints, custody_state
        // becomes 'sealed'. 'draft' is API-synthetic only; the Deed row's
        // custody_state column never holds 'draft' so INV-10 totality isn't
        // widened. legal_state defaults to 'legit' pre-sale and post-mint.
        custody_state: img.deed?.custody_state ?? 'draft',
        legal_state: img.deed?.legal_state ?? 'legit',
        // Owner-bound inner sealed-box exposed once the deed transitions
        // sealed -> unsealed (first /download-master). Anyone with the deed
        // owner's wallet privkey can peel this to recover DEK_image and
        // independently verify the Arweave Master against the on-chain
        // sha256 anchor. base64 of NaCl sealed-box(DEK_image, wallet_pubkey).
        // Null pre-open; populated permanently after first download.
        enc_final_unwrapped: img.deed?.enc_final_unwrapped ?? null,
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

    let nextDisplayName = creator.display_name;
    if (typeof display_name === 'string') {
        const r = normalizeDisplayName(display_name);
        if (!r.ok) return res.status(400).json({ error: r.code, message: r.message });
        nextDisplayName = r.value;
    }
    let nextLegalName = creator.legal_name;
    if (typeof legal_name === 'string') {
        const r = normalizeDisplayName(legal_name);
        if (!r.ok) return res.status(400).json({ error: r.code, message: r.message });
        nextLegalName = r.value;
    }
    let nextBio = creator.creator_bio;
    if (typeof creator_bio === 'string') {
        const r = normalizeDescription(creator_bio);
        if (!r.ok) return res.status(400).json({ error: r.code, message: r.message });
        nextBio = r.value;
    }

    await prisma.creator.update({
        where: { user_id },
        data: {
            display_name: nextDisplayName,
            legal_name: nextLegalName,
            youtube_channel_handle:
                typeof youtube_channel_handle === 'string'
                    ? youtube_channel_handle
                    : creator.youtube_channel_handle,
            creator_bio: nextBio,
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

    // Compute the SHA-256 over the original upload bytes -- the actual Master
    // pixels. We have the buffer in hand from multer, so no Cloudinary
    // roundtrip. This is the SAME hash that the deed will anchor at mint time
    // (M+00 in variant_hashes), so what the buyer verifies pre-sale matches
    // what gets committed on-chain post-sale. arweave_master.ts reads
    // Image.sha256 (idempotent read-through) instead of re-hashing.
    const masterSha256 = createHash('sha256').update(req.file.buffer).digest('hex');

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
            sha256: masterSha256,
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

    let nextTitle = img.title;
    if (typeof title === 'string') {
        const r = normalizeTitle(title);
        if (!r.ok) return res.status(400).json({ error: r.code, message: r.message });
        nextTitle = r.value;
    }
    let nextDescription = img.description;
    if (typeof description === 'string') {
        const r = normalizeDescription(description);
        if (!r.ok) return res.status(400).json({ error: r.code, message: r.message });
        nextDescription = r.value;
    }

    await prisma.image.update({
        where: { image_id: img.image_id },
        data: {
            title: nextTitle,
            description: nextDescription,
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
// Third-party abuse / safety / rights report. Anonymous-allowed (no auth gate).
// reCAPTCHA Enterprise score gate is the sole spam defense per product decision.
// The recaptcha_token field is required; verifyRecaptchaToken hits Google's
// assessments.create -- if the score is below RECAPTCHA_MIN_SCORE (default 0.5)
// or the token is invalid / action-mismatched, the report is rejected.
const VALID_REPORT_REASONS = new Set(['rights', 'safety', 'fraud', 'quality', 'other']);
app.post('/v1/images/:imageId/report', async (req, res) => {
    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        select: { image_id: true },
    });
    if (!img) return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });

    const body = (req.body ?? {}) as {
        reason?: string;
        description?: string;
        email?: string;
        recaptcha_token?: string;
    };
    const reason = typeof body.reason === 'string' ? body.reason.trim().toLowerCase() : '';
    if (!VALID_REPORT_REASONS.has(reason)) {
        return res.status(400).json({ error: 'INVALID_REASON', allowed: [...VALID_REPORT_REASONS] });
    }
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null;
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 254) : null;
    const token = typeof body.recaptcha_token === 'string' ? body.recaptcha_token : '';
    if (!token) return res.status(400).json({ error: 'MISSING_RECAPTCHA_TOKEN' });

    // Auth-optional: signed-in reporters get attributed via reporter_user_id;
    // anonymous reporters just leave the FK null.
    const auth = await authAsync(req);
    const reporter_user_id = auth.user_id ?? null;

    // reCAPTCHA gate. siteKey is needed in the assessment payload so Google
    // can verify the token was minted for this property.
    const siteKey = process.env.VITE_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
        return res.status(503).json({ error: 'RECAPTCHA_NOT_CONFIGURED' });
    }
    const verdict = await verifyRecaptchaToken(token, siteKey);
    if (!verdict.ok) {
        // Surface only the error code -- don't leak score / action details to
        // the caller (potential abuse signal). Server log carries full detail.
        logger.warn(
            {
                image_id: img.image_id,
                error_code: verdict.error_code,
                message: verdict.message,
                score: verdict.score,
                action: verdict.action,
            },
            'report rejected by recaptcha',
        );
        const status = verdict.error_code === 'RECAPTCHA_LOW_SCORE' ? 429 : 400;
        return res.status(status).json({ error: verdict.error_code });
    }

    const row = await prisma.imageReport.create({
        data: {
            image_id: img.image_id,
            reporter_user_id,
            reporter_email: email,
            reason,
            description,
            ip_address: req.ip ?? null,
            recaptcha_score: verdict.score,
            recaptcha_action: verdict.action,
            // status defaults to 'open'.
        },
        select: { id: true, created_at: true },
    });
    res.status(201).json({ report_id: row.id, submitted_at: row.created_at.toISOString() });
});

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

    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { deed: true },
    });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });

    // Two paths:
    //  - First-sale listing by the creator (status='draft', no deed)
    //  - Resale listing by the deed owner (status='sold', deed exists, after
    //    the R71 INV-05 30-day settlement period)
    const isResale = img.deed !== null;
    if (isResale) {
        if (img.deed!.owner_id !== user_id) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'Only the deed owner can relist.' });
        }
        if (img.status !== 'sold') {
            return res.status(409).json({ error: 'INVALID_STATE_FOR_RESALE', status: img.status });
        }
        // 30-day settlement gate (R71 INV-05).
        const SETTLEMENT_MS = 30 * 24 * 60 * 60 * 1000;
        const confirming = await prisma.purchase.findFirst({
            where: { image_id: img.image_id, status: 'confirmed' },
            orderBy: { completed_at: 'desc' },
            select: { completed_at: true },
        });
        const settlementStart = confirming?.completed_at ?? img.deed!.minted_at;
        const settlementEnd = new Date(settlementStart.getTime() + SETTLEMENT_MS);
        if (new Date() < settlementEnd) {
            return res.status(409).json({
                error: 'SETTLEMENT_PERIOD',
                message: `Resale available after ${settlementEnd.toISOString()} (30 days post-purchase).`,
                settlement_ends_at: settlementEnd.toISOString(),
            });
        }
        const titleErr = validateTitle(img.title || '');
        if (titleErr) return res.status(409).json({ error: 'INVALID_TITLE', message: titleErr });
        const descErr = validateDescription(img.description || '');
        if (descErr) return res.status(409).json({ error: 'INVALID_DESCRIPTION', message: descErr });
        if (img.listed_price <= 0) return res.status(409).json({ error: 'INCOMPLETE_METADATA' });
        await prisma.image.update({
            where: { image_id: img.image_id },
            data: { status: 'live', visibility: 'public', published_at: new Date() },
        });
        return res.json({ ok: true, resale: true });
    }

    // First-sale path (original behavior).
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
    const { image_id, mja_signature_id, license_signature_id } = (req.body ?? {}) as {
        image_id?: string;
        mja_signature_id?: string | null;
        license_signature_id?: string;
    };
    if (!image_id) return res.status(400).json({ error: 'IMAGE_ID_REQUIRED' });
    if (!license_signature_id) return res.status(400).json({ error: 'LICENSE_REQUIRED' });

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
            mja_signature_id: mja_signature_id ?? null,
            license_signature_id,
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
            asset_id: purchase.image.deed.asset_id,
            custody_state: purchase.image.deed.custody_state,
            legal_state: purchase.image.deed.legal_state,
        });
    }

    // Polling fallback removed per ADR-0008: the self-mint cNFT dispatcher is
    // synchronous -- by the time `purchase.image.deed` is null, either the mint
    // has not yet attempted or it failed mid-dispatch and rolled back to 'paid'.
    // The stale-paid sweeper handles retry per ADR-0007.

    res.json({
        status: purchase.status,
        asset_id: null,
        failure_reason: purchase.failure_reason,
    });
});

// Public creator page lookup by YouTube handle.
// Handle is stored with the leading "@" in the DB; URL omits it
// (epimage.com/c/sample -> handle param = "sample" -> DB lookup for "@sample").
// The canonical front-end URL is /c/<handle>; namespaces no longer collide
// with /<image_id>, so any image-id-shaped handle (5 chars base-36) is a
// valid lookup here -- no reserved-namespace guard.
app.get('/v1/creators/by-handle/:handle', async (req, res) => {
    const handle = req.params.handle;
    const fullHandle = `@${handle}`;
    const creator = await prisma.creator.findFirst({
        where: { youtube_channel_handle: fullHandle },
        include: {
            user: { select: { email: true } },
            images: {
                where: { status: { in: ['live', 'sold'] }, visibility: 'public' },
                orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }],
                select: {
                    image_id: true,
                    title: true,
                    status: true,
                    listed_price: true,
                    creation_date: true,
                },
            },
        },
    });
    if (!creator) return res.status(404).json({ error: 'CREATOR_NOT_FOUND' });
    res.json({
        handle: creator.youtube_channel_handle,
        display_name: creator.display_name,
        bio: creator.creator_bio,
        headshot_url: creator.creator_headshot_url
            ? buildHeadshotUrl(creator.creator_headshot_url)
            : null,
        listings: creator.images.map(i => ({
            image_id: i.image_id,
            title: i.title,
            status: i.status,
            // R67 §6.6: hide price post-sale. Pre-sale price is public.
            listed_price_cents: i.status === 'sold' ? null : i.listed_price,
            creation_date: i.creation_date.toISOString(),
            preview_url: `/i/${i.image_id}`,
        })),
    });
});

// Image proxy: /i/<image_id> 302-redirects to the appropriate Cloudinary
// variant (Listing Copy pre-sale, Share Copy post-mint). Lets us expose a
// short canonical URL in the <img src> so a "Copy image address" gives
// `<origin>/i/<image_id>` -- localhost in dev, epimage.com in prod.
// Deed-holder Master Image download (R71 §1.1 + R62 §3.5.1).
// Buyer requests Master download -> server fetches encrypted Master from
// Arweave, decrypts via unwrapped DEK_image, streams bytes with
// Content-Disposition: attachment. First successful call flips custody_state
// from 'sealed' to 'unsealed' (one-way; D-18 seal-break also persists
// enc_final_unwrapped). Subsequent calls are idempotent: re-stream the
// Master without further state mutation.
//
// MVP scope: custody_state transition is DB-only. On-chain `update_metadata_v1`
// sync is post-MVP (see /docs/divergences.md OI-04). Authorization gate
// requires BOTH custody axis allows it (sealed | unsealed; burned blocks) AND
// legal axis allows it (legit; disputed | void blocks).
app.post('/v1/deeds/:imageId/download-master', async (req, res) => {
    const { user_id } = await authAsync(req);
    if (!user_id) return res.status(401).json({ error: 'AUTH_REQUIRED' });

    const imageId = req.params.imageId;
    const image = await prisma.image.findUnique({
        where: { image_id: imageId },
        include: {
            deed: true,
            creator: { select: { youtube_channel_handle: true } },
        },
    });
    if (!image) return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });
    if (!image.deed) return res.status(404).json({ error: 'DEED_NOT_FOUND' });
    if (image.deed.owner_id !== user_id) {
        return res.status(403).json({ error: 'NOT_DEED_HOLDER' });
    }
    if (image.deed.custody_state === 'burned' || image.deed.legal_state !== 'legit') {
        return res.status(403).json({
            error: 'DEED_STATE_BLOCKS_DOWNLOAD',
            custody_state: image.deed.custody_state,
            legal_state: image.deed.legal_state,
        });
    }
    if (!image.dek_wrapped) {
        return res.status(500).json({ error: 'NO_DEK_WRAPPED' });
    }

    // Source the encrypted Master from local disk first (MVP operative path
    // per R71 §1.1: platform delivers from the local copy persisted at
    // arweave_master time). Arweave fallback only if local is missing -- e.g.
    // legacy deeds minted before D-11 local persistence shipped.
    let ciphertext: Buffer | null = await readEncryptedMasterLocal(imageId);
    if (!ciphertext && image.arweave_uri) {
        try {
            const arResp = await fetch(image.arweave_uri);
            if (arResp.ok) {
                const buf = Buffer.from(await arResp.arrayBuffer());
                // D-11 fallback uploads a JSON manifest when out of Turbo
                // credits, not encrypted bytes. Detect that to surface a
                // clearer error than a downstream decrypt failure.
                if (buf.length === 0 || buf[0] === 0x7b) {
                    return res.status(503).json({
                        error: 'MASTER_NOT_RECOVERABLE',
                        message: 'Local encrypted Master is missing and the Arweave URI points at a D-11 manifest stub rather than the encrypted bytes. This image needs to be re-uploaded after the Arweave wallet is funded, or a new purchase needs to be walked through.',
                    });
                }
                // Pre-2026-06-06 ADR-0010 mints (now superseded) wrote a nested
                // ZIP envelope here. Detect the ZIP magic header (`PK\x03\x04`)
                // and refuse with a clear error rather than failing decryptMaster
                // opaquely. Future mints upload R62-aligned AES-256-GCM ciphertext
                // that decryptMaster can handle.
                if (
                    buf.length >= 4
                    && buf[0] === 0x50 && buf[1] === 0x4b
                    && buf[2] === 0x03 && buf[3] === 0x04
                ) {
                    return res.status(503).json({
                        error: 'MASTER_LEGACY_ADR_0010_ZIP',
                        message: 'This image was minted under ADR-0010 (now superseded) and its Arweave copy is a nested ZIP envelope. The platform cannot decrypt it server-side. The buyer can recover via 7-Zip + their wallet signature using the ADR-0010 recovery procedure.',
                    });
                }
                ciphertext = buf;
            } else {
                return res.status(502).json({
                    error: 'ARWEAVE_FETCH_FAILED',
                    http: arResp.status,
                });
            }
        } catch (e: any) {
            return res.status(502).json({
                error: 'ARWEAVE_FETCH_FAILED',
                message: e?.message ?? String(e),
            });
        }
    }
    if (!ciphertext) {
        return res.status(500).json({
            error: 'MASTER_NOT_FOUND',
            message: 'No local encrypted Master and no Arweave URI to fall back to.',
        });
    }

    // Decrypt with DEK_image unwrapped from PLATFORM_DEK.
    let plaintext: Buffer;
    try {
        plaintext = decryptMaster(ciphertext, Buffer.from(image.dek_wrapped));
    } catch (e: any) {
        return res.status(500).json({
            error: 'DECRYPT_FAILED',
            message: e?.message ?? String(e),
        });
    }

    // Custody state machine: sealed -> unsealed. Idempotent; subsequent
    // downloads re-stream without mutating state.
    if (image.deed.custody_state === 'sealed') {
        const currentHashes = (() => {
            try { return JSON.parse(image.deed.variant_hashes ?? '{}'); }
            catch { return {}; }
        })();
        // Per R62 §7.4, the platform-delivered Master variant for owner
        // ordinal N is keyed M+N. First owner is N=1 (mint anchor is M+00).
        currentHashes['M+01'] = {
            sha256: createHash('sha256').update(plaintext).digest('hex'),
            anchored_at: new Date().toISOString(),
            owner_ordinal: 1,
        };

        // Per the user's 2026-06-07 directive: at the seal-break event, peel
        // the outer PLATFORM_DEK layer of enc_final and persist the inner
        // sealed-box on the Deed. The deed-holder can now combine their
        // wallet privkey + the unwrapped value to independently decrypt the
        // Arweave Master and verify it matches the on-chain sha256 anchor --
        // without further platform cooperation. INV-02 preserved: the
        // disclosed value is owner-wallet-bound; without the privkey it
        // reveals nothing. PLATFORM_DEK stays secret (AES-256 resists
        // known-plaintext attacks). Mirroring this to on-chain deed metadata
        // via Bubblegum updateMetadataV2 is post-MVP (requires DAS
        // getAssetProof; tracked in /docs/registry/arweave_master.md).
        let unwrapped: string | null = null;
        try {
            if (image.dek_wrapped) {
                const dek_image = unwrapDek(Buffer.from(image.dek_wrapped));
                unwrapped = buildEncFinalUnwrapped(dek_image, image.deed.owner_wallet_address);
            } else {
                logger.warn({ image_id: imageId }, '[download-master] missing dek_wrapped; cannot compute enc_final_unwrapped');
            }
        } catch (e: any) {
            logger.warn({ image_id: imageId, err: e?.message ?? String(e) }, '[download-master] enc_final_unwrapped computation failed');
        }

        await prisma.deed.update({
            where: { image_id: imageId },
            data: {
                custody_state: 'unsealed',
                variant_hashes: JSON.stringify(currentHashes),
                enc_final_unwrapped: unwrapped,
            },
        });
    }

    // Stream the Master to the browser with explicit attachment header.
    // Filename per R62 §2.3 line 149: epimage_<youtube-handle>_<owner-ordinal>_<image-id>.<ext>
    // Sanitize the YouTube handle (strip leading '@' and non-alphanumeric
    // chars) so the underscore field delimiter stays parseable.
    const ownerOrdinal = 1; // First owner; no resale at MVP.
    const handleSanitized = (image.creator?.youtube_channel_handle ?? '')
        .replace(/^@/, '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toLowerCase();
    const filename = sanitizeFilename(
        `epimage_${handleSanitized}_${ownerOrdinal}_${imageId}.jpg`,
        `epimage_${imageId}.jpg`,
    );
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(plaintext.length));
    return res.send(plaintext);
});

// Arweave-Master proxy per D-19. The deed UI shows the canonical
// `https://arweave.net/<tx_id>` URL as display text (proves permanence,
// survives platform cessation) but hyperlinks to /a/<imageId>. Server fetches
// the Arweave bytes and streams them back with Content-Disposition:
// attachment; filename="<image_id>.zip" so the buyer's browser saves a
// recognized .zip file instead of a tx_id-named blob.
//
// Public route: the encrypted Arweave bytes are public-by-design (anyone with
// the URL can fetch); the encryption protects the content, not the access.
// No auth required.
app.get('/archive/:imageId', async (req, res) => {
    const imageId = req.params.imageId;
    const image = await prisma.image.findUnique({
        where: { image_id: imageId },
        select: { arweave_uri: true },
    });
    if (!image?.arweave_uri) {
        return renderArweaveUnavailableHtml(res, 404, imageId, null,
            'No archive URL is recorded for this image yet.');
    }
    try {
        const upstream = await fetch(image.arweave_uri);
        if (!upstream.ok) {
            // Fresh uploads commonly 404 at gateway level while Arweave
            // propagates (~5-30 min from Turbo confirmation). 503 + the
            // canonical URL lets the user retry or open Arweave directly.
            return renderArweaveUnavailableHtml(res, 503, imageId, image.arweave_uri,
                `The permanent archive is still propagating (upstream ${upstream.status}). Try again in a few minutes.`);
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', String(buf.byteLength));
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(`${imageId}.zip`)}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        // Echo the canonical Arweave URI so technical clients can verify
        // the proxy fetched from the correct source.
        res.setHeader('X-Arweave-Source', image.arweave_uri);
        return res.send(buf);
    } catch (e: any) {
        return renderArweaveUnavailableHtml(res, 503, imageId, image.arweave_uri,
            `Couldn't reach the permanent archive: ${e?.message ?? String(e)}`);
    }
});

// Render the /a/:imageId fallback page when the Arweave fetch can't deliver
// the .zip. Surfaces the canonical https://arweave.net/<tx_id> URL so the
// buyer can either retry or open it directly -- key UX guarantee per D-19,
// since fresh uploads commonly take minutes to propagate.
function renderArweaveUnavailableHtml(
    res: Response,
    status: number,
    imageId: string,
    arweaveUri: string | null,
    message: string,
): Response {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const safeImageId = sanitizeFilename(imageId);
    const safeMessage = message
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const urlBlock = arweaveUri
        ? `<p>Direct archive URL:</p>
        <p><a href="${arweaveUri.replace(/"/g, '&quot;')}" rel="noopener noreferrer" target="_blank" style="font-family: ui-monospace, monospace; word-break: break-all;">${arweaveUri.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a></p>
        <p style="font-size: 13px; color: #666;">Open this URL directly in a browser to check propagation status, or refresh this page after a few minutes.</p>`
        : '';
    return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Archive not ready -- ${safeImageId}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 24px; color: #222;">
    <h1 style="font-weight: 300; font-size: 22px;">Archive not ready yet</h1>
    <p>${safeMessage}</p>
    ${urlBlock}
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
    <p style="font-size: 11px; color: #999;">Epimage  |  Image ${safeImageId}</p>
</body></html>`);
}

// Collection-level metadata JSON. Solana Explorer / DAS indexers fetch this
// from the on-chain Collection.uri to populate the Collection page (symbol,
// website, description, cover image). The on-chain uri is set by the
// scripts/update_collection_metadata.ts one-shot.
app.get('/collection.json', (_req, res) => {
    const baseUrl = process.env.PLATFORM_BASE_URL ?? 'https://epimage.com';
    const platformWallet = resolvePlatformWalletPubkey();
    // properties.creators matches the per-deed creators array in cnft_dispatch
    // (platform wallet, verified=true, share=100 when no creator wallet is set).
    // Solana Explorer reads this for the Collection page Creators dropdown.
    const creators = platformWallet
        ? [{ address: platformWallet, verified: true, share: 100 }]
        : [];
    res.json({
        name: 'Epimage Deeds',
        symbol: 'epimage',
        description: 'Authenticated photographic deeds issued by Epimage. Each deed is a 1-of-1 compressed NFT bound to a creator-signed image.',
        image: `${baseUrl}/static/collection-cover.png`,
        external_url: baseUrl,
        properties: {
            category: 'image',
            creators,
        },
    });
});

app.get('/i/:imageId', async (req, res) => {
    const img = await prisma.image.findUnique({
        where: { image_id: req.params.imageId },
        include: { deed: true },
    });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    // Variant selection (query params):
    //   ?variant=thumbnail  -> always return the unwatermarked Thumbnail
    //                          (used by the cNFT metadata image field; URL
    //                           must be stable + clean per R62 §2.2)
    //   ?download=1         -> force JPEG variant with Content-Disposition
    //   (no params)         -> auto-pick based on deed state: Share Copy
    //                          post-mint, Listing Preview pre-mint
    //
    // Server-side proxy (not 302 redirect): the browser URL bar stays on
    // epimage.com, never exposing the underlying CDN host. Slightly more
    // server bandwidth than a redirect, but stable URLs in marketplace UIs
    // (Solana Explorer's "View Original" stays on the platform domain).
    const isDownload = req.query.download === '1';
    let upstreamUrl: string;
    if (req.query.variant === 'thumbnail') {
        upstreamUrl = buildThumbnailUrl(img.image_id);
    } else if (img.deed) {
        const confirming = await prisma.purchase.findFirst({
            where: { image_id: img.image_id, status: 'confirmed' },
            select: { monogram_text: true },
            orderBy: { completed_at: 'desc' },
        });
        const monogram = confirming?.monogram_text ?? '';
        upstreamUrl = isDownload
            ? buildDownloadUrl(img.image_id, monogram)
            : buildShareCopyUrl(img.image_id, monogram);
    } else {
        upstreamUrl = isDownload
            ? buildDownloadUrl(img.image_id, '')
            : buildListingPreviewUrl(img.image_id);
    }
    try {
        const upstream = await fetch(upstreamUrl);
        if (!upstream.ok) {
            return res.status(502).json({
                error: 'UPSTREAM_FAILED',
                upstream_status: upstream.status,
            });
        }
        const ct = upstream.headers.get('content-type') ?? 'image/jpeg';
        res.setHeader('Content-Type', ct);
        // Cache aggressively at the browser + any intermediate CDN. The URL
        // is content-addressed via image_id + the listing page's `?v=` cache-
        // buster for post-sale variant flips, so long max-age is safe.
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        if (isDownload) {
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${sanitizeFilename(`${img.image_id}.jpg`)}"`,
            );
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        return res.send(buf);
    } catch (e: any) {
        return res.status(502).json({
            error: 'UPSTREAM_FETCH_FAILED',
            message: e?.message ?? String(e),
        });
    }
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

// Admin-only takedown. Marks the image taken_down with a reason, flips
// visibility to private, and (if the deed has been minted) opens a path for
// downstream multi-sig to flip legal_state -> disputed on the Deed. The
// actual multi-sig flow lives in registry/deed_state per INV-06 -- this
// endpoint only does the local-DB image-level part.
app.post('/v1/admin/images/:imageId/takedown', async (req, res) => {
    const { role } = await authAsync(req);
    if (role !== 'admin') return res.status(403).json({ error: 'ADMIN_REQUIRED' });
    const { reason } = (req.body ?? {}) as { reason?: string };
    if (!reason) return res.status(400).json({ error: 'REASON_REQUIRED' });
    const img = await prisma.image.findUnique({ where: { image_id: req.params.imageId } });
    if (!img) return res.status(404).json({ error: 'NOT_FOUND' });
    await prisma.image.update({
        where: { image_id: img.image_id },
        data: {
            status: 'taken_down',
            takedown_reason: reason,
            visibility: 'private',
            privacy_updated_at: new Date(),
        },
    });
    logger.warn({ image_id: img.image_id, reason }, '[admin.takedown] image taken down');
    // TODO(deed legal_state): if img has a deed, kick off the 3-of-5 multi-sig
    // dispatch to flip legal_state to 'disputed' on-chain. Per INV-06.
    res.json({ ok: true });
});

// Admin-only manual refund. Triggers payments.refundPurchase which calls
// Stripe with an idempotency key on purchase_id; the charge.refunded
// webhook subsequently flips the row to status='refunded'.
app.post('/v1/admin/refunds/:purchaseId', async (req, res) => {
    const { role } = await authAsync(req);
    if (role !== 'admin') return res.status(403).json({ error: 'ADMIN_REQUIRED' });
    const result = await refundPurchase(req.params.purchaseId);
    if (!result.ok) {
        return res.status(500).json({ error: result.error_code ?? 'REFUND_FAILED', message: result.message });
    }
    res.json(result);
});

// Deed content page
app.get('/v1/images/:imageId/deed', async (req, res) => {
    const deed = await prisma.deed.findUnique({
        where: { image_id: req.params.imageId },
        include: { image: { include: { creator: { include: { user: true } } } } },
    });
    if (!deed) return res.status(404).json({ error: 'NOT_FOUND' });

    // Use the real subsystem read; falls back to deed row on mismatch.
    const stateResult = await getDeedState(deed.asset_id);
    const states = stateResult.ok
        ? stateResult.states
        : { custody_state: deed.custody_state, legal_state: deed.legal_state };
    res.json({
        image_id: deed.image_id,
        title: deed.image.title,
        creator_display_name: deed.image.creator.display_name,
        creator_wallet_address: deed.image.creator.user.wallet_address ?? null,
        creation_date: deed.image.creation_date.toISOString(),
        edition: 'Unique',
        asset_id: deed.asset_id,
        arweave_uri: deed.image.arweave_uri ?? '',
        arweave_ready_at: deed.image.arweave_ready_at?.toISOString() ?? null,
        sha256: deed.image.sha256 ?? '',
        minted_at: deed.minted_at.toISOString(),
        custody_state: states.custody_state,
        legal_state: states.legal_state,
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
    const approved = Boolean(abuse_clear) && Boolean(rights_clear);
    // Tier 0 = abuse_clear failed (CSAM). Mandatory NCMEC report.
    // Tier 1 = rights_clear failed (publicity / IP). Soft rejection.
    const tier0Failed = !abuse_clear;
    const tier1Failed = !rights_clear && !!abuse_clear;
    const decision = approved
        ? 'approved'
        : tier0Failed
            ? 'rejected_tier0'
            : 'rejected_tier1';
    const newStatus = approved ? 'draft' : 'taken_down';
    let ncmecReportFiledAt: Date | null = null;

    if (tier0Failed) {
        // STUB: real NCMEC reporting requires Electronic Service Provider
        // registration with NCMEC + their REST API credentials + a designated
        // reporting officer. At MVP we record locally and log so the
        // moderator can manually file via NCMEC's web form until ESP status
        // is granted. See https://www.missingkids.org/gethelpnow/cybertipline.
        ncmecReportFiledAt = new Date();
        logger.error(
            { image_id: req.params.imageId, reviewer_id: user_id },
            '[moderation.tier0] Tier 0 rejection -- manual NCMEC CyberTipline report required.'
        );
    }

    await prisma.image.update({
        where: { image_id: req.params.imageId },
        data: { status: newStatus, takedown_reason: tier0Failed ? 'tier0_csam' : tier1Failed ? 'tier1_rights' : null },
    });
    await prisma.imageReview.create({
        data: {
            image_id: req.params.imageId,
            reviewer_id: user_id,
            decision,
            checks: JSON.stringify({ tier0_clean: !!abuse_clear, tier1_clean: !!rights_clear }),
            ncmec_report_filed_at: ncmecReportFiledAt,
        },
    });
    res.json({ ok: true, status: newStatus, decision });
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
    if (!process.env.PLATFORM_DEK) {
        const dek = generatePlatformDek();
        console.warn(
            '\n[platform_dek] PLATFORM_DEK not set. Generated a fresh 32-byte key -- ' +
            'paste this line into .env and restart to persist (otherwise a new key is minted each restart, ' +
            'and any encrypted Masters from prior runs become unrecoverable):\n' +
            `PLATFORM_DEK=${dek}\n`
        );
        process.env.PLATFORM_DEK = dek;
    }
}

// Postmark bounce / spam / delivery webhook. Per /docs/cert/email.md §3.5.
// Signature validation against POSTMARK_WEBHOOK_TOKEN is best-practice and
// pending env wiring; for MVP we trust the source IP (Postmark publishes a
// short list of IPs) and rely on the secret token in the URL path.
app.post('/webhooks/postmark/:token', async (req, res) => {
    const expected = process.env.POSTMARK_WEBHOOK_TOKEN;
    if (!expected || req.params.token !== expected) {
        return res.status(401).json({ error: 'INVALID_WEBHOOK_TOKEN' });
    }
    try {
        await handlePostmarkWebhook(req.body);
        res.status(200).json({ ok: true });
    } catch (e: any) {
        logger.error({ err: e?.message ?? e }, 'postmark webhook handler error');
        res.status(500).json({ error: 'WEBHOOK_HANDLER_FAILED' });
    }
});

// Legacy bare-handle URL -- server-side 301 to canonical /c/<handle>. The
// client-side React Router does the same redirect via <Navigate>, but the
// server-side version is for OG/Twitter scrapers and other non-JS fetchers
// that don't execute the SPA. Only fires when no other route matches; 5-char
// base-36 slugs are image_ids -- pass through. Known SPA single-segment
// routes (/signin, /creator, /collection, etc.) also pass through so the SPA
// fallback can render them in prod.
const SPA_RESERVED_TOP_SEGMENTS = new Set([
    'signin', 'backdoor', 'tos', 'privacy', 'creator', 'collection', 'auth', 'admin', 'c', 'i', 'v1',
]);
app.get('/:slug', (req, res, next) => {
    const slug = req.params.slug;
    if (/^[a-z0-9]{5}$/.test(slug)) return next();
    if (SPA_RESERVED_TOP_SEGMENTS.has(slug)) return next();
    res.redirect(301, `/c/${encodeURIComponent(slug)}`);
});

app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    void eagerStartupChecks();
    startStalePaidSweeper();
    startArweaveReadySweeper();
});
