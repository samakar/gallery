// image_gen.ts
// Cloudinary interface for Listing preview / Thumbnail / Share Copy variants.
// Spec: /docs/commerce/image_gen.md
//
// CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
// The SDK reads this env var automatically; we call config() explicitly to
// surface a clear error at module load if it's missing.

import { v2 as cloudinary } from 'cloudinary';

if (!process.env.CLOUDINARY_URL) {
    console.warn(
        '[image_gen] CLOUDINARY_URL is not set -- uploads and preview URLs will fail. ' +
        'Set it in .env per .env.example.'
    );
}
cloudinary.config();

export interface UploadResult {
    public_id: string;
    secure_url: string;
    bytes: number;
    width: number;
    height: number;
    version: number;        // Cloudinary version stamp; embed in URLs to bust browser cache on replacement
}

// Cloudinary access mode for the Master + every variant derived from it.
//
// We upload the per-image Master at public_id = <image_id> with type: 'private'
// so the asset is NOT served by Cloudinary unless the request carries a valid
// HMAC signature derived from CLOUDINARY_URL's api_secret. Cloudinary enforces
// this at the CDN edge -- bypassing the platform server (e.g. by guessing
// res.cloudinary.com/<cloud_name>/image/upload/<image_id>) fails with 404.
//
// All transformation URLs of the Master (Listing Preview / Share Copy /
// Thumbnail / download variant) inherit the source's access mode, so signing
// the Master automatically gates every derivation of it.
//
// Creator headshots stay at the default `type: 'upload'` (public) since
// they're intentionally browseable as creator-profile branding.
const MASTER_CLOUDINARY_TYPE = 'private' as const;

// TTL on every signed URL the server builds for Master + variants.
//
// Why 60 seconds:
//   - The signed URL never reaches a browser. The server builds it, uses it in
//     a single upstream fetch from `/i/:imageId` proxy, then discards it.
//   - 60s gives generous margin for network slop and platform-vs-Cloudinary
//     clock skew, but caps the value of a leaked URL (log scrape, error
//     payload, etc.) to ~one minute of exposure.
//   - Shorter is tempting but earns nothing (the URL is one-shot anyway) and
//     risks failures at the boundary if a slow upstream + 5s clock skew + a
//     30s TTL ever collide.
//   - Longer is wrong: the URL is never reused, so longer TTLs only grow the
//     leak window.
//
// CDN-cache trade-off: because every request gets a fresh signature, the
// per-(URL) edge cache is effectively bypassed. At MVP scale (low traffic,
// server-direct fetches) this is fine. If listing-page hot paths ever cost
// real Cloudinary egress, switch to a rotated-daily signature shared across
// requests.
const SIGNED_URL_TTL_SECONDS = 60;

function signedExpiresAt(): number {
    return Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
}

// Upload bytes to Cloudinary using the image_id as the deterministic
// public_id -- so preview URLs can be reconstructed from image_id alone
// without a DB lookup.
//
// type: MASTER_CLOUDINARY_TYPE ('private') means Cloudinary refuses unsigned
// requests to <image_id> or any transformation of it. The platform server's
// `/i/:imageId` proxy is the only path to the bytes; every URL it generates
// carries a fresh HMAC signature (see signedExpiresAt + each buildXxxUrl).
//
// TODO: encryptAndStoreOriginal (per image_gen.md §2.1) wraps the Original
// in a DEK_image and writes it to local FS, then uploads only the derived
// variants here. Even with type: 'private', the bytes on Cloudinary are
// cleartext -- a single layer of defense (Cloudinary signed-URL enforcement).
// Encryption-at-upload is defense-in-depth on top of this.
export async function uploadOriginal(
    image_id: string,
    buffer: Buffer
): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { public_id: image_id, resource_type: 'image', overwrite: false,
              type: MASTER_CLOUDINARY_TYPE },
            (err, result) => {
                if (err) return reject(err);
                if (!result) return reject(new Error('Cloudinary returned no result.'));
                resolve({
                    public_id: result.public_id,
                    secure_url: result.secure_url,
                    bytes: result.bytes,
                    width: result.width,
                    height: result.height,
                    version: result.version,
                });
            }
        );
        stream.end(buffer);
    });
}

