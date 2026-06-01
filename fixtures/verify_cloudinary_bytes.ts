// verify_cloudinary_bytes.ts
// Upload → download → diff against a real phone photo (preserves real EXIF
// metadata, unlike the demo sample.jpg). Detects EXIF auto-rotation, metadata
// stripping, and account-wide auto-optimize on this Cloudinary account.
//
// Run from repo root:  npx tsx fixtures/verify_cloudinary_bytes.ts

import { v2 as cloudinary } from 'cloudinary';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(SCRIPT_DIR);

// Load .env (trim CR + quotes).
for (const line of fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
    }
}

const urlEnv = process.env.CLOUDINARY_URL ?? '';
const m = urlEnv.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
if (!m) { console.error('CLOUDINARY_URL malformed or missing'); process.exit(1); }
cloudinary.config({ api_key: m[1], api_secret: m[2], cloud_name: m[3] });

// Pick the source: CLI arg (absolute or relative to fixtures/cloudinary/) wins;
// otherwise default to the first PXL_*.jpg in fixtures/cloudinary/.
const fixtureDir = path.join(SCRIPT_DIR, 'cloudinary');
const argPath = process.argv[2];
let sourcePath: string;
if (argPath) {
    sourcePath = path.isAbsolute(argPath) ? argPath : path.join(fixtureDir, argPath);
    if (!fs.existsSync(sourcePath)) {
        console.error(`File not found: ${sourcePath}`);
        process.exit(1);
    }
} else {
    const phonePhoto = fs.readdirSync(fixtureDir).find(f => /^PXL_.*\.jpg$/i.test(f));
    if (!phonePhoto) {
        console.error('No PXL_*.jpg in fixtures/cloudinary/ -- pass a filename arg.');
        process.exit(1);
    }
    sourcePath = path.join(fixtureDir, phonePhoto);
}
const PUBLIC_ID = `verify-phone-${Date.now()}`;

function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

async function fetchBuf(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

async function uploadBuf(public_id: string, buffer: Buffer) {
    return new Promise<{ secure_url: string; version: number; format: string; bytes: number }>(
        (resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { public_id, resource_type: 'image', overwrite: true },
                (err, result) => {
                    if (err) return reject(err);
                    if (!result) return reject(new Error('No result'));
                    resolve({
                        secure_url: result.secure_url,
                        version: result.version,
                        format: result.format,
                        bytes: result.bytes,
                    });
                }
            );
            stream.end(buffer);
        }
    );
}

async function exifOrientation(buf: Buffer): Promise<number | undefined> {
    const meta = await sharp(buf).metadata();
    return meta.orientation;
}

async function main() {
    console.log(`Source: ${path.relative(REPO_ROOT, sourcePath)}`);
    const sourceBuf = fs.readFileSync(sourcePath);
    const sourceSha = sha256(sourceBuf);
    const sourceMeta = await sharp(sourceBuf).metadata();
    const sourceOrient = await exifOrientation(sourceBuf);
    console.log(`       size=${sourceBuf.length} B  ${sourceMeta.width}x${sourceMeta.height}  EXIF Orientation=${sourceOrient ?? '(none)'}  sha256=${sourceSha.slice(0, 16)}…`);
    if (sourceOrient === 1 || sourceOrient === undefined) {
        console.log('       NOTE: this photo has Orientation=Normal (or none); the EXIF auto-rotate path won\'t trigger. The test still covers metadata stripping + general byte preservation.');
    }

    console.log(`\nUploading as public_id=${PUBLIC_ID}…`);
    const cm = await uploadBuf(PUBLIC_ID, sourceBuf);
    console.log(`       stored bytes=${cm.bytes} B  version=${cm.version}  format=${cm.format}`);

    const downloadUrl = `https://res.cloudinary.com/${cloudinary.config().cloud_name}/image/upload/v${cm.version}/${PUBLIC_ID}.${cm.format}`;
    console.log(`\nDownloading: ${downloadUrl}`);
    const dlBuf = await fetchBuf(downloadUrl);
    const dlSha = sha256(dlBuf);
    const dlMeta = await sharp(dlBuf).metadata();
    const dlOrient = await exifOrientation(dlBuf);
    console.log(`       size=${dlBuf.length} B  ${dlMeta.width}x${dlMeta.height}  EXIF Orientation=${dlOrient ?? '(none)'}  sha256=${dlSha.slice(0, 16)}…`);

    console.log('\nDiffs');
    const fileMatch = sourceSha === dlSha;
    console.log(`  file sha256:    ${fileMatch ? 'MATCH' : 'DIFFER'} (Δ ${dlBuf.length - sourceBuf.length} B)`);

    const dimsMatch = sourceMeta.width === dlMeta.width && sourceMeta.height === dlMeta.height;
    console.log(`  dimensions:     ${dimsMatch ? 'MATCH' : `DIFFER (${sourceMeta.width}x${sourceMeta.height} → ${dlMeta.width}x${dlMeta.height})`}`);

    const orientMatch = sourceOrient === dlOrient;
    console.log(`  exif orient:    ${orientMatch ? 'MATCH' : `DIFFER (${sourceOrient ?? 'none'} → ${dlOrient ?? 'none'})`}`);

    console.log('\nPixel-decoded comparison…');
    const srcPx = await sharp(sourceBuf).rotate().raw().toBuffer({ resolveWithObject: true });  // .rotate() applies EXIF
    const dlPx  = await sharp(dlBuf).rotate().raw().toBuffer({ resolveWithObject: true });
    const srcPxSha = sha256(srcPx.data);
    const dlPxSha  = sha256(dlPx.data);
    console.log(`  source pixels:     ${srcPx.info.width}x${srcPx.info.height} ${srcPx.info.channels}ch  sha256=${srcPxSha.slice(0, 16)}…`);
    console.log(`  downloaded pixels: ${dlPx.info.width}x${dlPx.info.height} ${dlPx.info.channels}ch  sha256=${dlPxSha.slice(0, 16)}…`);
    const pxMatch = srcPxSha === dlPxSha;
    console.log(`  oriented pixels:   ${pxMatch ? 'MATCH' : 'DIFFER'}`);

    console.log('\n=== VERDICT ===');
    if (fileMatch) {
        console.log('Bytes identical end-to-end. Cloudinary stores the file as-is.');
    } else if (pxMatch) {
        console.log('File bytes differ but oriented pixels match.');
        console.log('Cause: Cloudinary strips metadata (EXIF / IPTC / color profile) at upload.');
        console.log('Implication: sha256(canonical_pixels) and phash anchors are STABLE.');
        console.log(`           File size delta: ${dlBuf.length - sourceBuf.length} B (negative = metadata removed).`);
    } else {
        console.log('Pixel data differs even after applying EXIF orientation.');
        console.log('Cause: Cloudinary recompressed or auto-rotated WITHOUT clearing the EXIF tag.');
        console.log('Implication: deed anchors computed pre-upload would NOT verify against the stored asset.');
    }

    console.log(`\nDestroying ${PUBLIC_ID}…`);
    await cloudinary.uploader.destroy(PUBLIC_ID);
    console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