// Dev-only: upload from a remote URL, used by /v1/dev/create-test-listing
// to seed working test images without needing a buyer to click through the
// Creator upload flow. Cloudinary's upload() accepts a URL string directly.
export async function uploadFromUrl(image_id: string, remote_url: string): Promise<UploadResult> {
    const result = await cloudinary.uploader.upload(remote_url, {
        public_id: image_id,
        resource_type: 'image',
        overwrite: false,
        type: MASTER_CLOUDINARY_TYPE,    // dev test seed -- same access mode as real uploads
    });
    return {
        public_id: result.public_id,
        secure_url: result.secure_url,
        bytes: result.bytes,
        width: result.width,
        height: result.height,
        version: result.version,
    };
}

// Listing Copy URL (per R62 §2.2 / §4.3 / image_gen.md): 1080 px max, browser-
// aware format + auto quality, plus three in-pixel registers per R62:
//   1. Center "Epimage" italic watermark (gallery register, EB Garamond)
//   2. Lower-right URL text on the vertical edge (URL-text register, IBM Plex Mono)
//   3. Lower-left platform monogram "E" (gallery-wall-label register, EB Garamond)
//
// Pre-purchase, the monogram is the platform's "E". At Card 6 personalization
// the Share Copy variant replaces it with the buyer's chosen monogram (per
// ADR-0002 captureMonogram). Bringing the URL + monogram to the Listing Copy
// (a divergence from R62, which puts them on Share Copy only) gives buyers a
// faithful preview of the personalized variant they'll receive post-purchase.
//
// Fonts are referenced via Cloudinary's Google Fonts integration (released
// May 28, 2026) -- the `<FontName>@google` suffix lets Cloudinary fetch the
// font from Google Fonts at delivery time, no upload to Cloudinary needed.
//   - EB Garamond@google (gallery register; italic via font_style)
//   - IBM Plex Mono@google (URL-text register; slashed zero + distinct 1/l)
// Post-process the SDK URL to render a literal "/" in the text overlay.
// Per Cloudinary docs (https://cloudinary.com/documentation/video_layers#special_characters),
// "/" must be written as "%252F" -- double-encoded -- because the URL parser
// decodes once at URL level (%252F -> %2F) and the text renderer decodes
// again (%2F -> /). Writing plain "%2F" makes the URL parser treat it as a
// path separator and breaks the transformation.
function withSlashFix(url: string): string {
    return url.replace(/EPGSLASH/g, '%252F');
}

export function buildListingPreviewUrl(image_id: string): string {
    return withSlashFix(cloudinary.url(image_id, {
        secure: true,
        type: MASTER_CLOUDINARY_TYPE,
        sign_url: true,
        expires_at: signedExpiresAt(),
        transformation: [
            { fetch_format: 'auto', quality: 'auto', width: 1080, crop: 'limit' },
            // Center "Epimage" watermark in EB Garamond Italic.
            // **Divergence from R62 §2.2** ("centered italic Epimage outline
            // watermark"): R62 spec calls for a TRUE outline (hollow text,
            // transparent fill, visible outline). Cloudinary's text overlay
            // engine doesn't fully honor `co_transparent` / RGBA `co_rgb:
            // FFFFFF00` on text -- the fill stays partially opaque regardless.
            // Best approximation reached:
            //   - low layer opacity (30%) to make the partial-translucent
            //     fill barely visible
            //   - heavier outline (8 px outer) to keep the wordmark legible
            //     against varied photo content
            // True hollow rendering would require either (a) the
            // `font_style: 'stroke'` modifier (works but drops italic), or
            // (b) hand-building the URL string outside the SDK with
            // explicit segment ordering, or (c) Cloudinary supporting
            // overlay-scoped effect-param binding directly in their SDK.
            // Three-segment SDK structure here: text overlay -> outline via
            // `raw_transformation` -> `fl_layer_apply`. Outline syntax uses
            // colons (`outer:8:co_white`); underscore form (`outer_8`)
            // returns 400 from Cloudinary's parser.
            // Step 1: text overlay declaration
            {
                overlay: {
                    font_family: 'EB Garamond@google',
                    font_size: 150,
                    font_style: 'italic',
                    text: 'Epimage',
                },
                gravity: 'center',
                opacity: 30,
            },
            // Step 2: hollow + outline via raw URL params
            { raw_transformation: 'co_rgb:FFFFFF00,e_outline:outer:8:co_white' },
            // Step 3: finalize layer onto base
            { flags: 'layer_apply' },
            // URL text on the lower-right vertical edge, rotated -90deg so it
            // reads bottom-to-top along the right margin (R62 §4.3 URL-text
            // register placement).
            // URL text in IBM Plex Mono Medium via Google Fonts integration.
            // R62 §4.3 URL-text register: light fill + ~2 px dark stroke for
            // legibility against varied image content (NOT a shadow).
            // Google Fonts API requires numeric weight values (100-900);
            // Medium = 500. Don't pass 'medium' as a string -- Cloudinary
            // forwards it verbatim and Google returns 400.
            {
                overlay: {
                    font_family: 'IBM Plex Mono@google',
                    font_size: 36,
                    font_weight: 500,
                    // URL-text register reads "epima.ge/<image_id>" per R62
                    // §4.3. We swap a literal "/" via a sentinel placeholder
                    // ("EPGSLASH") in the SDK-generated URL after url() runs,
                    // because the SDK's text encoder double-encodes "/" to
                    // "%252F" and Cloudinary then renders the literal text
                    // "%2F". See post-process below.
                    text: `epima.geEPGSLASH${image_id}`,
                    stroke: 'stroke',
                    // 10% wider tracking than IBM Plex Mono's natural mono
                    // advance. Cloudinary's letter_spacing is additive in px.
                    letter_spacing: 2,
                },
                color: 'white',
                border: '2px_solid_black',
                opacity: 90,
                gravity: 'south_east',
                angle: -90,
                x: 28,
                y: 28,
            },
            // Edition mark "1/1" in EB Garamond Italic (R62 §4.3 gallery-wall-
            // label register: warm off-white at 75-85% opacity + soft drop
            // shadow). Photography convention for unique editions; replaces
            // the prior platform "E" placeholder.
            //
            // TODO (Share Copy / Card 6 personalization): on post-purchase
            // Share Copy, render as `1 of 1 <buyer_monogram_text>` per
            // ADR-0002 -- the slot keeps the edition mark and appends the
            // buyer's chosen monogram (captured at start-build via
            // metadata.captureMonogram).
            {
                overlay: {
                    font_family: 'EB Garamond@google',
                    // Cap-height ~27-32 px on 1080 width per R62 §4.3 gallery-
                    // wall-label register => font_size around 36-42.
                    font_size: 36,
                    font_style: 'italic',
                    // Written-out form -- "1/1" would double-encode the slash
                    // (Cloudinary parser 400s), and "1⁄1" with U+2044 Fraction
                    // Slash falls back to tofu because EB Garamond's Google
                    // Fonts subset lacks that glyph. "1 of 1" is the canonical
                    // form on Phillips/Christie's catalog typesetting anyway.
                    text: '1 of 1',
                },
                color: 'white',
                effect: 'shadow:50',
                opacity: 80,
                gravity: 'south_west',
                x: 12,
                y: 12,
            },
        ],
    }));
}

// Share Copy URL -- post-purchase variant per R62 §2.2 / §4.3. Differences
// vs Listing Copy:
//   - Drops the central "Epimage" watermark (buyer's edition, not gallery floor)
//   - Edition mark becomes "1 of 1 <monogram>" with the buyer's chosen letters
//   - Same URL text + format/quality otherwise
export function buildShareCopyUrl(image_id: string, monogram: string): string {
    const mark = monogram?.trim() ? `1 of 1  ${monogram.trim().toUpperCase()}` : '1 of 1';
    return withSlashFix(cloudinary.url(image_id, {
        secure: true,
        type: MASTER_CLOUDINARY_TYPE,
        sign_url: true,
        expires_at: signedExpiresAt(),
        transformation: [
            { fetch_format: 'auto', quality: 'auto', width: 1080, crop: 'limit' },
            // URL text -- same EPGSLASH sentinel + post-process trick as
            // buildListingPreviewUrl so the rendered glyph is "/", not "-".
            {
                overlay: {
                    font_family: 'IBM Plex Mono@google',
                    font_size: 36,
                    font_weight: 500,
                    text: `epima.geEPGSLASH${image_id}`,
                    stroke: 'stroke',
                    // 10% wider tracking than IBM Plex Mono's natural mono
                    // advance. Cloudinary's letter_spacing is additive in px.
                    letter_spacing: 2,
                },
                color: 'white',
                border: '2px_solid_black',
                opacity: 90,
                gravity: 'south_east',
                angle: -90,
                x: 28,
                y: 28,
            },
            // Edition mark + buyer monogram -- the visible swap from Listing.
            {
                overlay: {
                    font_family: 'EB Garamond@google',
                    font_size: 36,
                    font_style: 'italic',
                    text: mark,
                },
                color: 'white',
                effect: 'shadow:50',
                opacity: 80,
                gravity: 'south_west',
                x: 12,
                y: 12,
            },
        ],
    }));
}

// Download URL -- Share Copy variant forced to JPEG with an attachment flag
// so the browser saves with `.jpg` extension instead of Chrome's quirky
// `.jfif`. Universally accepted by social networks. Drops the f_auto modern-
// format optimization in exchange for the consistent file type.
export function buildDownloadUrl(image_id: string, monogram: string): string {
    const mark = monogram?.trim() ? `1 of 1  ${monogram.trim().toUpperCase()}` : '1 of 1';
    const filename = `epimage-${image_id}`;
    return withSlashFix(cloudinary.url(image_id, {
        secure: true,
        type: MASTER_CLOUDINARY_TYPE,
        sign_url: true,
        expires_at: signedExpiresAt(),
        // Force JPEG + Content-Disposition: attachment with our chosen filename.
        format: 'jpg',
        flags: `attachment:${filename}`,
        transformation: [
            { quality: 'auto', width: 1080, crop: 'limit' },
            // Same URL text overlay as Share Copy.
            {
                overlay: {
                    font_family: 'IBM Plex Mono@google',
                    font_size: 36,
                    font_weight: 500,
                    text: `epima.geEPGSLASH${image_id}`,
                    stroke: 'stroke',
                    letter_spacing: 2,
                },
                color: 'white',
                border: '2px_solid_black',
                opacity: 90,
                gravity: 'south_east',
                angle: -90,
                x: 28,
                y: 28,
            },
            // Edition mark + buyer monogram, same as Share Copy.
            {
                overlay: {
                    font_family: 'EB Garamond@google',
                    font_size: 36,
                    font_style: 'italic',
                    text: mark,
                },
                color: 'white',
                effect: 'shadow:50',
                opacity: 80,
                gravity: 'south_west',
                x: 12,
                y: 12,
            },
        ],
    }));
}

// Permanently remove a Cloudinary asset by public_id. Used when a creator
// deletes a draft image (server.ts DELETE /v1/images/:imageId). Best-effort
// from the caller's perspective; failures are logged but the DB row is
// already gone so orphan-asset is acceptable.
export async function deleteAsset(image_id: string): Promise<void> {
    await cloudinary.uploader.destroy(image_id);
}

// Upload a creator-headshot variant. Overwritable (creators can replace) +
// invalidate flag so the CDN purges old caches at the same public_id.
export async function uploadHeadshot(
    public_id: string,
    buffer: Buffer
): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { public_id, resource_type: 'image', overwrite: true, invalidate: true },
            (err, result) => {
                if (err) return reject(err);
                if (!result) return reject(new Error('Cloudinary returned no result.'));
                resolve({
                    public_id: result.public_id,
                    secure_url: result.secure_url,
                    bytes: result.bytes,
                    width: result.width,
                    height: result.height,
                    version: result.version,
                });
            }
        );
        stream.end(buffer);
    });
}

// Headshot delivery URL: 200x200 face-cropped, browser-aware format.
// gravity:'face' uses Cloudinary's face detection so the crop centers on the
// subject without manual cropping. `version` is required when the URL is
// being persisted post-replacement -- browsers cache by URL, so a versionless
// URL would serve the old image until the cache expires.
export function buildHeadshotUrl(public_id: string, version?: number): string {
    return cloudinary.url(public_id, {
        secure: true,
        version,
        transformation: [
            { fetch_format: 'auto', quality: 'auto', width: 200, height: 200, crop: 'fill', gravity: 'face' },
        ],
    });
}

// Original asset delivery URL -- NO transformations applied. Returns the
// exact bytes the creator uploaded (modulo Cloudinary's metadata-stripping
// defaults). Used by arweave_master to encrypt + nested-ZIP the actual
// full-resolution Master for Arweave (not the listing preview). Buyer's
// post-purchase /download-master decrypts these bytes and serves the Master
// to the deed holder.
export function buildOriginalUrl(image_id: string): string {
    return cloudinary.url(image_id, {
        secure: true,
        type: MASTER_CLOUDINARY_TYPE,
        sign_url: true,
        expires_at: signedExpiresAt(),
    });
}

// Square thumbnail for grid views (Creator dashboard, Collection).
export function buildThumbnailUrl(image_id: string): string {
    return cloudinary.url(image_id, {
        secure: true,
        type: MASTER_CLOUDINARY_TYPE,
        sign_url: true,
        expires_at: signedExpiresAt(),
        transformation: [
            { fetch_format: 'auto', quality: 'auto', width: 600, height: 600, crop: 'fill', gravity: 'auto' },
        ],
    });
}
